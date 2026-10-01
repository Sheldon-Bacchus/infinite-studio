package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

const dramaPropReferenceRequestLimit = 64 << 10

func dramaPropReferenceClient(w http.ResponseWriter) *service.DramaClawClient {
	if strings.TrimSpace(config.Cfg.DramaClawBaseURL) == "" {
		FailWithStatus(w, http.StatusServiceUnavailable, "未配置 DRAMACLAW_BASE_URL")
		return nil
	}
	return service.NewDramaClawClient(config.Cfg.DramaClawBaseURL, config.Cfg.DramaClawAPIToken)
}

// DramaPropReferenceGenerateAsync starts DramaClaw's source task for one
// existing prop and returns the source task response without adding local job
// fields or status values.
func DramaPropReferenceGenerateAsync(w http.ResponseWriter, r *http.Request, projectID, propName string) {
	client := dramaPropReferenceClient(w)
	if client == nil {
		return
	}
	if err := service.ValidateDramaPropReferenceSegments(projectID, propName); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	var payload struct {
		Model string `json:"model"`
	}
	if r.Body != nil {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, dramaPropReferenceRequestLimit))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
			FailWithStatus(w, http.StatusBadRequest, "虾集道具参考图参数无效")
			return
		} else if err == nil {
			var trailing any
			if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
				FailWithStatus(w, http.StatusBadRequest, "虾集道具参考图参数无效")
				return
			}
		}
	}
	data, err := client.StartDramaPropReference(r.Context(), projectID, propName, payload.Model)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "启动虾集道具参考图任务失败")
		return
	}
	OK(w, data)
}

// DramaPropReferenceTask refreshes the exact source task for the selected prop.
// Source data:null and its message are passed through unchanged.
func DramaPropReferenceTask(w http.ResponseWriter, r *http.Request, projectID, propName string) {
	client := dramaPropReferenceClient(w)
	if client == nil {
		return
	}
	if err := service.ValidateDramaPropReferenceSegments(projectID, propName); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := client.GetDramaPropReferenceTask(r.Context(), projectID, propName)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "读取虾集道具参考图任务状态失败")
		return
	}
	OK(w, data)
}
