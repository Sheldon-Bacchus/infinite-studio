package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

var dramaProjectNamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)

// DramaProjects returns the source-owned project summaries used by both the
// standalone Xiaji workspace and the in-canvas content picker.
func DramaProjects(w http.ResponseWriter, r *http.Request) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	projects, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetProjectSummaries(r.Context())
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集项目列表失败")
		return
	}
	OK(w, projects)
}

func DramaAssetCatalog(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	catalog, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetAssetCatalog(r.Context(), projectID)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集项目素材失败")
		return
	}
	OK(w, catalog)
}

func DramaAssetDomainList(w http.ResponseWriter, r *http.Request, projectID, domain string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	items, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetAssetDomainList(r.Context(), projectID, domain)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾塘素材分类失败")
		return
	}
	OK(w, items)
}

func readDramaAssetDomainBody(w http.ResponseWriter, r *http.Request, projectID, domain, name string, creating bool) (json.RawMessage, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "虾塘素材请求超过 1 MiB")
		} else {
			FailWithStatus(w, http.StatusBadRequest, "读取虾塘素材请求失败")
		}
		return nil, false
	}
	if err := service.ValidateDramaAssetDomainWrite(projectID, domain, name, body, creating); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return nil, false
	}
	return body, true
}

func DramaAssetDomainCreate(w http.ResponseWriter, r *http.Request, projectID, domain string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	body, ok := readDramaAssetDomainBody(w, r, projectID, domain, "", true)
	if !ok {
		return
	}
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).CreateAssetDomainItem(r.Context(), projectID, domain, body)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "新建虾塘素材失败")
		return
	}
	OK(w, result)
}

func DramaAssetDomainUpdate(w http.ResponseWriter, r *http.Request, projectID, domain, name string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	body, ok := readDramaAssetDomainBody(w, r, projectID, domain, name, false)
	if !ok {
		return
	}
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).UpdateAssetDomainItem(r.Context(), projectID, domain, name, body)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "更新虾塘素材失败")
		return
	}
	OK(w, result)
}

func DramaAssetDomainDelete(w http.ResponseWriter, r *http.Request, projectID, domain, name string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).DeleteAssetDomainItem(r.Context(), projectID, domain, name)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "删除虾塘素材失败")
		return
	}
	OK(w, result)
}

func DramaCharacterVoiceSamples(w http.ResponseWriter, r *http.Request, projectID, character string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetCharacterVoiceSamples(r.Context(), projectID, character)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取角色声线失败")
		return
	}
	OK(w, result)
}

func DramaNarratorVoice(w http.ResponseWriter, r *http.Request, projectID string, sources bool) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetNarratorVoice(r.Context(), projectID, sources)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取项目旁白声线失败")
		return
	}
	OK(w, result)
}

func dramaVoiceUploadFile(w http.ResponseWriter, r *http.Request) (multipart.File, *multipart.FileHeader, int64, bool) {
	maxBytes := config.Cfg.DramaClawUploadMaxBytes
	if maxBytes <= 0 {
		maxBytes = service.DefaultDramaUploadMaxBytes
	}
	requestLimit := maxBytes + (1 << 20)
	if requestLimit < maxBytes {
		requestLimit = maxBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, requestLimit)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "声线文件超过上传限制")
		} else {
			FailWithStatus(w, http.StatusBadRequest, "声线上传表单无效")
		}
		return nil, nil, 0, false
	}
	// Keep temporary multipart files until the caller finishes forwarding the
	// selected file to DramaClaw.
	file, header, err := r.FormFile("file")
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "请选择声线文件")
		return nil, nil, 0, false
	}
	if header.Size > maxBytes {
		_ = file.Close()
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "声线文件超过上传限制")
		return nil, nil, 0, false
	}
	return file, header, maxBytes, true
}

func DramaCharacterVoiceOperation(w http.ResponseWriter, r *http.Request, projectID, character, slot, operation string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	client := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken)
	var result json.RawMessage
	var err error
	if operation == "upload" {
		file, header, maxBytes, ok := dramaVoiceUploadFile(w, r)
		if !ok {
			return
		}
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}
		defer file.Close()
		result, err = client.UploadCharacterVoiceSample(r.Context(), projectID, character, slot, filepath.Base(header.Filename), header.Header.Get("Content-Type"), file, header.Size, maxBytes)
		if errors.Is(err, service.ErrDramaUploadTooLarge) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "声线文件超过上传限制")
			return
		}
	} else {
		body, readErr := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		if readErr != nil {
			FailWithStatus(w, http.StatusBadRequest, "读取角色声线参数失败")
			return
		}
		if len(body) == 0 {
			body = []byte(`{}`)
		}
		if validationErr := service.ValidateDramaCharacterVoiceOperation(projectID, character, slot, operation, body); validationErr != nil {
			FailWithStatus(w, http.StatusBadRequest, validationErr.Error())
			return
		}
		result, err = client.UpdateCharacterVoice(r.Context(), projectID, character, slot, operation, body)
	}
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "更新角色声线失败")
		return
	}
	OK(w, result)
}

func DramaNarratorVoiceOperation(w http.ResponseWriter, r *http.Request, projectID, operation string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	client := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken)
	var result json.RawMessage
	var err error
	if operation == "upload" {
		file, header, maxBytes, ok := dramaVoiceUploadFile(w, r)
		if !ok {
			return
		}
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}
		defer file.Close()
		result, err = client.UploadNarratorVoice(r.Context(), projectID, filepath.Base(header.Filename), header.Header.Get("Content-Type"), file, header.Size, maxBytes)
		if errors.Is(err, service.ErrDramaUploadTooLarge) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "声线文件超过上传限制")
			return
		}
	} else {
		body, readErr := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		if readErr != nil {
			FailWithStatus(w, http.StatusBadRequest, "读取项目声线参数失败")
			return
		}
		if len(body) == 0 {
			body = []byte(`{}`)
		}
		if validationErr := service.ValidateDramaNarratorVoiceOperation(projectID, operation, body); validationErr != nil {
			FailWithStatus(w, http.StatusBadRequest, validationErr.Error())
			return
		}
		result, err = client.UpdateNarratorVoice(r.Context(), projectID, operation, body)
	}
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "更新项目旁白声线失败")
		return
	}
	OK(w, result)
}

func DramaCreateProject(w http.ResponseWriter, r *http.Request) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	var payload struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil || !dramaProjectNamePattern.MatchString(payload.Name) {
		FailWithStatus(w, http.StatusBadRequest, "虾集项目名称须为 1-64 位英文、数字或下划线")
		return
	}
	project, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).CreateProject(r.Context(), payload.Name)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "新建虾集项目失败")
		return
	}
	OK(w, project)
}

func DramaProjectLifecycle(w http.ResponseWriter, r *http.Request, projectID, action string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	project, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).UpdateProjectLifecycle(r.Context(), projectID, action)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "更新虾集项目状态失败")
		return
	}
	OK(w, project)
}

// DramaImportCatalog reads a normalized, read-only import catalog from DramaClaw.
func DramaImportCatalog(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	var episode *int
	if value := r.URL.Query().Get("episode"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			FailWithStatus(w, http.StatusBadRequest, "episode 参数必须是正整数")
			return
		}
		episode = &parsed
	}
	var beat *int
	if value := r.URL.Query().Get("beat"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			FailWithStatus(w, http.StatusBadRequest, "beat 参数必须是正整数")
			return
		}
		if episode == nil {
			FailWithStatus(w, http.StatusBadRequest, "beat 参数必须与 episode 一起提供")
			return
		}
		beat = &parsed
	}
	catalog, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetImportCatalog(r.Context(), projectID, episode, beat)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集项目失败")
		return
	}
	OK(w, catalog)
}

// DramaMedia streams an authenticated DramaClaw media response through the canvas backend.
func DramaMedia(w http.ResponseWriter, r *http.Request) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	target := r.URL.Query().Get("url")
	if target == "" {
		Fail(w, "url 参数不能为空")
		return
	}
	response, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).FetchMedia(r.Context(), target)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集媒体失败")
		return
	}
	defer response.Body.Close()
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	if contentLength := response.Header.Get("Content-Length"); contentLength != "" {
		w.Header().Set("Content-Length", contentLength)
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	_, _ = io.Copy(w, response.Body)
}

// DramaCandidateUpload streams a user-selected media file to DramaClaw freezone uploads.
func DramaCandidateUpload(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
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
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "候选文件超过上传限制")
			return
		}
		FailWithStatus(w, http.StatusBadRequest, "候选上传表单无效")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "请选择候选素材文件")
		return
	}
	defer file.Close()
	if header.Size > maxBytes {
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "候选文件超过上传限制")
		return
	}
	contentType := header.Header.Get("Content-Type")
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).UploadCandidate(
		r.Context(), projectID, filepath.Base(header.Filename), contentType, file, header.Size, maxBytes,
	)
	if err != nil {
		if err == service.ErrDramaUploadTooLarge {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "候选文件超过上传限制")
			return
		}
		FailWithStatus(w, http.StatusBadGateway, "虾集候选上传失败")
		return
	}
	OK(w, result)
}

// DramaCreateIdentity creates a new character identity from a project-scoped candidate.
func DramaCreateIdentity(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	var payload service.DramaCreateIdentityRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "新建角色身份参数无效")
		return
	}
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).CreateIdentity(r.Context(), projectID, payload)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "虾集新建角色身份失败，请核对候选素材和角色数据")
		return
	}
	OK(w, result)
}

// DramaPushCandidate replaces a DramaClaw canonical slot from a project-scoped candidate.
func DramaPushCandidate(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	var payload service.DramaPushRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "素材替换参数无效")
		return
	}
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).PushCandidate(r.Context(), projectID, payload)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "虾集素材替换结果需核对；请刷新虾集素材目录后再决定是否重试")
		return
	}
	OK(w, result)
}

func DramaPushImpact(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	var payload struct {
		Target json.RawMessage `json:"target"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "素材目标参数无效")
		return
	}
	result, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetPushImpact(r.Context(), projectID, payload.Target)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集素材影响范围失败")
		return
	}
	OK(w, result)
}

// DramaAssetHistory lists and restores DramaClaw's character-specific asset history.
func DramaAssetHistory(w http.ResponseWriter, r *http.Request, projectID, character string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	client := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken)
	if r.Method == http.MethodGet {
		result, err := client.GetAssetHistory(r.Context(), projectID, character, r.URL.Query().Get("kind"), r.URL.Query().Get("identity_id"))
		if err != nil {
			FailWithStatus(w, http.StatusBadGateway, "读取虾集角色素材历史失败")
			return
		}
		OK(w, result)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		FailWithStatus(w, http.StatusMethodNotAllowed, "不支持的角色素材历史操作")
		return
	}
	var payload service.DramaAssetHistoryRestoreRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "恢复角色素材历史参数无效")
		return
	}
	result, err := client.RestoreAssetHistory(r.Context(), projectID, character, payload)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "恢复虾集角色素材历史失败")
		return
	}
	OK(w, result)
}
