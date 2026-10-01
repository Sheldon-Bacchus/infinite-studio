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
	"strings"
)

const DramaProjectConfigMaxBytes int64 = 64 << 10
const dramaProjectConfigResponseMaxBytes int64 = 4 << 20

type dramaProjectConfigValueType uint8

const (
	dramaProjectConfigString dramaProjectConfigValueType = iota
	dramaProjectConfigBoolean
	dramaProjectConfigSpineTemplate
	dramaProjectConfigAspectRatio
)

// This allowlist mirrors ProjectUpdate in integrations/dramaclaw/.../schemas.py.
// Read-only response properties such as scene_build_supported are deliberately
// excluded from PATCH requests.
var dramaProjectConfigFields = map[string]dramaProjectConfigValueType{
	"spine_template":         dramaProjectConfigSpineTemplate,
	"aspect_ratio":           dramaProjectConfigAspectRatio,
	"visual_style":           dramaProjectConfigString,
	"narration_style":        dramaProjectConfigString,
	"ethnicity":              dramaProjectConfigString,
	"rhythm":                 dramaProjectConfigString,
	"tts_provider":           dramaProjectConfigString,
	"tts_model":              dramaProjectConfigString,
	"tts_voice":              dramaProjectConfigString,
	"grid_mode":              dramaProjectConfigString,
	"grid_model":             dramaProjectConfigString,
	"video_backend":          dramaProjectConfigString,
	"use_director_render":    dramaProjectConfigBoolean,
	"video_resolution":       dramaProjectConfigString,
	"add_subtitles":          dramaProjectConfigBoolean,
	"sketch_image_selection": dramaProjectConfigString,
	"render_image_selection": dramaProjectConfigString,
	"sketch_aspect_padding":  dramaProjectConfigBoolean,
}

// DramaProjectConfigSourceError retains business errors returned by the
// source project API so callers can present the original message and status.
type DramaProjectConfigSourceError struct {
	StatusCode int
	Message    string
}

func (e *DramaProjectConfigSourceError) Error() string {
	if e == nil {
		return "虾集项目配置请求失败"
	}
	return e.Message
}

func ValidateDramaProjectConfigPatch(raw json.RawMessage) error {
	if len(raw) == 0 || int64(len(raw)) > DramaProjectConfigMaxBytes {
		return errors.New("虾集项目配置请求体无效或超过 64 KiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var fields map[string]json.RawMessage
	if err := decoder.Decode(&fields); err != nil || fields == nil {
		return errors.New("虾集项目配置必须是 JSON 对象")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("虾集项目配置包含多余内容")
	}
	if len(fields) == 0 {
		return errors.New("虾集项目配置没有可保存的字段")
	}
	for key, value := range fields {
		kind, ok := dramaProjectConfigFields[key]
		if !ok {
			return fmt.Errorf("不支持的虾集项目配置字段：%s", key)
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			continue
		}
		switch kind {
		case dramaProjectConfigString:
			var parsed string
			if err := json.Unmarshal(value, &parsed); err != nil {
				return fmt.Errorf("虾集项目配置字段 %s 必须是字符串", key)
			}
		case dramaProjectConfigBoolean:
			var parsed bool
			if err := json.Unmarshal(value, &parsed); err != nil {
				return fmt.Errorf("虾集项目配置字段 %s 必须是布尔值", key)
			}
		case dramaProjectConfigSpineTemplate:
			var parsed string
			if err := json.Unmarshal(value, &parsed); err != nil || (parsed != "drama" && parsed != "narrated") {
				return errors.New("spine_template 只允许 drama 或 narrated")
			}
		case dramaProjectConfigAspectRatio:
			var parsed string
			if err := json.Unmarshal(value, &parsed); err != nil || (parsed != "2:3" && parsed != "9:16" && parsed != "16:9") {
				return errors.New("aspect_ratio 只允许 2:3、9:16 或 16:9")
			}
		}
	}
	return nil
}

func (c *DramaClawClient) GetProjectConfig(ctx context.Context, projectID string) (json.RawMessage, error) {
	return c.requestProjectConfig(ctx, http.MethodGet, projectID, nil)
}

func (c *DramaClawClient) UpdateProjectConfig(ctx context.Context, projectID string, patch json.RawMessage) (json.RawMessage, error) {
	if err := ValidateDramaProjectConfigPatch(patch); err != nil {
		return nil, err
	}
	return c.requestProjectConfig(ctx, http.MethodPatch, projectID, patch)
}

func (c *DramaClawClient) requestProjectConfig(ctx context.Context, method, projectID string, body json.RawMessage) (json.RawMessage, error) {
	if c == nil || strings.TrimSpace(c.BaseURL) == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if strings.TrimSpace(projectID) == "" || len(projectID) > 128 || strings.TrimSpace(projectID) != projectID || strings.ContainsAny(projectID, "/\\?#") {
		return nil, errors.New("虾集项目 ID 无效")
	}
	endpoint, err := c.endpoint("/api/v1/projects/" + url.PathEscape(projectID))
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	if method == http.MethodPatch {
		request.Header.Set("Content-Type", "application/json")
	}
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("虾集项目配置请求失败: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, dramaProjectConfigResponseMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取虾集项目配置响应失败: %w", err)
	}
	if int64(len(responseBody)) > dramaProjectConfigResponseMaxBytes {
		return nil, errors.New("虾集项目配置响应超过 4 MiB")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, dramaProjectConfigSourceError(response.StatusCode, responseBody)
	}
	var envelope struct {
		OK     *bool           `json:"ok"`
		Data   json.RawMessage `json:"data"`
		Msg    string          `json:"msg"`
		Error  string          `json:"error"`
		Detail json.RawMessage `json:"detail"`
	}
	if err := json.Unmarshal(responseBody, &envelope); err != nil {
		return nil, fmt.Errorf("解析虾集项目配置响应失败: %w", err)
	}
	if envelope.OK != nil && !*envelope.OK {
		return nil, dramaProjectConfigSourceError(http.StatusBadRequest, responseBody)
	}
	data := bytes.TrimSpace(envelope.Data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) || data[0] != '{' || !json.Valid(data) {
		return nil, errors.New("虾集项目配置响应缺少有效对象")
	}
	return append(json.RawMessage(nil), data...), nil
}

func dramaProjectConfigSourceError(status int, body []byte) *DramaProjectConfigSourceError {
	if status < 400 || status > 599 {
		status = http.StatusBadGateway
	}
	var payload struct {
		Msg    string          `json:"msg"`
		Error  string          `json:"error"`
		Detail json.RawMessage `json:"detail"`
	}
	_ = json.Unmarshal(body, &payload)
	message := strings.TrimSpace(payload.Msg)
	if message == "" {
		message = strings.TrimSpace(payload.Error)
	}
	if message == "" && len(payload.Detail) > 0 && !bytes.Equal(payload.Detail, []byte("null")) {
		var detail string
		if json.Unmarshal(payload.Detail, &detail) == nil {
			message = strings.TrimSpace(detail)
		} else {
			message = string(payload.Detail)
		}
	}
	if message == "" {
		message = "虾集项目配置请求失败"
	}
	return &DramaProjectConfigSourceError{StatusCode: status, Message: message}
}
