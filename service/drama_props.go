package service

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const dramaPropReferenceResponseLimit = 16 << 20

// StartDramaPropReference invokes DramaClaw's own asynchronous prop renderer.
// Its source task identity is returned unchanged; this adapter does not create
// a local job or synthesize a task status.
func (c *DramaClawClient) StartDramaPropReference(ctx context.Context, projectID, propName, model string) (json.RawMessage, error) {
	if err := validateDramaPropReferenceRoute(c, projectID, propName); err != nil {
		return nil, err
	}
	payload := struct {
		Model string `json:"model,omitempty"`
	}{Model: model}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.New("虾集道具参考图请求参数无效")
	}
	endpoint := dramaPropProjectPath(projectID) + "/props/" + url.PathEscape(propName) + "/reference/generate-async"
	response, err := c.dramaPropTaskRequest(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return nil, err
	}
	var task struct {
		OK       bool   `json:"ok"`
		TaskType string `json:"task_type"`
		TaskID   string `json:"task_id"`
		Scope    string `json:"scope"`
	}
	if json.Unmarshal(response, &task) != nil || !task.OK || task.TaskType != "prop_reference_asset" || task.TaskID == "" || task.Scope != dramaPropReferenceScope(propName) {
		return nil, errors.New("虾集道具参考图启动响应缺少有效源任务标识")
	}
	return response, nil
}

// GetDramaPropReferenceTask queries the source task route for the exact scope
// DramaClaw derives from this prop name. The complete source envelope is kept,
// including data:null and its message when no task row exists.
func (c *DramaClawClient) GetDramaPropReferenceTask(ctx context.Context, projectID, propName string) (json.RawMessage, error) {
	if err := validateDramaPropReferenceRoute(c, projectID, propName); err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("scope", dramaPropReferenceScope(propName))
	endpoint := dramaPropProjectPath(projectID) + "/tasks/prop_reference_asset/0?" + query.Encode()
	response, err := c.dramaPropTaskRequest(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	var task struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(response, &task) != nil || !task.OK || len(task.Data) == 0 {
		return nil, errors.New("虾集道具参考图状态响应格式无效")
	}
	return response, nil
}

func validateDramaPropReferenceRoute(c *DramaClawClient, projectID, propName string) error {
	if c == nil || strings.TrimSpace(c.BaseURL) == "" {
		return errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	return ValidateDramaPropReferenceSegments(projectID, propName)
}

func ValidateDramaPropReferenceSegments(projectID, propName string) error {
	if !validDramaRouteSegment(projectID) || !validDramaRouteSegment(propName) {
		return errors.New("虾集项目 ID 或道具名称无效")
	}
	return nil
}

func dramaPropProjectPath(projectID string) string {
	return "/api/v1/projects/" + url.PathEscape(projectID)
}

// dramaPropReferenceScope mirrors DramaClaw's task_config_scope("prop_ref",
// {"prop": name}) source contract. The upstream implementation serializes
// compact UTF-8 JSON and takes the first 12 hex characters of SHA-1.
func dramaPropReferenceScope(propName string) string {
	var payload bytes.Buffer
	encoder := json.NewEncoder(&payload)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(map[string]string{"prop": propName})
	canonical := strings.TrimSuffix(payload.String(), "\n")
	canonical = strings.NewReplacer(`\u2028`, "\u2028", `\u2029`, "\u2029").Replace(canonical)
	digest := sha1.Sum([]byte(canonical))
	return "prop_ref__" + hex.EncodeToString(digest[:])[:12]
}

func (c *DramaClawClient) dramaPropTaskRequest(ctx context.Context, method, endpointPath string, body []byte) (json.RawMessage, error) {
	endpoint, err := c.endpoint(endpointPath)
	if err != nil {
		return nil, err
	}
	var requestBody io.Reader
	if body != nil {
		requestBody = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, requestBody)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	response, err := c.writeHTTPClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("虾集道具任务请求失败: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, dramaPropReferenceResponseLimit+1))
	if err != nil {
		return nil, fmt.Errorf("读取虾集道具任务响应失败: %w", err)
	}
	if int64(len(data)) > dramaPropReferenceResponseLimit {
		return nil, errors.New("虾集道具任务响应超过大小限制")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("虾集道具任务请求返回 %s", response.Status)
	}
	var envelope struct {
		OK    *bool  `json:"ok"`
		Error string `json:"error"`
		Msg   string `json:"msg"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, errors.New("虾集道具任务响应格式无效")
	}
	if envelope.OK != nil && !*envelope.OK {
		if envelope.Error != "" {
			return nil, errors.New(envelope.Error)
		}
		if envelope.Msg != "" {
			return nil, errors.New(envelope.Msg)
		}
		return nil, errors.New("虾集道具任务请求失败")
	}
	return json.RawMessage(data), nil
}
