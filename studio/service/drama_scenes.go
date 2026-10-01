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
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path"
	"strings"
)

const dramaSceneResponseLimit = 16 << 20

var dramaSceneFileKinds = map[string]bool{
	"master": true,
	"pano":   true,
	"custom": true,
}

var dramaSceneCustomExtensions = map[string]bool{
	".ply":    true,
	".sog":    true,
	".splat":  true,
	".ksplat": true,
}

var dramaSceneGenerationOperations = map[string]bool{
	"master": true, "reverse": true, "pano": true,
	"3gs-master": true, "3gs-reverse": true, "3gs-pano": true,
}

// GetDramaScenes proxies the source summary or detail scene query without
// reshaping its fields. Detail reads use summary=false and repeated names.
func (c *DramaClawClient) GetDramaScenes(ctx context.Context, projectID string, summary bool, names []string) (json.RawMessage, error) {
	if err := c.validateDramaSceneProject(projectID); err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("summary", fmt.Sprintf("%t", summary))
	for _, name := range names {
		if !validDramaRouteSegment(name) {
			return nil, errors.New("虾集场景名称无效")
		}
		query.Add("names", name)
	}
	data, err := c.dramaSceneDataRequest(ctx, http.MethodGet, c.dramaSceneProjectPath(projectID)+"/scenes?"+query.Encode(), nil, "", false, false)
	if err != nil {
		return nil, err
	}
	var scenes []json.RawMessage
	if err := json.Unmarshal(data, &scenes); err != nil || scenes == nil {
		return nil, errors.New("虾集场景列表响应格式无效")
	}
	return c.rewriteDramaSceneMedia(data)
}

// GetDramaScenePlatePreview preserves DramaClaw's plate-selection contract.
func (c *DramaClawClient) GetDramaScenePlatePreview(ctx context.Context, projectID, sceneID, variantID, timeOfDay string) (json.RawMessage, error) {
	if err := c.validateDramaSceneProject(projectID); err != nil {
		return nil, err
	}
	for _, segment := range []string{sceneID, variantID, timeOfDay} {
		if segment != "" && !validDramaRouteSegment(segment) {
			return nil, errors.New("虾集场景预览参数无效")
		}
	}
	query := url.Values{}
	query.Set("scene_id", sceneID)
	query.Set("variant_id", variantID)
	query.Set("time_of_day", timeOfDay)
	data, err := c.dramaSceneDataRequest(ctx, http.MethodGet, c.dramaSceneProjectPath(projectID)+"/scenes/plate-preview?"+query.Encode(), nil, "", false, false)
	if err != nil {
		return nil, err
	}
	return c.rewriteDramaSceneMedia(data)
}

// StartDramaSceneBuild calls only the source build_scenes operation. Its task
// identity is returned exactly as DramaClaw reported it; this method does not
// create a local job or start an image-generation provider.
func (c *DramaClawClient) StartDramaSceneBuild(ctx context.Context, projectID string) (json.RawMessage, error) {
	if err := c.validateDramaSceneProject(projectID); err != nil {
		return nil, err
	}
	return c.dramaSceneDataRequest(ctx, http.MethodPost, c.dramaSceneProjectPath(projectID)+"/scenes/build", bytes.NewReader([]byte(`{}`)), "application/json", true, false)
}

// GetDramaSceneBuildTask reads DramaClaw's confirmed task route for
// task_type=build_scenes and episode=0. A source data:null remains a null state.
func (c *DramaClawClient) GetDramaSceneBuildTask(ctx context.Context, projectID string) (json.RawMessage, error) {
	if err := c.validateDramaSceneProject(projectID); err != nil {
		return nil, err
	}
	return c.dramaSceneDataRequest(ctx, http.MethodGet, c.dramaSceneProjectPath(projectID)+"/tasks/build_scenes/0", nil, "", false, true)
}

// StartDramaSceneGeneration forwards only the generation endpoints and request
// fields present in DramaClaw's scenes router. The source task response is
// retained verbatim so callers can track its task_id, task_type, scope and key.
func (c *DramaClawClient) StartDramaSceneGeneration(ctx context.Context, projectID, sceneName, operation, source, model string) (json.RawMessage, error) {
	if err := c.validateDramaSceneProject(projectID); err != nil {
		return nil, err
	}
	if !validDramaRouteSegment(sceneName) {
		return nil, errors.New("虾集场景名称无效")
	}
	if !dramaSceneGenerationOperations[operation] {
		return nil, errors.New("不支持的虾集场景生成操作")
	}
	var endpoint string
	var body []byte
	switch operation {
	case "master", "reverse":
		if source != "" {
			return nil, errors.New("场景参考图生成不接受 source 参数")
		}
		payload := map[string]string{}
		if strings.TrimSpace(model) != "" {
			payload["model"] = strings.TrimSpace(model)
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = encoded
		endpoint = "/" + operation + "/generate-async"
		if operation == "reverse" {
			endpoint = "/reverse/generate-async"
		} else {
			endpoint = "/master/generate-async"
		}
	case "pano":
		if source != "master" && source != "text" {
			return nil, errors.New("pano 生成 source 必须是 master 或 text")
		}
		encoded, err := json.Marshal(struct {
			Source string `json:"source"`
		}{Source: source})
		if err != nil {
			return nil, err
		}
		body = encoded
		endpoint = "/pano/generate-async"
	case "3gs-master":
		if source != "" || model != "" {
			return nil, errors.New("3GS master 操作不接受额外参数")
		}
		endpoint = "/3gs/master-ply/generate-async"
	case "3gs-reverse":
		if source != "" || model != "" {
			return nil, errors.New("3GS reverse 操作不接受额外参数")
		}
		endpoint = "/3gs/reverse-ply/generate-async"
	case "3gs-pano":
		if source != "" || model != "" {
			return nil, errors.New("3GS pano 操作不接受额外参数")
		}
		endpoint = "/3gs/pano-ply/generate-async"
	}
	var requestBody io.Reader
	contentType := ""
	if body != nil {
		requestBody = bytes.NewReader(body)
		contentType = "application/json"
	}
	path := c.dramaSceneProjectPath(projectID) + "/scenes/" + url.PathEscape(sceneName) + endpoint
	return c.dramaSceneDataRequest(ctx, http.MethodPost, path, requestBody, contentType, true, false)
}

// GetDramaSceneTask reads one scene operation from DramaClaw's project task
// API. Task type and hashed scope mirror task_scopes.py; this remains a
// scene-specific query and does not create a local jobs abstraction.
func (c *DramaClawClient) GetDramaSceneTask(ctx context.Context, projectID, sceneName, operation, source string) (json.RawMessage, error) {
	if err := c.validateDramaSceneProject(projectID); err != nil {
		return nil, err
	}
	if !validDramaRouteSegment(sceneName) {
		return nil, errors.New("虾集场景名称无效")
	}
	if !dramaSceneGenerationOperations[operation] {
		return nil, errors.New("不支持的虾集场景任务类型")
	}
	taskType, scope, err := dramaSceneTaskIdentity(sceneName, operation, source)
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("scope", scope)
	path := c.dramaSceneProjectPath(projectID) + "/tasks/" + taskType + "/0?" + query.Encode()
	return c.dramaSceneDataRequest(ctx, http.MethodGet, path, nil, "", false, true)
}

func dramaSceneTaskIdentity(sceneName, operation, source string) (string, string, error) {
	switch operation {
	case "master":
		if source != "" {
			return "", "", errors.New("master 任务不接受 source 参数")
		}
		return "scene_reference_asset", dramaSceneReferenceScope(sceneName, "master"), nil
	case "reverse":
		if source != "" {
			return "", "", errors.New("reverse 任务不接受 source 参数")
		}
		return "scene_reference_asset", dramaSceneReferenceScope(sceneName, "reverse_master"), nil
	case "pano":
		if source != "master" && source != "text" {
			return "", "", errors.New("pano 任务 source 必须是 master 或 text")
		}
		return "scene_pano_generation", dramaStageAssetScope(sceneName, "pano_from_"+source), nil
	case "3gs-master", "3gs-reverse":
		if source != "" {
			return "", "", errors.New("3GS 单面任务不接受 source 参数")
		}
		// DramaClaw deliberately stores both source kinds under the same step
		// identity; the exact source_kind is task payload metadata.
		return "stage_asset", dramaStageAssetScope(sceneName, "single_face_sharp"), nil
	case "3gs-pano":
		if source != "" {
			return "", "", errors.New("3GS pano 任务不接受 source 参数")
		}
		return "stage_asset", dramaStageAssetScope(sceneName, "pano_sharp"), nil
	default:
		return "", "", errors.New("不支持的虾集场景任务类型")
	}
}

func dramaSceneReferenceScope(sceneName, kind string) string {
	// Python task_config_scope sorts object keys and serializes compact JSON
	// with ensure_ascii=False. Keep that byte representation for the SHA-1.
	payload := `{"kind":` + dramaSceneJSONString(kind) + `,"scene":` + dramaSceneJSONString(sceneName) + `}`
	return dramaSceneHashedScope("scene_ref", payload)
}

func dramaStageAssetScope(sceneName, step string) string {
	payload := `{"scene":` + dramaSceneJSONString(sceneName) + `,"step":` + dramaSceneJSONString(step) + `}`
	return dramaSceneHashedScope("stage_asset", payload)
}

func dramaSceneHashedScope(label, payload string) string {
	digest := sha1.Sum([]byte(payload))
	return label + "__" + hex.EncodeToString(digest[:])[:12]
}

func dramaSceneJSONString(value string) string {
	var escaped strings.Builder
	escaped.Grow(len(value) + 2)
	escaped.WriteByte('"')
	for _, character := range value {
		switch character {
		case '"':
			escaped.WriteString(`\"`)
		case '\\':
			escaped.WriteString(`\\`)
		case '\b':
			escaped.WriteString(`\b`)
		case '\f':
			escaped.WriteString(`\f`)
		case '\n':
			escaped.WriteString(`\n`)
		case '\r':
			escaped.WriteString(`\r`)
		case '\t':
			escaped.WriteString(`\t`)
		default:
			if character < 0x20 {
				escaped.WriteString(fmt.Sprintf(`\u%04x`, character))
			} else {
				escaped.WriteRune(character)
			}
		}
	}
	escaped.WriteByte('"')
	return escaped.String()
}

// UploadDramaSceneFile streams a single scene file to an allowlisted source
// route. It never accepts a caller-supplied host or source path.
func (c *DramaClawClient) UploadDramaSceneFile(ctx context.Context, projectID, sceneName, kind, filename, contentType string, input io.Reader, maxBytes int64) (json.RawMessage, error) {
	if err := c.validateDramaSceneFileRoute(projectID, sceneName, kind); err != nil {
		return nil, err
	}
	if input == nil {
		return nil, errors.New("虾集场景文件内容为空")
	}
	if maxBytes <= 0 {
		maxBytes = DefaultDramaUploadMaxBytes
	}
	filename = path.Base(strings.ReplaceAll(strings.TrimSpace(filename), `\`, "/"))
	if filename == "" || filename == "." || filename == "/" {
		return nil, errors.New("虾集场景文件名无效")
	}
	if kind == "custom" && !dramaSceneCustomExtensions[strings.ToLower(path.Ext(filename))] {
		return nil, errors.New("custom 场景文件只支持 .ply、.sog、.splat 或 .ksplat")
	}
	if _, _, err := mime.ParseMediaType(contentType); err != nil {
		contentType = "application/octet-stream"
	}
	endpoint := c.dramaSceneProjectPath(projectID) + "/scenes/" + url.PathEscape(sceneName) + "/" + kind + "/upload"
	return c.dramaSceneMultipartRequest(ctx, endpoint, filename, contentType, input, maxBytes)
}

// DeleteDramaSceneFile mirrors DramaClaw's explicit per-kind delete actions.
func (c *DramaClawClient) DeleteDramaSceneFile(ctx context.Context, projectID, sceneName, kind string) (json.RawMessage, error) {
	if err := c.validateDramaSceneFileRoute(projectID, sceneName, kind); err != nil {
		return nil, err
	}
	endpoint := c.dramaSceneProjectPath(projectID) + "/scenes/" + url.PathEscape(sceneName) + "/" + kind + "/delete"
	return c.dramaSceneDataRequest(ctx, http.MethodPost, endpoint, nil, "", false, false)
}

func (c *DramaClawClient) validateDramaSceneProject(projectID string) error {
	if c == nil || strings.TrimSpace(c.BaseURL) == "" {
		return errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if !validDramaRouteSegment(projectID) {
		return errors.New("虾集项目 ID 无效")
	}
	return nil
}

func (c *DramaClawClient) validateDramaSceneFileRoute(projectID, sceneName, kind string) error {
	if err := c.validateDramaSceneProject(projectID); err != nil {
		return err
	}
	if !validDramaRouteSegment(sceneName) {
		return errors.New("虾集场景名称无效")
	}
	if !dramaSceneFileKinds[kind] {
		return errors.New("不支持的虾集场景文件类型")
	}
	return nil
}

func (c *DramaClawClient) dramaSceneProjectPath(projectID string) string {
	return "/api/v1/projects/" + url.PathEscape(projectID)
}

func (c *DramaClawClient) rewriteDramaSceneMedia(data json.RawMessage) (json.RawMessage, error) {
	return rewriteDramaDomainMediaData(c, data)
}

// dramaSceneDataRequest unwraps source data envelopes for ordinary scene reads
// and mutations. Source task-start responses are deliberately retained whole.
func (c *DramaClawClient) dramaSceneDataRequest(ctx context.Context, method, endpointPath string, body io.Reader, contentType string, preserveResponse, allowNull bool) (json.RawMessage, error) {
	endpoint, err := c.endpoint(endpointPath)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	response, err := c.writeHTTPClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("虾集场景请求失败: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, dramaSceneResponseLimit+1))
	if err != nil {
		return nil, fmt.Errorf("读取虾集场景响应失败: %w", err)
	}
	if int64(len(data)) > dramaSceneResponseLimit {
		return nil, errors.New("虾集场景响应超过大小限制")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("虾集场景请求返回 %s", response.Status)
	}
	var envelope struct {
		OK    *bool           `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error string          `json:"error"`
		Msg   string          `json:"msg"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, errors.New("虾集场景响应格式无效")
	}
	if envelope.OK != nil && !*envelope.OK {
		if envelope.Error != "" {
			return nil, errors.New(envelope.Error)
		}
		if envelope.Msg != "" {
			return nil, errors.New(envelope.Msg)
		}
		return nil, errors.New("虾集场景请求失败")
	}
	if preserveResponse {
		return json.RawMessage(data), nil
	}
	if len(envelope.Data) == 0 || (!allowNull && string(envelope.Data) == "null") {
		return nil, errors.New("虾集场景响应缺少 data")
	}
	return envelope.Data, nil
}

func (c *DramaClawClient) dramaSceneMultipartRequest(ctx context.Context, endpointPath, filename, contentType string, input io.Reader, maxBytes int64) (json.RawMessage, error) {
	endpoint, err := c.endpoint(endpointPath)
	if err != nil {
		return nil, err
	}
	// Validate the complete size limit locally before opening an upstream
	// request. Spooling to a private temporary file keeps large scene assets
	// bounded in memory while ensuring rejected uploads never reach DramaClaw.
	spooled, err := os.CreateTemp("", "drama-scene-upload-*")
	if err != nil {
		return nil, fmt.Errorf("暂存虾集场景文件失败: %w", err)
	}
	defer func() {
		_ = spooled.Close()
		_ = os.Remove(spooled.Name())
	}()

	written, err := io.Copy(spooled, &io.LimitedReader{R: input, N: maxBytes})
	if err != nil {
		return nil, fmt.Errorf("读取虾集场景文件失败: %w", err)
	}
	if written == maxBytes {
		var extra [1]byte
		n, readErr := io.ReadFull(input, extra[:])
		if n > 0 {
			return nil, ErrDramaUploadTooLarge
		}
		if !errors.Is(readErr, io.EOF) {
			return nil, fmt.Errorf("检查虾集场景文件大小失败: %w", readErr)
		}
	}
	if _, err := spooled.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("读取暂存虾集场景文件失败: %w", err)
	}

	pipeReader, pipeWriter := io.Pipe()
	multipartWriter := multipart.NewWriter(pipeWriter)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
	header.Set("Content-Type", contentType)
	copyResult := make(chan error, 1)
	go func() {
		part, partErr := multipartWriter.CreatePart(header)
		if partErr != nil {
			copyResult <- partErr
			_ = pipeWriter.CloseWithError(partErr)
			return
		}
		written, copyErr := io.Copy(part, spooled)
		if copyErr != nil {
			copyResult <- copyErr
			_ = pipeWriter.CloseWithError(copyErr)
			return
		}
		if written > maxBytes {
			copyResult <- ErrDramaUploadTooLarge
			_ = pipeWriter.CloseWithError(ErrDramaUploadTooLarge)
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
	request.Header.Set("Accept", "application/json")
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	response, requestErr := c.writeHTTPClient().Do(request)
	if requestErr != nil {
		_ = pipeReader.CloseWithError(requestErr)
		copyErr := <-copyResult
		if errors.Is(copyErr, ErrDramaUploadTooLarge) {
			return nil, copyErr
		}
		return nil, fmt.Errorf("虾集场景文件上传请求失败: %w", requestErr)
	}
	defer response.Body.Close()
	copyErr := <-copyResult
	if errors.Is(copyErr, ErrDramaUploadTooLarge) {
		return nil, copyErr
	}
	if copyErr != nil {
		return nil, fmt.Errorf("转发虾集场景文件失败: %w", copyErr)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, dramaSceneResponseLimit+1))
	if err != nil {
		return nil, fmt.Errorf("读取虾集场景上传响应失败: %w", err)
	}
	if int64(len(data)) > dramaSceneResponseLimit {
		return nil, errors.New("虾集场景上传响应超过大小限制")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("虾集场景上传返回 %s", response.Status)
	}
	var envelope struct {
		OK    *bool           `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error string          `json:"error"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil || envelope.OK == nil || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, errors.New("虾集场景上传响应格式无效")
	}
	if !*envelope.OK {
		if envelope.Error != "" {
			return nil, errors.New(envelope.Error)
		}
		return nil, errors.New("虾集场景上传失败")
	}
	return c.rewriteDramaSceneMedia(envelope.Data)
}
