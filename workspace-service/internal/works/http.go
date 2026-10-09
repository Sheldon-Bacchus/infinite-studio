package works

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
)

const (
	serviceHost = "127.0.0.1:8086"
	webOrigin   = "http://127.0.0.1:43863"
)

// APIResponse 统一 API 响应信封结构，与宿主可信代理及前端请求契约一致
type APIResponse struct {
	Code int    `json:"code"`
	Data any    `json:"data"`
	Msg  string `json:"msg"`
}

// WorkDetailResponse 作品详情聚合响应（权威作品清单、当前提交与当前记录集合）
type WorkDetailResponse struct {
	Work          *Work              `json:"work"`
	CurrentCommit *Commit            `json:"currentCommit"`
	Records       map[string]*Record `json:"records"`
}

// HTTPHandler 提供受限的本地作品仓库 HTTP 路由与安全门禁
type HTTPHandler struct {
	store       *Store
	accessToken string
}

// NewHTTPHandler 创建本地作品仓库 HTTP 处理句柄
func NewHTTPHandler(store *Store, accessToken string) *HTTPHandler {
	return &HTTPHandler{
		store:       store,
		accessToken: accessToken,
	}
}

// ServeHTTP 实现 http.Handler 接口，强制实施 Host、Origin、写入来源与令牌核验
func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1. Host 校验：仅允许本机指定服务端口，彻底杜绝 DNS 重绑定跨站攻击
	if r.Host != serviceHost || r.URL.Host != "" {
		writeAPIError(w, http.StatusForbidden, "请求主机不受支持", ErrInvalidRequest)
		return
	}

	// 2. Origin 校验：非空时必须严格匹配授权前端来源
	if origin := r.Header.Get("Origin"); origin != "" && origin != webOrigin {
		writeAPIError(w, http.StatusForbidden, "请求来源不受支持", ErrInvalidRequest)
		return
	}

	// 3. 写入请求安全来源强校验
	if r.Method != http.MethodGet && r.Header.Get("Origin") != webOrigin {
		writeAPIError(w, http.StatusForbidden, "写入请求缺少有效来源", ErrInvalidRequest)
		return
	}

	// 4. 访问凭证核验（采用常量时间比对防范计时侧信道攻击）
	token := r.Header.Get("X-Local-Workspace-Token")
	if len(h.accessToken) == 0 || len(token) != len(h.accessToken) ||
		subtle.ConstantTimeCompare([]byte(token), []byte(h.accessToken)) != 1 {
		writeAPIError(w, http.StatusForbidden, "本地作品服务访问身份无效", ErrInvalidRequest)
		return
	}

	// 5. 校验底层存储实例
	if h.store == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "本地作品仓库未初始化或未打开", ErrStoreNotInitialized)
		return
	}

	h.dispatch(w, r)
}

// dispatch 路由受限的作品接口
func (h *HTTPHandler) dispatch(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// 1. 作品根集合路由：/api/local/works 与 /api/local/works/rebuild-index
	if path == "/api/local/works" {
		switch r.Method {
		case http.MethodGet:
			h.handleListWorks(w, r)
		case http.MethodPost:
			h.handleCreateWork(w, r)
		default:
			method(w, r, "GET, POST")
		}
		return
	}

	if path == "/api/local/works/rebuild-index" {
		if !method(w, r, http.MethodPost) {
			return
		}
		h.handleRebuildAllIndex(w, r)
		return
	}

	if path == "/api/local/works/packages/preview" {
		if !method(w, r, http.MethodPost) {
			return
		}
		h.handlePreviewPackage(w, r)
		return
	}

	if path == "/api/local/works/packages/commit" {
		if !method(w, r, http.MethodPost) {
			return
		}
		h.handleCommitPackage(w, r)
		return
	}

	// 2. 作品单实体及其子资源路由：/api/local/works/{workId}/...
	if !strings.HasPrefix(path, "/api/local/works/") {
		writeAPIError(w, http.StatusNotFound, "接口不存在", ErrWorkNotFound)
		return
	}

	sub := strings.TrimPrefix(path, "/api/local/works/")
	parts := strings.Split(sub, "/")

	workID := parts[0]
	if err := ValidateStorageID(workID); err != nil {
		writeAPIError(w, http.StatusUnprocessableEntity, "作品 ID 格式非法", err)
		return
	}

	switch len(parts) {
	case 1:
		// /api/local/works/{workId}
		switch r.Method {
		case http.MethodGet:
			h.handleGetWork(w, r, workID)
		case http.MethodPut:
			h.handleCommitWork(w, r, workID)
		default:
			method(w, r, "GET, PUT")
		}

	case 2:
		action := parts[1]
		switch action {
		case "media":
			// POST /api/local/works/{workId}/media
			if !method(w, r, http.MethodPost) {
				return
			}
			h.handleRegisterMedia(w, r, workID)
		case "rebuild-index":
			// POST /api/local/works/{workId}/rebuild-index
			if !method(w, r, http.MethodPost) {
				return
			}
			h.handleRebuildWorkIndex(w, r, workID)
		case "archive":
			// POST /api/local/works/{workId}/archive
			if !method(w, r, http.MethodPost) {
				return
			}
			h.handleArchiveEntities(w, r, workID)
		case "restore":
			// POST /api/local/works/{workId}/restore
			if !method(w, r, http.MethodPost) {
				return
			}
			h.handleRestoreEntities(w, r, workID)
		case "export":
			// GET /api/local/works/{workId}/export
			if !method(w, r, http.MethodGet) {
				return
			}
			h.handleExportWork(w, r, workID)
		case "audit":
			// POST /api/local/works/{workId}/audit
			if !method(w, r, http.MethodPost) {
				return
			}
			h.handleAuditWork(w, r, workID)
		default:
			writeAPIError(w, http.StatusNotFound, "接口不存在", ErrWorkNotFound)
		}

	case 3:
		action := parts[1]
		target := parts[2]
		if action == "media" {
			// GET /api/local/works/{workId}/media/{fileId}
			if !method(w, r, http.MethodGet) {
				return
			}
			h.handleGetMediaFile(w, r, workID, target)
		} else if action == "migrations" {
			switch target {
			case "preview":
				// POST /api/local/works/{workId}/migrations/preview
				if !method(w, r, http.MethodPost) {
					return
				}
				h.handlePreviewMigration(w, r, workID)
			case "commit":
				// POST /api/local/works/{workId}/migrations/commit
				if !method(w, r, http.MethodPost) {
					return
				}
				h.handleCommitMigration(w, r, workID)
			default:
				writeAPIError(w, http.StatusNotFound, "接口不存在", ErrWorkNotFound)
			}
		} else if action == "inbox" {
			switch target {
			case "scan":
				// POST /api/local/works/{workId}/inbox/scan
				if !method(w, r, http.MethodPost) {
					return
				}
				h.handleScanInbox(w, r, workID)
			case "adopt":
				// POST /api/local/works/{workId}/inbox/adopt
				if !method(w, r, http.MethodPost) {
					return
				}
				h.handleAdoptInbox(w, r, workID)
			default:
				writeAPIError(w, http.StatusNotFound, "接口不存在", ErrWorkNotFound)
			}
		} else {
			writeAPIError(w, http.StatusNotFound, "接口不存在", ErrWorkNotFound)
		}

	default:
		writeAPIError(w, http.StatusNotFound, "接口不存在", ErrWorkNotFound)
	}
}

// handleListWorks 列出已登记作品清单列表，不隐式初始化
func (h *HTTPHandler) handleListWorks(w http.ResponseWriter, _ *http.Request) {
	works, err := h.store.ListWorks()
	if err != nil {
		handleWorksError(w, err)
		return
	}
	if works == nil {
		works = []*Work{}
	}
	writeAPI(w, http.StatusOK, works)
}

// handleCreateWork 创建新作品，采用 operationId 幂等并以 {work, committed: true, indexState} 响应
func (h *HTTPHandler) handleCreateWork(w http.ResponseWriter, r *http.Request) {
	var req CreateWorkRequest
	if err := decodeStrictJSON(r.Body, &req); err != nil {
		writeAPIError(w, http.StatusUnprocessableEntity, "创建作品参数无效", err)
		return
	}

	result, err := h.store.CreateWork(req)
	if err != nil {
		handleWorksError(w, err)
		return
	}

	writeAPI(w, http.StatusOK, result)
}

// handleGetWork 读取作品当前权威清单及关联的所有不可变记录集合（使用单一原子快照读取，杜绝混合不同版本）
func (h *HTTPHandler) handleGetWork(w http.ResponseWriter, _ *http.Request, workID string) {
	work, commit, records, err := h.store.GetWorkSnapshot(workID)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	if records == nil {
		records = map[string]*Record{}
	}

	writeAPI(w, http.StatusOK, WorkDetailResponse{
		Work:          work,
		CurrentCommit: commit,
		Records:       records,
	})
}

// handleCommitWork 提交作品变更，支持基准 CAS、operationId 幂等及单清单切换
func (h *HTTPHandler) handleCommitWork(w http.ResponseWriter, r *http.Request, workID string) {
	var req CommitRequest
	if err := decodeStrictJSON(r.Body, &req); err != nil {
		writeAPIError(w, http.StatusUnprocessableEntity, "提交载荷格式无效", err)
		return
	}

	result, err := h.store.Commit(workID, req)
	if err != nil {
		handleWorksError(w, err)
		return
	}

	writeAPI(w, http.StatusOK, result)
}

// handleRegisterMedia 流式上传作品内媒体原件并登记描述符，绝不接收客户指定的物理存储路径
func (h *HTTPHandler) handleRegisterMedia(w http.ResponseWriter, r *http.Request, workID string) {
	var (
		reader           io.Reader
		originalFilename string
		mimeType         string
	)

	contentType := r.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(contentType)

	if mediaType == "multipart/form-data" {
		mr, err := r.MultipartReader()
		if err != nil {
			writeAPIError(w, http.StatusUnprocessableEntity, "解析 multipart 请求失败", err)
			return
		}

		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				writeAPIError(w, http.StatusUnprocessableEntity, "读取表单数据分段失败", err)
				return
			}
			if part.FormName() == "file" {
				reader = part
				originalFilename = part.FileName()
				mimeType = part.Header.Get("Content-Type")
				break
			}
		}

		if reader == nil {
			writeAPIError(w, http.StatusUnprocessableEntity, "multipart 请求中缺少 file 字段", ErrInvalidRequest)
			return
		}
	} else {
		// 原始二进制数据流上传模式
		reader = r.Body
		mimeType = contentType
		originalFilename = r.Header.Get("X-Original-Filename")
		if originalFilename == "" {
			originalFilename = r.URL.Query().Get("filename")
		}
	}

	if qm := r.URL.Query().Get("mimeType"); qm != "" {
		mimeType = qm
	}

	desc, err := h.store.RegisterMedia(workID, reader, originalFilename, mimeType)
	if err != nil {
		handleWorksError(w, err)
		return
	}

	writeAPI(w, http.StatusOK, desc)
}

// handleGetMediaFile 根据当前已提交权威清单中登记的逻辑 fileId 定位并流式输出物理原件
func (h *HTTPHandler) handleGetMediaFile(w http.ResponseWriter, _ *http.Request, workID, fileID string) {
	if err := ValidateStorageID(fileID); err != nil {
		writeAPIError(w, http.StatusUnprocessableEntity, "媒体 fileId 格式非法", err)
		return
	}

	fileStream, desc, err := h.store.GetMediaFile(workID, fileID)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	defer fileStream.Close()

	w.Header().Set("Content-Type", desc.MIMEType)
	w.Header().Set("Content-Length", strconv.FormatInt(desc.Bytes, 10))
	w.Header().Set("Cache-Control", "private, no-store")
	if desc.OriginalFilename != "" {
		cd := mime.FormatMediaType("inline", map[string]string{
			"filename": desc.OriginalFilename,
		})
		w.Header().Set("Content-Disposition", cd)
	}

	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, fileStream)
}

// handleRebuildAllIndex 全量扫描磁盘作品清单重建 SQLite 索引
func (h *HTTPHandler) handleRebuildAllIndex(w http.ResponseWriter, _ *http.Request) {
	if err := h.store.RebuildIndex(); err != nil {
		handleWorksError(w, err)
		return
	}
	writeAPI(w, http.StatusOK, map[string]any{
		"rebuilt": true,
	})
}

// handleRebuildWorkIndex 针对单作品重新扫描重建索引（使用 store.RebuildWork 纳管生命周期与串行锁）
func (h *HTTPHandler) handleRebuildWorkIndex(w http.ResponseWriter, _ *http.Request, workID string) {
	if err := h.store.RebuildWork(workID); err != nil {
		handleWorksError(w, err)
		return
	}

	writeAPI(w, http.StatusOK, map[string]any{
		"rebuilt": true,
		"workId":  workID,
	})
}

// handlePreviewMigration 预览待导入的迁移来源包
func (h *HTTPHandler) handlePreviewMigration(w http.ResponseWriter, r *http.Request, workID string) {
	zipBytes, err := readZipFromRequest(r)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "读取备份包数据失败", err)
		return
	}

	result, err := h.store.PreviewMigration(workID, zipBytes)
	if err != nil {
		handleWorksError(w, err)
		return
	}

	writeAPI(w, http.StatusOK, result)
}

// handleCommitMigration 提交迁移包并发布不可变版本
func (h *HTTPHandler) handleCommitMigration(w http.ResponseWriter, r *http.Request, workID string) {
	baseRevision, operationID, zipBytes, err := readMigrationCommitPayload(r)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "解析迁移提交参数失败", err)
		return
	}

	result, err := h.store.CommitMigration(workID, baseRevision, operationID, zipBytes)
	if err != nil {
		handleWorksError(w, err)
		return
	}

	writeAPI(w, http.StatusOK, result)
}

// readZipFromRequest 从请求中解析 ZIP 二进制数据（支持 multipart/form-data 及直接二进制流）
func readZipFromRequest(r *http.Request) ([]byte, error) {
	contentType := r.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(contentType)

	if mediaType == "multipart/form-data" {
		mr, err := r.MultipartReader()
		if err != nil {
			return nil, fmt.Errorf("解析 multipart 请求失败: %w", err)
		}
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, fmt.Errorf("读取 multipart 分块失败: %w", err)
			}
			name := part.FormName()
			if name == "package" || name == "file" {
				data, readErr := io.ReadAll(part)
				_ = part.Close()
				if readErr != nil {
					return nil, fmt.Errorf("读取上传包数据失败: %w", readErr)
				}
				return data, nil
			}
			_ = part.Close()
		}
		return nil, fmt.Errorf("%w: 未在表单中找到 package 或 file 字段", ErrInvalidRequest)
	}

	data, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, fmt.Errorf("读取请求体失败: %w", err)
	}
	return data, nil
}

// readMigrationCommitPayload 从提交请求中解析 baseRevision, operationId 与 ZIP 二进制数据
func readMigrationCommitPayload(r *http.Request) (baseRevision int64, operationID string, zipBytes []byte, err error) {
	contentType := r.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(contentType)

	if mediaType == "multipart/form-data" {
		mr, rErr := r.MultipartReader()
		if rErr != nil {
			return 0, "", nil, fmt.Errorf("解析 multipart 请求失败: %w", rErr)
		}
		for {
			part, pErr := mr.NextPart()
			if pErr == io.EOF {
				break
			}
			if pErr != nil {
				return 0, "", nil, fmt.Errorf("读取 multipart 分块失败: %w", pErr)
			}
			name := part.FormName()
			switch name {
			case "baseRevision":
				b, _ := io.ReadAll(part)
				parsed, _ := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
				baseRevision = parsed
			case "operationId", "operationID":
				b, _ := io.ReadAll(part)
				operationID = strings.TrimSpace(string(b))
			case "package", "file":
				data, readErr := io.ReadAll(part)
				if readErr != nil {
					_ = part.Close()
					return 0, "", nil, fmt.Errorf("读取上传包数据失败: %w", readErr)
				}
				zipBytes = data
			}
			_ = part.Close()
		}
	} else {
		if revStr := r.URL.Query().Get("baseRevision"); revStr != "" {
			baseRevision, _ = strconv.ParseInt(revStr, 10, 64)
		} else if revStr := r.Header.Get("X-Base-Revision"); revStr != "" {
			baseRevision, _ = strconv.ParseInt(revStr, 10, 64)
		}
		if op := r.URL.Query().Get("operationId"); op != "" {
			operationID = op
		} else if op := r.Header.Get("X-Operation-ID"); op != "" {
			operationID = op
		}
		b, bErr := io.ReadAll(r.Body)
		if bErr != nil {
			return 0, "", nil, fmt.Errorf("读取请求体失败: %w", bErr)
		}
		zipBytes = b
	}

	if baseRevision == 0 {
		if revStr := r.Header.Get("X-Base-Revision"); revStr != "" {
			baseRevision, _ = strconv.ParseInt(revStr, 10, 64)
		}
	}
	if operationID == "" {
		if op := r.Header.Get("X-Operation-ID"); op != "" {
			operationID = op
		}
	}

	if operationID == "" {
		return 0, "", nil, fmt.Errorf("%w: operationId 不能为空", ErrInvalidRequest)
	}
	if baseRevision < 1 {
		return 0, "", nil, fmt.Errorf("%w: baseRevision 必须大于等于 1", ErrInvalidRequest)
	}
	if len(zipBytes) == 0 {
		return 0, "", nil, fmt.Errorf("%w: 备份数据包不能为空", ErrInvalidRequest)
	}
	return baseRevision, operationID, zipBytes, nil
}

func method(w http.ResponseWriter, r *http.Request, expected string) bool {
	tokens := strings.Split(expected, ",")
	for _, t := range tokens {
		if r.Method == strings.TrimSpace(t) {
			return true
		}
	}
	w.Header().Set("Allow", expected)
	writeAPIError(w, http.StatusMethodNotAllowed, "请求方法不受支持", ErrInvalidRequest)
	return false
}

func writeAPI(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{Code: 0, Data: data, Msg: ""})
}

func writeAPIError(w http.ResponseWriter, status int, message string, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	errMsg := message
	if err != nil && err.Error() != "" {
		errMsg = fmt.Sprintf("%s: %v", message, err)
	}
	_ = json.NewEncoder(w).Encode(APIResponse{Code: status, Data: nil, Msg: errMsg})
}

func handleWorksError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrWorkNotFound):
		writeAPIError(w, http.StatusNotFound, "作品或记录不存在", err)
	case errors.Is(err, ErrWorkExists):
		writeAPIError(w, http.StatusConflict, "作品已存在，拒绝重复创建", err)
	case errors.Is(err, ErrConflict):
		writeAPIError(w, http.StatusConflict, "版本冲突或提交冲突，请回读后重试", err)
	case errors.Is(err, ErrInvalidRequest), errors.Is(err, ErrInvalidID), errors.Is(err, ErrInvalidHash):
		writeAPIError(w, http.StatusUnprocessableEntity, "请求参数无效", err)
	case errors.Is(err, ErrPathOutOfBounds), errors.Is(err, ErrReparsePointDetected):
		writeAPIError(w, http.StatusForbidden, "目标路径越界或检测到重解析点", err)
	case errors.Is(err, ErrRootLocked):
		writeAPIError(w, http.StatusServiceUnavailable, "作品仓库根目录已被其他进程独占锁定", err)
	case errors.Is(err, ErrStoreClosed):
		writeAPIError(w, http.StatusServiceUnavailable, "作品仓库存储已关闭", err)
	case errors.Is(err, ErrStoreNotInitialized):
		writeAPIError(w, http.StatusServiceUnavailable, "作品仓库尚未初始化或缺少 root.json", err)
	case errors.Is(err, ErrCommitResultUndetermined):
		writeAPIError(w, http.StatusConflict, "权威指针切换状态未决，请重新回读核验", err)
	case errors.Is(err, ErrCommitFailed):
		writeAPIError(w, http.StatusInternalServerError, "提交失败，旧版本已安全保留", err)
	case errors.Is(err, ErrMediaHashMismatch):
		writeAPIError(w, http.StatusConflict, "已有媒体文件内容哈希与当前流不匹配", err)
	case errors.Is(err, ErrCorruptData):
		writeAPIError(w, http.StatusInternalServerError, "数据损坏或格式未知", err)
	default:
		writeAPIError(w, http.StatusInternalServerError, "服务器内部发生未知错误", err)
	}
}

// handleArchiveEntities 归档指定业务实体
func (h *HTTPHandler) handleArchiveEntities(w http.ResponseWriter, r *http.Request, workID string) {
	var req ArchiveRequest
	if err := decodeStrictJSON(r.Body, &req); err != nil {
		writeAPIError(w, http.StatusUnprocessableEntity, "请求载荷格式非法", err)
		return
	}
	res, err := h.store.ArchiveEntities(workID, req)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	writeAPI(w, http.StatusOK, res)
}

// handleRestoreEntities 恢复指定已归档业务实体
func (h *HTTPHandler) handleRestoreEntities(w http.ResponseWriter, r *http.Request, workID string) {
	var req RestoreRequest
	if err := decodeStrictJSON(r.Body, &req); err != nil {
		writeAPIError(w, http.StatusUnprocessableEntity, "请求载荷格式非法", err)
		return
	}
	res, err := h.store.RestoreEntities(workID, req)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	writeAPI(w, http.StatusOK, res)
}

// handleExportWork 导出指定版本的作品 ZIP
func (h *HTTPHandler) handleExportWork(w http.ResponseWriter, r *http.Request, workID string) {
	var rev int64
	if revStr := r.URL.Query().Get("revision"); revStr != "" {
		parsed, err := strconv.ParseInt(revStr, 10, 64)
		if err != nil || parsed < 1 {
			writeAPIError(w, http.StatusUnprocessableEntity, "版本号 revision 格式非法", ErrInvalidRequest)
			return
		}
		rev = parsed
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s-r%d.zip", workID, rev))
	w.Header().Set("Cache-Control", "no-store")

	if err := h.store.ExportWorkZip(workID, rev, w); err != nil {
		handleWorksError(w, err)
		return
	}
}

// handleAuditWork 验证并审计作品一致性
func (h *HTTPHandler) handleAuditWork(w http.ResponseWriter, _ *http.Request, workID string) {
	report, err := h.store.VerifyAndAuditWork(workID)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	writeAPI(w, http.StatusOK, report)
}

// handleScanInbox 扫描作品收件箱
func (h *HTTPHandler) handleScanInbox(w http.ResponseWriter, _ *http.Request, workID string) {
	result, err := h.store.ScanInbox(workID)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	writeAPI(w, http.StatusOK, result)
}

// handleAdoptInbox 采纳收件箱素材
func (h *HTTPHandler) handleAdoptInbox(w http.ResponseWriter, r *http.Request, workID string) {
	var req AdoptInboxRequest
	if err := decodeStrictJSON(r.Body, &req); err != nil {
		writeAPIError(w, http.StatusUnprocessableEntity, "请求载荷格式非法", err)
		return
	}
	res, err := h.store.AdoptInboxFiles(workID, req)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	writeAPI(w, http.StatusOK, res)
}

// handlePreviewPackage 预览上传的作品 ZIP 包
func (h *HTTPHandler) handlePreviewPackage(w http.ResponseWriter, r *http.Request) {
	tmpFile, err := os.CreateTemp("", "work-pkg-*.zip")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "创建临时包文件失败", err)
		return
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}()

	written, err := io.Copy(tmpFile, r.Body)
	if err != nil || written <= 0 {
		writeAPIError(w, http.StatusBadRequest, "上传作品包为空或读取中断", ErrInvalidRequest)
		return
	}

	result, err := h.store.PreviewWorkZip(tmpFile, written)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	writeAPI(w, http.StatusOK, result)
}

// handleCommitPackage 导入并发布作品 ZIP 包
func (h *HTTPHandler) handleCommitPackage(w http.ResponseWriter, r *http.Request) {
	opID := r.URL.Query().Get("operationId")
	if opID == "" {
		opID = r.Header.Get("X-Operation-ID")
	}
	if opID == "" {
		writeAPIError(w, http.StatusUnprocessableEntity, "缺少 operationId 参数", ErrInvalidRequest)
		return
	}

	tmpFile, err := os.CreateTemp("", "work-pkg-*.zip")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "创建临时包文件失败", err)
		return
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}()

	written, err := io.Copy(tmpFile, r.Body)
	if err != nil || written <= 0 {
		writeAPIError(w, http.StatusBadRequest, "上传作品包为空或读取中断", ErrInvalidRequest)
		return
	}

	work, err := h.store.ImportWorkZip(opID, tmpFile, written)
	if err != nil {
		handleWorksError(w, err)
		return
	}
	writeAPI(w, http.StatusCreated, work)
}

