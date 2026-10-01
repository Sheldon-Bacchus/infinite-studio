package workspace

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"gorm.io/gorm"
)

const (
	serviceHost = "127.0.0.1:8086"
	webOrigin   = "http://127.0.0.1:43863"
)

func (a *App) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != serviceHost || r.URL.Host != "" {
			writeAPIError(w, http.StatusForbidden, "请求主机不受支持", ErrInvalidRequest)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != webOrigin {
			writeAPIError(w, http.StatusForbidden, "请求来源不受支持", ErrInvalidRequest)
			return
		}
		if r.Method != http.MethodGet && r.Header.Get("Origin") != webOrigin {
			writeAPIError(w, http.StatusForbidden, "写入请求缺少有效来源", ErrInvalidRequest)
			return
		}
		token := r.Header.Get("X-Local-Workspace-Token")
		if len(token) != len(a.accessToken) || subtle.ConstantTimeCompare([]byte(token), []byte(a.accessToken)) != 1 {
			writeAPIError(w, http.StatusForbidden, "本地工作区访问身份无效", ErrInvalidRequest)
			return
		}
		a.serve(w, r)
	})
}

func (a *App) serve(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/api/local/workspace":
		if !method(w, r, http.MethodGet) {
			return
		}
		writeAPI(w, http.StatusOK, WorkspaceInfo{
			SchemaVersion: SchemaVersion, WorkspaceID: a.workspaceID, DataRoot: a.root,
			Storage: "sqlite", ServiceInstanceID: a.serviceInstanceID,
		})
	case strings.HasPrefix(r.URL.Path, "/api/local/operations/"):
		if !method(w, r, http.MethodGet) {
			return
		}
		operationID := strings.TrimPrefix(r.URL.Path, "/api/local/operations/")
		if operationID == "" || strings.Contains(operationID, "/") {
			writeAPIError(w, http.StatusNotFound, "工作区操作不存在", ErrRecordNotFound)
			return
		}
		result, err := a.GetOperation(operationID)
		if err != nil {
			writeRecordError(w, err)
			return
		}
		writeAPI(w, http.StatusOK, result)
	case r.URL.Path == "/api/local/canvas/projects":
		a.serveRecordCollection(w, r, recordCanvas)
	case strings.HasPrefix(r.URL.Path, "/api/local/canvas/projects/"):
		a.serveRecord(w, r, recordCanvas, strings.TrimPrefix(r.URL.Path, "/api/local/canvas/projects/"))
	case r.URL.Path == "/api/local/assets":
		a.serveRecordCollection(w, r, recordAsset)
	case strings.HasPrefix(r.URL.Path, "/api/local/assets/"):
		a.serveRecord(w, r, recordAsset, strings.TrimPrefix(r.URL.Path, "/api/local/assets/"))
	case r.URL.Path == "/api/local/files":
		if !method(w, r, http.MethodPost) {
			return
		}
		a.uploadFile(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/files/") && strings.HasSuffix(r.URL.Path, "/content"):
		if !method(w, r, http.MethodGet) {
			return
		}
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/files/"), "/content")
		a.fileContent(w, r, id)
	default:
		writeAPIError(w, http.StatusNotFound, "接口不存在", ErrRecordNotFound)
	}
}

func (a *App) serveRecordCollection(w http.ResponseWriter, r *http.Request, kind string) {
	if !method(w, r, http.MethodGet) {
		return
	}
	records, err := a.ListRecords(kind)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "读取工作区记录失败", err)
		return
	}
	writeAPI(w, http.StatusOK, records)
}

func (a *App) serveRecord(w http.ResponseWriter, r *http.Request, kind, id string) {
	if id == "" || strings.Contains(id, "/") {
		writeAPIError(w, http.StatusNotFound, "工作区记录不存在", ErrRecordNotFound)
		return
	}
	switch r.Method {
	case http.MethodGet:
		record, err := a.GetRecord(kind, id)
		if err != nil {
			writeRecordError(w, err)
			return
		}
		writeAPI(w, http.StatusOK, record)
	case http.MethodPut:
		var request WriteRequest
		if err := decodeJSON(r.Body, &request); err != nil {
			writeAPIError(w, http.StatusUnprocessableEntity, "保存参数无效", ErrInvalidRequest)
			return
		}
		a.writeLock.RLock()
		result, err := a.WriteRecord(kind, id, request)
		a.writeLock.RUnlock()
		if err != nil {
			writeRecordError(w, err)
			return
		}
		writeAPI(w, http.StatusOK, result)
	case http.MethodDelete:
		var request DeleteRequest
		if err := decodeJSON(r.Body, &request); err != nil {
			writeAPIError(w, http.StatusUnprocessableEntity, "删除参数无效", ErrInvalidRequest)
			return
		}
		a.writeLock.RLock()
		result, err := a.DeleteRecord(kind, id, request)
		a.writeLock.RUnlock()
		if err != nil {
			writeRecordError(w, err)
			return
		}
		writeAPI(w, http.StatusOK, result)
	default:
		writeAPIError(w, http.StatusMethodNotAllowed, "请求方法不受支持", ErrInvalidRequest)
	}
}

func method(w http.ResponseWriter, r *http.Request, expected string) bool {
	if r.Method == expected {
		return true
	}
	w.Header().Set("Allow", expected)
	writeAPIError(w, http.StatusMethodNotAllowed, "请求方法不受支持", ErrInvalidRequest)
	return false
}

func decodeJSON(reader io.Reader, target any) error {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return ensureJSONEnd(decoder)
}

func writeRecordError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrRecordNotFound):
		writeAPIError(w, http.StatusNotFound, "工作区记录不存在", err)
	case errors.Is(err, ErrConflict):
		writeAPIError(w, http.StatusConflict, "工作区记录已变化，请回读后确认", err)
	case errors.Is(err, ErrInvalidRequest):
		writeAPIError(w, http.StatusUnprocessableEntity, "工作区请求无效", err)
	default:
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			writeAPIError(w, http.StatusConflict, "工作区记录发生冲突", err)
			return
		}
		writeAPIError(w, http.StatusServiceUnavailable, "本地工作区服务暂不可用", err)
	}
}

func writeAPI(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{Code: 0, Data: data, Msg: ""})
}

func writeAPIError(w http.ResponseWriter, status int, message string, _ error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{Code: status, Data: nil, Msg: message})
}
