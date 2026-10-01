package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

func DramaProjectConfigGet(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).GetProjectConfig(r.Context(), projectID)
	if err != nil {
		writeDramaProjectConfigError(w, err, "读取虾集项目配置失败")
		return
	}
	OK(w, data)
}

func DramaProjectConfigPatch(w http.ResponseWriter, r *http.Request, projectID string) {
	if config.Cfg.DramaClawBaseURL == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, service.DramaProjectConfigMaxBytes))
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "虾集项目配置请求体超过 64 KiB")
		} else {
			FailWithStatus(w, http.StatusBadRequest, "读取虾集项目配置请求失败")
		}
		return
	}
	if err := service.ValidateDramaProjectConfigPatch(json.RawMessage(body)); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken).UpdateProjectConfig(r.Context(), projectID, json.RawMessage(body))
	if err != nil {
		writeDramaProjectConfigError(w, err, "保存虾集项目配置失败")
		return
	}
	OK(w, data)
}

func writeDramaProjectConfigError(w http.ResponseWriter, err error, fallback string) {
	var sourceError *service.DramaProjectConfigSourceError
	if errors.As(err, &sourceError) {
		status := sourceError.StatusCode
		if status < 400 || status >= 500 {
			status = http.StatusBadGateway
		}
		FailWithStatus(w, status, sourceError.Message)
		return
	}
	FailWithStatus(w, http.StatusBadGateway, fallback)
}
