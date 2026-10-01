package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

var allowedDramaSceneFileKinds = map[string]bool{"master": true, "pano": true, "custom": true}
var allowedDramaSceneCustomExtensions = map[string]bool{".ply": true, ".sog": true, ".splat": true, ".ksplat": true}
var allowedDramaSceneGenerationOperations = map[string]bool{"master": true, "reverse": true, "pano": true, "3gs-master": true, "3gs-reverse": true, "3gs-pano": true}

func validDramaSceneRouteSegment(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || value == "." || value == ".." || strings.ContainsAny(value, `/\\`) {
		return false
	}
	if !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

func dramaSceneClient(w http.ResponseWriter) *service.DramaClawClient {
	if strings.TrimSpace(config.Cfg.DramaClawBaseURL) == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return nil
	}
	return service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken)
}

func DramaScenesList(w http.ResponseWriter, r *http.Request, projectID string) {
	client := dramaSceneClient(w)
	if client == nil {
		return
	}
	if !validDramaSceneRouteSegment(projectID) {
		FailWithStatus(w, http.StatusBadRequest, "虾集项目 ID 无效")
		return
	}
	summary := false
	if raw := r.URL.Query().Get("summary"); raw != "" {
		if raw != "true" && raw != "false" {
			FailWithStatus(w, http.StatusBadRequest, "summary 参数必须是 true 或 false")
			return
		}
		summary = raw == "true"
	}
	names := r.URL.Query()["names"]
	for _, name := range names {
		if !validDramaSceneRouteSegment(name) {
			FailWithStatus(w, http.StatusBadRequest, "虾集场景名称无效")
			return
		}
	}
	data, err := client.GetDramaScenes(r.Context(), projectID, summary, names)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集场景失败")
		return
	}
	OK(w, data)
}

func DramaScenePlatePreview(w http.ResponseWriter, r *http.Request, projectID string) {
	client := dramaSceneClient(w)
	if client == nil {
		return
	}
	if !validDramaSceneRouteSegment(projectID) {
		FailWithStatus(w, http.StatusBadRequest, "虾集项目 ID 无效")
		return
	}
	query := r.URL.Query()
	for _, key := range []string{"scene_id", "variant_id", "time_of_day"} {
		if value := query.Get(key); value != "" && !validDramaSceneRouteSegment(value) {
			FailWithStatus(w, http.StatusBadRequest, "虾集场景预览参数无效")
			return
		}
	}
	data, err := client.GetDramaScenePlatePreview(r.Context(), projectID, query.Get("scene_id"), query.Get("variant_id"), query.Get("time_of_day"))
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集场景母版预览失败")
		return
	}
	OK(w, data)
}

func DramaSceneBuild(w http.ResponseWriter, r *http.Request, projectID string) {
	client := dramaSceneClient(w)
	if client == nil {
		return
	}
	if !validDramaSceneRouteSegment(projectID) {
		FailWithStatus(w, http.StatusBadRequest, "虾集项目 ID 无效")
		return
	}
	data, err := client.StartDramaSceneBuild(r.Context(), projectID)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "启动虾集场景补全任务失败")
		return
	}
	OK(w, data)
}

func DramaSceneBuildTask(w http.ResponseWriter, r *http.Request, projectID string) {
	client := dramaSceneClient(w)
	if client == nil {
		return
	}
	if !validDramaSceneRouteSegment(projectID) {
		FailWithStatus(w, http.StatusBadRequest, "虾集项目 ID 无效")
		return
	}
	data, err := client.GetDramaSceneBuildTask(r.Context(), projectID)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集场景补全任务状态失败")
		return
	}
	OK(w, data)
}

type dramaSceneGenerationBody struct {
	Model  string `json:"model"`
	Source string `json:"source"`
}

func DramaSceneGenerate(w http.ResponseWriter, r *http.Request, projectID, sceneName, operation string) {
	client := dramaSceneClient(w)
	if client == nil {
		return
	}
	if !validDramaSceneRouteSegment(projectID) || !validDramaSceneRouteSegment(sceneName) || !allowedDramaSceneGenerationOperations[operation] {
		FailWithStatus(w, http.StatusBadRequest, "虾集场景生成路由无效")
		return
	}
	var body dramaSceneGenerationBody
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "场景生成请求超过大小限制")
			return
		}
		FailWithStatus(w, http.StatusBadRequest, "场景生成请求格式无效")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		FailWithStatus(w, http.StatusBadRequest, "场景生成请求必须是单个 JSON 对象")
		return
	}
	switch operation {
	case "master", "reverse":
		if body.Source != "" {
			FailWithStatus(w, http.StatusBadRequest, "master/reverse 生成不接受 source 参数")
			return
		}
	case "pano":
		if (body.Source != "master" && body.Source != "text") || body.Model != "" {
			FailWithStatus(w, http.StatusBadRequest, "pano 生成需要 source=master 或 source=text")
			return
		}
	case "3gs-master", "3gs-reverse", "3gs-pano":
		if body.Source != "" || body.Model != "" {
			FailWithStatus(w, http.StatusBadRequest, "3GS 生成不接受额外参数")
			return
		}
	}
	data, err := client.StartDramaSceneGeneration(r.Context(), projectID, sceneName, operation, body.Source, body.Model)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "启动虾集场景生成失败")
		return
	}
	OK(w, data)
}

func DramaSceneTask(w http.ResponseWriter, r *http.Request, projectID, sceneName, operation string) {
	client := dramaSceneClient(w)
	if client == nil {
		return
	}
	if !validDramaSceneRouteSegment(projectID) || !validDramaSceneRouteSegment(sceneName) || !allowedDramaSceneGenerationOperations[operation] {
		FailWithStatus(w, http.StatusBadRequest, "虾集场景任务路由无效")
		return
	}
	query := r.URL.Query()
	for key := range query {
		if key != "source" {
			FailWithStatus(w, http.StatusBadRequest, "虾集场景任务查询参数无效")
			return
		}
	}
	source := query.Get("source")
	if operation != "pano" && source != "" {
		FailWithStatus(w, http.StatusBadRequest, "该场景任务不接受 source 参数")
		return
	}
	data, err := client.GetDramaSceneTask(r.Context(), projectID, sceneName, operation, source)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集场景任务状态失败")
		return
	}
	OK(w, data)
}

func DramaSceneUpload(w http.ResponseWriter, r *http.Request, projectID, sceneName, kind string) {
	if strings.TrimSpace(config.Cfg.DramaClawBaseURL) == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	if !validDramaSceneRouteSegment(projectID) || !validDramaSceneRouteSegment(sceneName) || !allowedDramaSceneFileKinds[kind] {
		FailWithStatus(w, http.StatusBadRequest, "虾集场景文件路由无效")
		return
	}
	maxBytes := config.Cfg.DramaClawUploadMaxBytes
	if maxBytes <= 0 {
		maxBytes = service.DefaultDramaUploadMaxBytes
	}
	requestLimit := maxBytes + (1 << 20)
	if requestLimit < maxBytes {
		requestLimit = maxBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, requestLimit)
	multipartReader, err := r.MultipartReader()
	if err != nil {
		writeDramaSceneMultipartError(w, err)
		return
	}
	part, err := multipartReader.NextPart()
	if err != nil {
		writeDramaSceneMultipartError(w, err)
		return
	}
	defer part.Close()
	filename := part.FileName()
	if part.FormName() != "file" || filename == "" {
		FailWithStatus(w, http.StatusBadRequest, "请选择场景文件")
		return
	}
	filename = path.Base(strings.ReplaceAll(filename, `\`, "/"))
	if kind == "custom" && !allowedDramaSceneCustomExtensions[strings.ToLower(path.Ext(filename))] {
		FailWithStatus(w, http.StatusBadRequest, "custom 场景文件只支持 .ply、.sog、.splat 或 .ksplat")
		return
	}
	contentType := part.Header.Get("Content-Type")
	if _, _, err := mime.ParseMediaType(contentType); err != nil {
		contentType = "application/octet-stream"
	}
	probeBytes := maxBytes
	if maxBytes < int64(^uint64(0)>>1) {
		probeBytes++
	}
	staged, err := os.CreateTemp("", "drama-scene-upload-*")
	if err != nil {
		FailWithStatus(w, http.StatusInternalServerError, "暂存虾集场景文件失败")
		return
	}
	defer func() {
		_ = staged.Close()
		_ = os.Remove(staged.Name())
	}()
	written, err := io.Copy(staged, io.LimitReader(part, probeBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "场景文件超过上传限制")
		} else {
			FailWithStatus(w, http.StatusBadRequest, "读取虾集场景文件失败")
		}
		return
	}
	if written > maxBytes {
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "场景文件超过上传限制")
		return
	}
	if _, err := staged.Seek(0, io.SeekStart); err != nil {
		FailWithStatus(w, http.StatusInternalServerError, "读取暂存虾集场景文件失败")
		return
	}
	client := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken)
	data, err := client.UploadDramaSceneFile(r.Context(), projectID, sceneName, kind, filename, contentType, staged, maxBytes)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.Is(err, service.ErrDramaUploadTooLarge) || errors.As(err, &tooLarge) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "场景文件超过上传限制")
			return
		}
		FailWithStatus(w, http.StatusBadGateway, "上传虾集场景文件失败")
		return
	}
	OK(w, data)
}

func DramaSceneFileDelete(w http.ResponseWriter, r *http.Request, projectID, sceneName, kind string) {
	client := dramaSceneClient(w)
	if client == nil {
		return
	}
	if !validDramaSceneRouteSegment(projectID) || !validDramaSceneRouteSegment(sceneName) || !allowedDramaSceneFileKinds[kind] {
		FailWithStatus(w, http.StatusBadRequest, "虾集场景文件路由无效")
		return
	}
	data, err := client.DeleteDramaSceneFile(r.Context(), projectID, sceneName, kind)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "删除虾集场景文件失败")
		return
	}
	OK(w, data)
}

func writeDramaSceneMultipartError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "场景文件超过上传限制")
		return
	}
	if errors.Is(err, io.EOF) {
		FailWithStatus(w, http.StatusBadRequest, "请选择场景文件")
		return
	}
	FailWithStatus(w, http.StatusBadRequest, "场景文件 multipart 表单无效")
}
