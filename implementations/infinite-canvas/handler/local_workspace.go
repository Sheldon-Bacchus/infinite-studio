package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

func LocalCanvasProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := service.CurrentLocalCanvasProjects(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, projects)
}

func SaveLocalCanvasProject(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Data     json.RawMessage `json:"data"`
		Expected json.RawMessage `json:"expected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Data) == 0 || len(request.Expected) == 0 {
		Fail(w, "画布数据或读取基线无效")
		return
	}
	project, err := service.SaveLocalCanvasProject(r.Context(), request.Data, request.Expected)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, project)
}

func SyncLocalCanvasProjects(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Projects         []json.RawMessage          `json:"projects"`
		ExpectedProjects map[string]json.RawMessage `json:"expectedProjects"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "画布项目参数无效")
		return
	}
	projects, err := service.SyncLocalCanvasProjects(r.Context(), request.Projects, request.ExpectedProjects)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, projects)
}

func ImportLocalCanvasProjects(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Projects []json.RawMessage `json:"projects"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "画布项目参数无效")
		return
	}
	projects, err := service.ImportLocalCanvasProjects(r.Context(), request.Projects)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, projects)
}

func DeleteLocalCanvasProjects(w http.ResponseWriter, r *http.Request) {
	var request struct {
		IDs              []string                   `json:"ids"`
		ExpectedProjects map[string]json.RawMessage `json:"expectedProjects"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "画布项目参数无效")
		return
	}
	if err := service.DeleteLocalCanvasProjects(r.Context(), request.IDs, request.ExpectedProjects); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

func LocalWorkspaceAssets(w http.ResponseWriter, r *http.Request) {
	assets, err := service.CurrentLocalWorkspaceAssets(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, assets)
}

func SyncLocalWorkspaceAssets(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Assets []json.RawMessage `json:"assets"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "本地素材参数无效")
		return
	}
	assets, err := service.SyncLocalWorkspaceAssets(r.Context(), request.Assets)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, assets)
}

func DeleteLocalWorkspaceAssets(w http.ResponseWriter, r *http.Request) {
	var request struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "本地素材参数无效")
		return
	}
	if err := service.DeleteLocalWorkspaceAssets(r.Context(), request.IDs); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

func UploadLocalFile(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 512*1024*1024)
	file, header, err := r.FormFile("file")
	if err != nil {
		Fail(w, "请选择要上传的文件")
		return
	}
	defer file.Close()
	var source io.Reader = file
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if contentType == "" {
		headerBytes := make([]byte, 512)
		read, readErr := io.ReadFull(file, headerBytes)
		if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
			FailError(w, readErr)
			return
		}
		contentType = http.DetectContentType(headerBytes[:read])
		source = io.MultiReader(bytes.NewReader(headerBytes[:read]), file)
	}
	object, err := service.UploadLocalStorageReader(header.Filename, contentType, source)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, object)
}

func DeleteLocalFile(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteLocalStorageObject(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
