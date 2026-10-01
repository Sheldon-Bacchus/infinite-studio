package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

func DramaProjectTasks(w http.ResponseWriter, r *http.Request, projectID string) {
	client, ok := dramaTaskClient(w)
	if !ok {
		return
	}
	if !validateDramaTaskProjectID(w, projectID) {
		return
	}
	data, err := client.GetProjectTasks(r.Context(), projectID)
	if err != nil {
		writeDramaTaskError(w, err, "读取虾集任务失败")
		return
	}
	OK(w, data)
}

func DramaProjectTaskLimits(w http.ResponseWriter, r *http.Request, projectID string) {
	client, ok := dramaTaskClient(w)
	if !ok {
		return
	}
	if !validateDramaTaskProjectID(w, projectID) {
		return
	}
	data, err := client.GetProjectTaskLimits(r.Context(), projectID)
	if err != nil {
		writeDramaTaskError(w, err, "读取虾集任务限额失败")
		return
	}
	OK(w, data)
}

func DramaProjectTaskGet(w http.ResponseWriter, r *http.Request, projectID, taskType string, episode int) {
	if !validateDramaTaskQuery(w, r, "beat_num", "scope") {
		return
	}
	beatNum, scope, ok := readDramaTaskIdentityQuery(w, r)
	if !ok {
		return
	}
	if !validateDramaTaskPath(w, projectID, taskType, episode) {
		return
	}
	client, ok := dramaTaskClient(w)
	if !ok {
		return
	}
	data, err := client.GetProjectTask(r.Context(), projectID, taskType, episode, beatNum, scope)
	if err != nil {
		writeDramaTaskError(w, err, "读取虾集任务状态失败")
		return
	}
	OK(w, data)
}

func DramaProjectTaskCancel(w http.ResponseWriter, r *http.Request, projectID, taskType string, episode int) {
	if !validateDramaTaskQuery(w, r, "beat_num", "scope", "force", "acknowledge_no_refund") {
		return
	}
	beatNum, scope, ok := readDramaTaskIdentityQuery(w, r)
	if !ok {
		return
	}
	if !validateDramaTaskPath(w, projectID, taskType, episode) {
		return
	}
	force, ok := readDramaTaskBoolQuery(w, r, "force")
	if !ok {
		return
	}
	acknowledgeNoRefund, ok := readDramaTaskBoolQuery(w, r, "acknowledge_no_refund")
	if !ok {
		return
	}
	client, ok := dramaTaskClient(w)
	if !ok {
		return
	}
	data, err := client.CancelProjectTask(r.Context(), projectID, taskType, episode, beatNum, scope, force, acknowledgeNoRefund)
	if err != nil {
		writeDramaTaskError(w, err, "取消虾集任务失败")
		return
	}
	OK(w, data)
}

func DramaProjectTasksStream(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	query := make(url.Values)
	for key, values := range r.URL.Query() {
		query[key] = append([]string(nil), values...)
	}
	if err := service.ValidateDramaTaskProjectID(projectID); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := service.ValidateDramaTaskStreamQuery(query); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	client := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken)
	response, err := client.OpenProjectTasksStream(r.Context(), projectID, query)
	if err != nil {
		writeDramaTaskError(w, err, "连接虾集任务流失败")
		return
	}
	defer response.Body.Close()
	for _, header := range []string{"Content-Type", "Cache-Control", "Retry-After"} {
		if value := response.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(response.StatusCode)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	copyDramaTaskStream(w, response.Body)
}

func copyDramaTaskStream(w io.Writer, source io.Reader) {
	flusher, canFlush := w.(http.Flusher)
	buffer := make([]byte, 32<<10)
	for {
		read, readErr := source.Read(buffer)
		if read > 0 {
			if _, err := w.Write(buffer[:read]); err != nil {
				return
			}
			if canFlush {
				flusher.Flush()
			}
		}
		if readErr != nil {
			return
		}
	}
}

func dramaTaskClient(w http.ResponseWriter) (*service.DramaClawClient, bool) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return nil, false
	}
	return service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken), true
}

func readDramaTaskIdentityQuery(w http.ResponseWriter, r *http.Request) (*int, string, bool) {
	query := r.URL.Query()
	var beatNum *int
	if values, found := query["beat_num"]; found {
		if len(values) != 1 {
			FailWithStatus(w, http.StatusBadRequest, "beat_num 只能提供一次")
			return nil, "", false
		}
		value, err := strconv.Atoi(values[0])
		if err != nil {
			FailWithStatus(w, http.StatusBadRequest, "beat_num 必须是整数")
			return nil, "", false
		}
		beatNum = &value
	}
	scope := ""
	if values, found := query["scope"]; found {
		if len(values) != 1 {
			FailWithStatus(w, http.StatusBadRequest, "scope 只能提供一次")
			return nil, "", false
		}
		scope = values[0]
	}
	if len(scope) > 512 {
		FailWithStatus(w, http.StatusBadRequest, "scope 超过 512 字符")
		return nil, "", false
	}
	return beatNum, scope, true
}

func validateDramaTaskProjectID(w http.ResponseWriter, projectID string) bool {
	if err := service.ValidateDramaTaskProjectID(projectID); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

func validateDramaTaskPath(w http.ResponseWriter, projectID, taskType string, episode int) bool {
	if err := service.ValidateDramaTaskPath(projectID, taskType, episode); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

func validateDramaTaskQuery(w http.ResponseWriter, r *http.Request, allowed ...string) bool {
	allow := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allow[key] = struct{}{}
	}
	for key := range r.URL.Query() {
		if _, ok := allow[key]; !ok {
			FailWithStatus(w, http.StatusBadRequest, "不支持的虾集任务参数："+key)
			return false
		}
	}
	return true
}

func readDramaTaskBoolQuery(w http.ResponseWriter, r *http.Request, key string) (bool, bool) {
	values, found := r.URL.Query()[key]
	if !found {
		return false, true
	}
	if len(values) != 1 {
		FailWithStatus(w, http.StatusBadRequest, key+" 只能提供一次")
		return false, false
	}
	value, err := strconv.ParseBool(values[0])
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, key+" 必须是布尔值")
		return false, false
	}
	return value, true
}

func writeDramaTaskError(w http.ResponseWriter, err error, fallback string) {
	var sourceError *service.DramaTaskSourceError
	if errors.As(err, &sourceError) {
		status := sourceError.StatusCode
		if status < 200 || status > 599 {
			status = http.StatusBadGateway
		}
		var data any
		if json.Valid(sourceError.Body) && len(strings.TrimSpace(string(sourceError.Body))) > 0 {
			data = json.RawMessage(sourceError.Body)
		} else if len(sourceError.Body) > 0 {
			data = map[string]string{"raw": string(sourceError.Body)}
		}
		writeJSONWithStatus(w, status, response{Code: 1, Data: data, Msg: sourceError.Message})
		return
	}
	FailWithStatus(w, http.StatusBadGateway, fallback)
}
