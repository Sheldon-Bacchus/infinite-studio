package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

func DramaCharacterIdentities(w http.ResponseWriter, r *http.Request, projectID, character string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	if err := service.ValidateDramaIdentitySegments(projectID, character, ""); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "虾塘项目或角色参数无效")
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetCharacterIdentities(r.Context(), projectID, character)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾塘角色身份失败")
		return
	}
	OK(w, data)
}

func DramaCharacterIdentityCreate(w http.ResponseWriter, r *http.Request, projectID, character string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	payload, ok := readDramaIdentityPayload(w, r)
	if !ok {
		return
	}
	if err := service.ValidateDramaIdentitySegments(projectID, character, ""); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "虾塘项目或角色参数无效")
		return
	}
	if err := service.ValidateDramaIdentityPayload(payload, true); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).CreateCharacterIdentity(r.Context(), projectID, character, payload)
	if err != nil {
		writeDramaIdentityFailure(w, err, "虾集创建角色身份失败")
		return
	}
	OK(w, data)
}

func DramaCharacterIdentityUpdate(w http.ResponseWriter, r *http.Request, projectID, character, identityID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	payload, ok := readDramaIdentityPayload(w, r)
	if !ok {
		return
	}
	if err := service.ValidateDramaIdentitySegments(projectID, character, identityID); err != nil || identityID == "" {
		FailWithStatus(w, http.StatusBadRequest, "虾塘身份路径参数无效")
		return
	}
	if err := service.ValidateDramaIdentityPayload(payload, false); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).UpdateCharacterIdentity(r.Context(), projectID, character, identityID, payload)
	if err != nil {
		writeDramaIdentityFailure(w, err, "虾集更新角色身份失败")
		return
	}
	OK(w, data)
}

func DramaCharacterIdentityDelete(w http.ResponseWriter, r *http.Request, projectID, character, identityID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	if err := service.ValidateDramaIdentitySegments(projectID, character, identityID); err != nil || identityID == "" {
		FailWithStatus(w, http.StatusBadRequest, "虾塘身份路径参数无效")
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).DeleteCharacterIdentity(r.Context(), projectID, character, identityID)
	if err != nil {
		writeDramaIdentityFailure(w, err, "虾集删除角色身份失败")
		return
	}
	OK(w, data)
}

func DramaCharacterOperation(w http.ResponseWriter, r *http.Request, projectID, character, identityID string, operation service.DramaCharacterOperation) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	payload, ok := readDramaIdentityPayload(w, r)
	if !ok {
		return
	}
	if err := service.ValidateDramaCharacterOperation(projectID, character, identityID, operation, payload); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).StartDramaCharacterOperation(r.Context(), projectID, character, identityID, operation, payload)
	if err != nil {
		writeDramaIdentityFailure(w, err, "虾集角色任务提交失败")
		return
	}
	OK(w, data)
}

func DramaCharacterIdentityAttempts(w http.ResponseWriter, r *http.Request, projectID, character, identityID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetDramaIdentityAttempts(r.Context(), projectID, character, identityID)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾塘身份尝试次数失败")
		return
	}
	OK(w, data)
}

func DramaCharacterAssetUpload(w http.ResponseWriter, r *http.Request, projectID, character, identityID, identityName string, kind service.DramaCharacterAssetUploadKind) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	file, header, maxBytes, ok := dramaIdentityUploadFile(w, r)
	if !ok {
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	defer file.Close()
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).UploadDramaCharacterAsset(r.Context(), projectID, character, identityID, identityName, kind, filepath.Base(header.Filename), header.Header.Get("Content-Type"), file, header.Size, maxBytes)
	if errors.Is(err, service.ErrDramaUploadTooLarge) {
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "虾塘角色图片超过上传限制")
		return
	}
	if err != nil {
		writeDramaIdentityFailure(w, err, "虾集角色图片上传失败")
		return
	}
	OK(w, data)
}

func DramaCharacterIdentityAssetDelete(w http.ResponseWriter, r *http.Request, projectID, character, identityID string, kind service.DramaIdentityDeleteKind) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).DeleteDramaIdentityAsset(r.Context(), projectID, character, identityID, kind)
	if err != nil {
		writeDramaIdentityFailure(w, err, "虾集角色图片删除失败")
		return
	}
	OK(w, data)
}

func dramaIdentityUploadFile(w http.ResponseWriter, r *http.Request) (multipart.File, *multipart.FileHeader, int64, bool) {
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
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "虾塘角色图片超过上传限制")
		} else {
			FailWithStatus(w, http.StatusBadRequest, "虾塘角色图片上传表单无效")
		}
		return nil, nil, 0, false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "请选择要上传的角色图片")
		return nil, nil, 0, false
	}
	if header.Size > maxBytes {
		_ = file.Close()
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "虾塘角色图片超过上传限制")
		return nil, nil, 0, false
	}
	return file, header, maxBytes, true
}

func writeDramaIdentityFailure(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, service.ErrDramaIdentityWriteOutcomeUnknown) {
		FailWithStatus(w, http.StatusGatewayTimeout, "虾塘写入结果未知，请先重新读取角色与身份状态并在 DramaClaw 任务记录中核对；不要重复提交")
		return
	}
	FailWithStatus(w, http.StatusBadGateway, fallback)
}

func readDramaIdentityPayload(w http.ResponseWriter, r *http.Request) (json.RawMessage, bool) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "身份请求超过 64 KiB")
		} else {
			FailWithStatus(w, http.StatusBadRequest, "身份请求格式无效")
		}
		return nil, false
	}
	return json.RawMessage(data), true
}
