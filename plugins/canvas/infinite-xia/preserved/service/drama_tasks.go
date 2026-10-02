package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const dramaTaskResponseMaxBytes int64 = 16 << 20

// DramaTaskSourceError retains the source HTTP status and response body. In
// particular, the task API's running-cancel 409 is a user confirmation state.
type DramaTaskSourceError struct {
	StatusCode int
	Body       []byte
	Message    string
}

func (e *DramaTaskSourceError) Error() string {
	if e == nil || e.Message == "" {
		return "虾集任务请求失败"
	}
	return e.Message
}

func ValidateDramaTaskPath(projectID, taskType string, episode int) error {
	if err := ValidateDramaTaskProjectID(projectID); err != nil {
		return err
	}
	if !validDramaTaskSegment(taskType) {
		return errors.New("虾集 task_type 无效")
	}
	if episode < 0 {
		return errors.New("虾集 episode 无效")
	}
	return nil
}

func ValidateDramaTaskProjectID(projectID string) error {
	if !validDramaTaskSegment(projectID) {
		return errors.New("虾集项目 ID 无效")
	}
	return nil
}

func validDramaTaskSegment(value string) bool {
	if value == "" || len(value) > 128 || strings.TrimSpace(value) != value || strings.ContainsAny(value, "/\\?#") {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func (c *DramaClawClient) GetProjectTasks(ctx context.Context, projectID string) (json.RawMessage, error) {
	if err := ValidateDramaTaskProjectID(projectID); err != nil {
		return nil, err
	}
	return c.getDramaTaskData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/tasks", nil, false)
}

func (c *DramaClawClient) GetProjectTaskLimits(ctx context.Context, projectID string) (json.RawMessage, error) {
	if err := ValidateDramaTaskProjectID(projectID); err != nil {
		return nil, err
	}
	return c.getDramaTaskData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/tasks/limits", nil, false)
}

func (c *DramaClawClient) GetProjectTask(ctx context.Context, projectID, taskType string, episode int, beatNum *int, scope string) (json.RawMessage, error) {
	if err := ValidateDramaTaskPath(projectID, taskType, episode); err != nil {
		return nil, err
	}
	query, err := dramaTaskIdentityQuery(beatNum, scope)
	if err != nil {
		return nil, err
	}
	path := "/api/v1/projects/" + url.PathEscape(projectID) + "/tasks/" + url.PathEscape(taskType) + "/" + strconv.Itoa(episode)
	return c.getDramaTaskData(ctx, path, query, true)
}

func (c *DramaClawClient) CancelProjectTask(ctx context.Context, projectID, taskType string, episode int, beatNum *int, scope string, force, acknowledgeNoRefund bool) (json.RawMessage, error) {
	if err := ValidateDramaTaskPath(projectID, taskType, episode); err != nil {
		return nil, err
	}
	query, err := dramaTaskIdentityQuery(beatNum, scope)
	if err != nil {
		return nil, err
	}
	if force {
		query.Set("force", "true")
	}
	if acknowledgeNoRefund {
		query.Set("acknowledge_no_refund", "true")
	}
	path := "/api/v1/projects/" + url.PathEscape(projectID) + "/tasks/" + url.PathEscape(taskType) + "/" + strconv.Itoa(episode)
	response, err := c.doDramaTaskRequest(ctx, http.MethodDelete, path, query, "application/json")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := readDramaTaskBody(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, newDramaTaskSourceError(response.StatusCode, body)
	}
	if !json.Valid(body) || len(bytes.TrimSpace(body)) == 0 {
		return nil, errors.New("虾集取消任务响应无效")
	}
	var payload struct {
		OK      *bool  `json:"ok"`
		Error   string `json:"error"`
		Message string `json:"message"`
		Msg     string `json:"msg"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, errors.New("解析虾集取消任务响应失败")
	}
	if payload.OK != nil && !*payload.OK {
		return nil, newDramaTaskSourceError(response.StatusCode, body)
	}
	return append(json.RawMessage(nil), body...), nil
}

func (c *DramaClawClient) OpenProjectTasksStream(ctx context.Context, projectID string, query url.Values) (*http.Response, error) {
	if err := ValidateDramaTaskProjectID(projectID); err != nil {
		return nil, err
	}
	if err := ValidateDramaTaskStreamQuery(query); err != nil {
		return nil, err
	}
	path := "/api/v1/projects/" + url.PathEscape(projectID) + "/tasks/stream"
	endpoint, err := c.endpoint(path)
	if err != nil {
		return nil, err
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, errors.New("虾集任务流地址无效")
	}
	parsed.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "text/event-stream")
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	client := http.DefaultClient
	if c.HTTPClient != nil {
		clone := *c.HTTPClient
		clone.Timeout = 0 // SSE is bounded by request cancellation, not a 5-minute body timeout.
		clone.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		client = &clone
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("连接虾集任务流失败: %w", err)
	}
	return response, nil
}

func (c *DramaClawClient) getDramaTaskData(ctx context.Context, path string, query url.Values, allowNull bool) (json.RawMessage, error) {
	response, err := c.doDramaTaskRequest(ctx, http.MethodGet, path, query, "application/json")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := readDramaTaskBody(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, newDramaTaskSourceError(response.StatusCode, body)
	}
	var envelope struct {
		OK      *bool           `json:"ok"`
		Data    json.RawMessage `json:"data"`
		Error   string          `json:"error"`
		Message string          `json:"message"`
		Msg     string          `json:"msg"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("解析虾集任务响应失败: %w", err)
	}
	if envelope.OK != nil && !*envelope.OK {
		return nil, newDramaTaskSourceError(response.StatusCode, body)
	}
	data := bytes.TrimSpace(envelope.Data)
	if len(data) == 0 || (!allowNull && bytes.Equal(data, []byte("null"))) || !json.Valid(data) {
		return nil, errors.New("虾集任务响应缺少有效 data")
	}
	return append(json.RawMessage(nil), data...), nil
}

func (c *DramaClawClient) doDramaTaskRequest(ctx context.Context, method, path string, query url.Values, accept string) (*http.Response, error) {
	if c == nil || strings.TrimSpace(c.BaseURL) == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	endpoint, err := c.endpoint(path)
	if err != nil {
		return nil, err
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, errors.New("虾集任务地址无效")
	}
	parsed.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, method, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", accept)
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("请求虾集任务接口失败: %w", err)
	}
	return response, nil
}

func dramaTaskIdentityQuery(beatNum *int, scope string) (url.Values, error) {
	query := make(url.Values)
	if beatNum != nil {
		query.Set("beat_num", strconv.Itoa(*beatNum))
	}
	if len(scope) > 512 {
		return nil, errors.New("虾集任务 scope 超过 512 字符")
	}
	if scope != "" {
		query.Set("scope", scope)
	}
	return query, nil
}

func ValidateDramaTaskStreamQuery(query url.Values) error {
	for key, values := range query {
		if key != "snapshot" && key != "interval" && key != "heartbeat_sec" {
			return fmt.Errorf("不支持的虾集任务流参数：%s", key)
		}
		if len(values) != 1 {
			return fmt.Errorf("虾集任务流参数 %s 只能提供一次", key)
		}
		switch key {
		case "snapshot":
			if values[0] != "true" && values[0] != "false" {
				return errors.New("虾集任务流 snapshot 只允许 true 或 false")
			}
		case "interval":
			value, err := strconv.ParseFloat(values[0], 64)
			if err != nil || value < 0.5 || value > 10 {
				return errors.New("虾集任务流 interval 必须在 0.5 到 10 秒之间")
			}
		case "heartbeat_sec":
			value, err := strconv.ParseFloat(values[0], 64)
			if err != nil || value < 1 || value > 60 {
				return errors.New("虾集任务流 heartbeat_sec 必须在 1 到 60 秒之间")
			}
		}
	}
	return nil
}

func readDramaTaskBody(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, dramaTaskResponseMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取虾集任务响应失败: %w", err)
	}
	if int64(len(data)) > dramaTaskResponseMaxBytes {
		return nil, errors.New("虾集任务响应超过 16 MiB")
	}
	return data, nil
}

func newDramaTaskSourceError(status int, body []byte) *DramaTaskSourceError {
	message := "虾集任务请求失败"
	var payload struct {
		Error   string          `json:"error"`
		Message string          `json:"message"`
		Msg     string          `json:"msg"`
		Detail  json.RawMessage `json:"detail"`
	}
	if json.Unmarshal(body, &payload) == nil {
		switch {
		case strings.TrimSpace(payload.Message) != "":
			message = strings.TrimSpace(payload.Message)
		case strings.TrimSpace(payload.Error) != "":
			message = strings.TrimSpace(payload.Error)
		case strings.TrimSpace(payload.Msg) != "":
			message = strings.TrimSpace(payload.Msg)
		case len(payload.Detail) > 0 && !bytes.Equal(payload.Detail, []byte("null")):
			var detail string
			if json.Unmarshal(payload.Detail, &detail) == nil {
				message = strings.TrimSpace(detail)
			} else {
				message = string(payload.Detail)
			}
		}
	}
	if status < 100 || status > 599 {
		status = http.StatusBadGateway
	}
	return &DramaTaskSourceError{StatusCode: status, Body: append([]byte(nil), body...), Message: message}
}
