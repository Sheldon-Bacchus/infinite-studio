package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"path"
	"strings"
)

var ErrDramaIdentityWriteOutcomeUnknown = errors.New("虾塘写入结果未知")

type DramaCharacterOperation string

const (
	DramaCharacterBuild    DramaCharacterOperation = "build"
	DramaCharacterPortrait DramaCharacterOperation = "portrait"
	DramaIdentityImage     DramaCharacterOperation = "identity-image"
	DramaIdentityPortrait  DramaCharacterOperation = "identity-portrait"
)

type DramaCharacterAssetUploadKind string

const (
	DramaCharacterPortraitUpload DramaCharacterAssetUploadKind = "character-portrait"
	DramaIdentityImageUpload     DramaCharacterAssetUploadKind = "identity-image"
	DramaIdentityCostumeUpload   DramaCharacterAssetUploadKind = "identity-costume"
	DramaIdentityPortraitUpload  DramaCharacterAssetUploadKind = "identity-portrait"
)

type DramaIdentityDeleteKind string

const (
	DramaIdentityImageDelete   DramaIdentityDeleteKind = "image"
	DramaIdentityCostumeDelete DramaIdentityDeleteKind = "costume"
)

var dramaIdentityCreateFields = map[string]bool{
	"identity_name":      true,
	"age_group":          true,
	"appearance_details": true,
}

var dramaIdentityUpdateFields = map[string]bool{
	"identity_name":      true,
	"appearance_details": true,
	"face_prompt":        true,
	"age_group":          true,
	"body_type":          true,
}

// ValidateDramaIdentitySegments keeps every source identifier inside one path segment.
func ValidateDramaIdentitySegments(projectID, character, identityID string) error {
	if !validDramaRouteSegment(projectID) || !validDramaRouteSegment(character) || (identityID != "" && !validDramaRouteSegment(identityID)) {
		return errors.New("虾塘项目、角色或身份 ID 无效")
	}
	return nil
}

// ValidateDramaIdentityPayload enforces the fields exposed by DramaClaw's
// create schema and frontend update hook. Schema-only fields stay unavailable.
func ValidateDramaIdentityPayload(payload json.RawMessage, creating bool) error {
	var fields map[string]json.RawMessage
	if len(payload) == 0 || json.Unmarshal(payload, &fields) != nil || fields == nil {
		return errors.New("虾塘身份参数格式无效")
	}
	allowed := dramaIdentityUpdateFields
	if creating {
		allowed = dramaIdentityCreateFields
	}
	for key, raw := range fields {
		if !allowed[key] {
			return fmt.Errorf("虾塘身份字段不允许写入：%s", key)
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return fmt.Errorf("虾塘身份字段类型无效：%s", key)
		}
		if key == "identity_name" && strings.TrimSpace(value) == "" {
			return errors.New("身份名称不能为空")
		}
	}
	if creating {
		if _, ok := fields["identity_name"]; !ok {
			return errors.New("身份名称不能为空")
		}
	} else if len(fields) == 0 {
		return errors.New("身份修改内容不能为空")
	}
	return nil
}

func (c *DramaClawClient) GetCharacterIdentities(ctx context.Context, projectID, character string) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaIdentitySegments(projectID, character, ""); err != nil {
		return nil, err
	}
	data, err := c.getData(ctx, dramaCharacterIdentitiesPath(projectID, character))
	if err != nil {
		return nil, err
	}
	var rows []json.RawMessage
	if json.Unmarshal(data, &rows) != nil || rows == nil {
		return nil, errors.New("虾塘角色身份列表响应无效")
	}
	for _, row := range rows {
		var item map[string]json.RawMessage
		var identityID, identityName string
		if json.Unmarshal(row, &item) != nil || item == nil || json.Unmarshal(item["identity_id"], &identityID) != nil || json.Unmarshal(item["identity_name"], &identityName) != nil || strings.TrimSpace(identityID) == "" || strings.TrimSpace(identityName) == "" {
			return nil, errors.New("虾塘角色身份列表包含无效项目")
		}
	}
	return rewriteDramaDomainMediaData(c, data)
}

func (c *DramaClawClient) CreateCharacterIdentity(ctx context.Context, projectID, character string, payload json.RawMessage) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaIdentitySegments(projectID, character, ""); err != nil {
		return nil, err
	}
	if err := ValidateDramaIdentityPayload(payload, true); err != nil {
		return nil, err
	}
	data, err := c.writeDramaIdentityJSON(ctx, http.MethodPost, dramaCharacterIdentitiesPath(projectID, character), json.RawMessage(bytes.TrimSpace(payload)), false)
	if err != nil {
		return nil, err
	}
	return rewriteDramaDomainMediaData(c, data)
}

func (c *DramaClawClient) UpdateCharacterIdentity(ctx context.Context, projectID, character, identityID string, payload json.RawMessage) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaIdentitySegments(projectID, character, identityID); err != nil {
		return nil, err
	}
	if err := ValidateDramaIdentityPayload(payload, false); err != nil {
		return nil, err
	}
	path := dramaCharacterIdentitiesPath(projectID, character) + "/" + url.PathEscape(identityID)
	data, err := c.writeDramaIdentityJSON(ctx, http.MethodPatch, path, json.RawMessage(bytes.TrimSpace(payload)), false)
	if err != nil {
		return nil, err
	}
	return rewriteDramaDomainMediaData(c, data)
}

func (c *DramaClawClient) DeleteCharacterIdentity(ctx context.Context, projectID, character, identityID string) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaIdentitySegments(projectID, character, identityID); err != nil || identityID == "" {
		return nil, errors.New("虾塘项目、角色或身份 ID 无效")
	}
	path := dramaCharacterIdentitiesPath(projectID, character) + "/" + url.PathEscape(identityID)
	return c.writeDramaIdentityJSON(ctx, http.MethodDelete, path, nil, false)
}

func (c *DramaClawClient) StartDramaCharacterOperation(ctx context.Context, projectID, character, identityID string, operation DramaCharacterOperation, payload json.RawMessage) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaCharacterOperation(projectID, character, identityID, operation, payload); err != nil {
		return nil, err
	}
	var endpoint, expectedTaskType string
	base := "/api/v1/projects/" + url.PathEscape(projectID) + "/characters"
	switch operation {
	case DramaCharacterBuild:
		endpoint, expectedTaskType = base+"/build", "build_characters"
	case DramaCharacterPortrait:
		endpoint, expectedTaskType = base+"/"+url.PathEscape(character)+"/portrait-async", "character_portrait"
	case DramaIdentityImage:
		endpoint, expectedTaskType = base+"/"+url.PathEscape(character)+"/identities/"+url.PathEscape(identityID)+"/generate-async", "identity_image"
	case DramaIdentityPortrait:
		endpoint, expectedTaskType = base+"/"+url.PathEscape(character)+"/identities/"+url.PathEscape(identityID)+"/portrait/generate-async", "character_portrait"
	default:
		return nil, errors.New("虾塘角色操作类型无效")
	}
	result, err := c.writeDramaIdentityJSON(ctx, http.MethodPost, endpoint, json.RawMessage(bytes.TrimSpace(payload)), true)
	if err != nil {
		return nil, err
	}
	var receipt struct {
		TaskType string `json:"task_type"`
		TaskID   string `json:"task_id"`
	}
	if json.Unmarshal(result, &receipt) != nil || receipt.TaskType != expectedTaskType || strings.TrimSpace(receipt.TaskID) == "" {
		return nil, fmt.Errorf("%w：虾塘未返回可核对的 task_type/task_id", ErrDramaIdentityWriteOutcomeUnknown)
	}
	return result, nil
}

func ValidateDramaCharacterOperation(projectID, character, identityID string, operation DramaCharacterOperation, payload json.RawMessage) error {
	if !validDramaRouteSegment(projectID) {
		return errors.New("虾塘项目 ID 无效")
	}
	allowed := map[string]bool{}
	switch operation {
	case DramaCharacterBuild:
		if character != "" || identityID != "" {
			return errors.New("虾塘角色补充参数无效")
		}
	case DramaCharacterPortrait:
		if !validDramaRouteSegment(character) || identityID != "" {
			return errors.New("虾塘项目或角色名称无效")
		}
		allowed = map[string]bool{"style": true, "ethnicity": true, "model": true}
	case DramaIdentityImage, DramaIdentityPortrait:
		if !validDramaRouteSegment(character) || !validDramaRouteSegment(identityID) {
			return errors.New("虾塘项目、角色或身份 ID 无效")
		}
		allowed = map[string]bool{"style": true, "model": true}
	default:
		return errors.New("虾塘角色操作类型无效")
	}
	var fields map[string]json.RawMessage
	if len(payload) == 0 || json.Unmarshal(payload, &fields) != nil || fields == nil {
		return errors.New("虾塘角色操作参数格式无效")
	}
	for key, raw := range fields {
		if !allowed[key] {
			return fmt.Errorf("虾塘角色操作字段不允许写入：%s", key)
		}
		var value string
		if json.Unmarshal(raw, &value) != nil {
			return fmt.Errorf("虾塘角色操作字段类型无效：%s", key)
		}
	}
	return nil
}

func (c *DramaClawClient) GetDramaIdentityAttempts(ctx context.Context, projectID, character, identityID string) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaIdentitySegments(projectID, character, identityID); err != nil || identityID == "" {
		return nil, errors.New("虾塘项目、角色或身份 ID 无效")
	}
	data, err := c.getData(ctx, dramaCharacterIdentitiesPath(projectID, character)+"/"+url.PathEscape(identityID)+"/attempts")
	if err != nil {
		return nil, err
	}
	var attempts struct {
		ImageAttempts    int `json:"image_attempts"`
		PortraitAttempts int `json:"portrait_attempts"`
	}
	if json.Unmarshal(data, &attempts) != nil || attempts.ImageAttempts < 0 || attempts.PortraitAttempts < 0 {
		return nil, errors.New("虾塘身份尝试次数响应无效")
	}
	return data, nil
}

func (c *DramaClawClient) DeleteDramaIdentityAsset(ctx context.Context, projectID, character, identityID string, kind DramaIdentityDeleteKind) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaIdentitySegments(projectID, character, identityID); err != nil || identityID == "" {
		return nil, errors.New("虾塘项目、角色或身份 ID 无效")
	}
	var suffix string
	switch kind {
	case DramaIdentityImageDelete:
		suffix = "/image/delete"
	case DramaIdentityCostumeDelete:
		suffix = "/costume/delete"
	default:
		return nil, errors.New("虾塘身份素材删除类型无效")
	}
	endpoint := dramaCharacterIdentitiesPath(projectID, character) + "/" + url.PathEscape(identityID) + suffix
	return c.writeDramaIdentityJSON(ctx, http.MethodPost, endpoint, json.RawMessage(`{}`), false)
}

func (c *DramaClawClient) UploadDramaCharacterAsset(ctx context.Context, projectID, character, identityID, identityName string, kind DramaCharacterAssetUploadKind, filename, contentType string, input io.Reader, size, maxBytes int64) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if !validDramaRouteSegment(projectID) || !validDramaRouteSegment(character) {
		return nil, errors.New("虾塘项目或角色名称无效")
	}
	base := "/api/v1/projects/" + url.PathEscape(projectID) + "/characters/" + url.PathEscape(character)
	var endpoint string
	switch kind {
	case DramaCharacterPortraitUpload:
		if identityID != "" || identityName != "" {
			return nil, errors.New("虾塘角色头像上传参数无效")
		}
		endpoint = base + "/portrait/upload"
	case DramaIdentityImageUpload:
		if identityID != "" || !validDramaRouteSegment(identityName) {
			return nil, errors.New("虾塘身份主图上传参数无效")
		}
		endpoint = base + "/identities/" + url.PathEscape(identityName) + "/upload"
	case DramaIdentityCostumeUpload, DramaIdentityPortraitUpload:
		if !validDramaRouteSegment(identityID) || identityName != "" {
			return nil, errors.New("虾塘身份素材上传参数无效")
		}
		suffix := "/costume/upload"
		if kind == DramaIdentityPortraitUpload {
			suffix = "/portrait/upload"
		}
		endpoint = base + "/identities/" + url.PathEscape(identityID) + suffix
	default:
		return nil, errors.New("虾塘身份素材上传类型无效")
	}
	return c.uploadDramaIdentityAsset(ctx, endpoint, filename, contentType, input, size, maxBytes)
}

func (c *DramaClawClient) writeDramaIdentityJSON(ctx context.Context, method, endpointPath string, payload any, taskReceipt bool) (json.RawMessage, error) {
	endpoint, err := c.endpoint(endpointPath)
	if err != nil {
		return nil, err
	}
	var body io.Reader
	if method != http.MethodDelete {
		encoded, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			return nil, marshalErr
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	if method != http.MethodDelete {
		request.Header.Set("Content-Type", "application/json")
	}
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	response, err := c.writeHTTPClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w：虾集请求未返回结果: %v", ErrDramaIdentityWriteOutcomeUnknown, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("%w：读取虾集响应失败: %v", ErrDramaIdentityWriteOutcomeUnknown, err)
	}
	if response.StatusCode >= http.StatusInternalServerError {
		return nil, fmt.Errorf("%w：虾集返回 %s", ErrDramaIdentityWriteOutcomeUnknown, response.Status)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("虾集请求返回 %s", response.Status)
	}
	var envelope struct {
		OK    *bool           `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error string          `json:"error"`
		Msg   string          `json:"msg"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.OK == nil {
		return nil, fmt.Errorf("%w：虾集响应无法判定", ErrDramaIdentityWriteOutcomeUnknown)
	}
	if !*envelope.OK {
		message := envelope.Error
		if message == "" {
			message = envelope.Msg
		}
		if message == "" {
			message = "虾集拒绝本次操作"
		}
		return nil, errors.New(message)
	}
	if taskReceipt {
		return json.RawMessage(data), nil
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, fmt.Errorf("%w：虾集成功响应缺少 data", ErrDramaIdentityWriteOutcomeUnknown)
	}
	return rewriteDramaDomainMediaData(c, envelope.Data)
}

func (c *DramaClawClient) uploadDramaIdentityAsset(ctx context.Context, endpointPath, filename, contentType string, input io.Reader, size, maxBytes int64) (json.RawMessage, error) {
	if input == nil || size < 0 {
		return nil, errors.New("虾塘身份素材上传参数无效")
	}
	if maxBytes <= 0 {
		maxBytes = DefaultDramaUploadMaxBytes
	}
	if size > maxBytes {
		return nil, ErrDramaUploadTooLarge
	}
	filename = path.Base(strings.ReplaceAll(filename, `\`, "/"))
	if filename == "" || filename == "." || filename == "/" {
		filename = "asset.bin"
	}
	if _, _, err := mime.ParseMediaType(contentType); err != nil {
		contentType = "application/octet-stream"
	}
	endpoint, err := c.endpoint(endpointPath)
	if err != nil {
		return nil, err
	}
	pipeReader, pipeWriter := io.Pipe()
	multipartWriter := multipart.NewWriter(pipeWriter)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
	header.Set("Content-Type", contentType)
	var prefix bytes.Buffer
	prefixWriter := multipart.NewWriter(&prefix)
	if err := prefixWriter.SetBoundary(multipartWriter.Boundary()); err != nil {
		return nil, err
	}
	if _, err := prefixWriter.CreatePart(header); err != nil {
		return nil, err
	}
	contentLength := int64(prefix.Len()) + size + int64(len("\r\n--"+multipartWriter.Boundary()+"--\r\n"))
	copyResult := make(chan error, 1)
	go func() {
		part, partErr := multipartWriter.CreatePart(header)
		if partErr != nil {
			copyResult <- partErr
			_ = pipeWriter.CloseWithError(partErr)
			return
		}
		written, copyErr := io.Copy(part, io.LimitReader(input, size+1))
		if copyErr != nil || written != size {
			if copyErr == nil {
				copyErr = ErrDramaUploadSizeMismatch
			}
			copyResult <- copyErr
			_ = pipeWriter.CloseWithError(copyErr)
			return
		}
		if closeErr := multipartWriter.Close(); closeErr != nil {
			copyResult <- closeErr
			_ = pipeWriter.CloseWithError(closeErr)
			return
		}
		copyResult <- nil
		_ = pipeWriter.Close()
	}()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, pipeReader)
	if err != nil {
		_ = pipeReader.CloseWithError(err)
		<-copyResult
		return nil, err
	}
	request.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	request.ContentLength = contentLength
	request.Header.Set("Accept", "application/json")
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	response, err := c.writeHTTPClient().Do(request)
	if err != nil {
		_ = pipeReader.CloseWithError(err)
		<-copyResult
		return nil, fmt.Errorf("%w：虾集素材上传未返回结果: %v", ErrDramaIdentityWriteOutcomeUnknown, err)
	}
	defer response.Body.Close()
	if copyErr := <-copyResult; copyErr != nil {
		return nil, copyErr
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("%w：读取虾集素材上传响应失败: %v", ErrDramaIdentityWriteOutcomeUnknown, err)
	}
	if response.StatusCode >= http.StatusInternalServerError {
		return nil, fmt.Errorf("%w：虾集素材上传返回 %s", ErrDramaIdentityWriteOutcomeUnknown, response.Status)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("虾集素材上传返回 %s", response.Status)
	}
	var envelope struct {
		OK    *bool           `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error string          `json:"error"`
		Msg   string          `json:"msg"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.OK == nil {
		return nil, fmt.Errorf("%w：虾集素材上传响应无法判定", ErrDramaIdentityWriteOutcomeUnknown)
	}
	if !*envelope.OK {
		if envelope.Error != "" {
			return nil, errors.New(envelope.Error)
		}
		if envelope.Msg != "" {
			return nil, errors.New(envelope.Msg)
		}
		return nil, errors.New("虾集拒绝素材上传")
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, fmt.Errorf("%w：虾集素材上传成功响应缺少 data", ErrDramaIdentityWriteOutcomeUnknown)
	}
	return rewriteDramaDomainMediaData(c, envelope.Data)
}

func dramaCharacterIdentitiesPath(projectID, character string) string {
	return "/api/v1/projects/" + url.PathEscape(projectID) + "/characters/" + url.PathEscape(character) + "/identities"
}
