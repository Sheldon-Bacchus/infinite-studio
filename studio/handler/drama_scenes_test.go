package handler_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/router"
)

func sceneUploadRequest(t *testing.T, filename string, content []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func TestDramaScenesListAndDetailKeepSourceQueryContract(t *testing.T) {
	var calls int
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/project-a/scenes" {
			t.Errorf("source request=%s %s", r.Method, r.URL.String())
		}
		switch calls {
		case 1:
			if r.URL.Query().Get("summary") != "true" || len(r.URL.Query()["names"]) != 0 {
				t.Errorf("summary query=%v", r.URL.Query())
			}
		case 2:
			if r.URL.Query().Get("summary") != "false" || strings.Join(r.URL.Query()["names"], ",") != "旧车站,雨夜版本" {
				t.Errorf("detail query=%v", r.URL.Query())
			}
		default:
			t.Errorf("unexpected source call %d", calls)
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":[{"name":"旧车站","master_url":"`+source.URL+`/static/master.png","pano_url":"/static/pano.jpg","base_scene_id":"city","variant_id":"rain","time_of_day":"night"}]}`)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "fixed-source-token"}
	defer func() { config.Cfg = previous }()

	list := httptest.NewRecorder()
	handler.DramaScenesList(list, httptest.NewRequest(http.MethodGet, "/?summary=true", nil), "project-a")
	detail := httptest.NewRecorder()
	handler.DramaScenesList(detail, httptest.NewRequest(http.MethodGet, "/?summary=false&names=%E6%97%A7%E8%BD%A6%E7%AB%99&names=%E9%9B%A8%E5%A4%9C%E7%89%88%E6%9C%AC", nil), "project-a")
	if list.Code != http.StatusOK || detail.Code != http.StatusOK || calls != 2 {
		t.Fatalf("list=%d detail=%d source calls=%d", list.Code, detail.Code, calls)
	}
	for _, recorder := range []*httptest.ResponseRecorder{list, detail} {
		if !bytes.Contains(recorder.Body.Bytes(), []byte(`/api/v1/drama/media?url=`)) || bytes.Contains(recorder.Body.Bytes(), []byte(source.URL+"/static/master.png")) {
			t.Fatalf("media URL was not kept same-origin: %s", recorder.Body.String())
		}
	}
}

func TestDramaScenePlatePreviewUsesSourceQueryAndKeepsPlateFields(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/project-a/scenes/plate-preview" {
			t.Errorf("source request=%s %s", r.Method, r.URL.String())
		}
		if q := r.URL.Query(); q.Get("scene_id") != "room" || q.Get("variant_id") != "rain" || q.Get("time_of_day") != "night" {
			t.Errorf("source query=%v", q)
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":{"scene_id":"room","variant_id":"rain","time_of_day":"night","resolved_scene_name":"room__rain__night","planned_scene_name":"","time_baked":true,"render":{"status":"time_baked","relight":false},"seedance2":{"prompt_time_of_day":"night"}}}`)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/?scene_id=room&variant_id=rain&time_of_day=night", nil)
	handler.DramaScenePlatePreview(recorder, request, "project-a")
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"resolved_scene_name":"room__rain__night"`)) || !bytes.Contains(recorder.Body.Bytes(), []byte(`"status":"time_baked"`)) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDramaSceneBuildAndRefreshKeepSourceTaskFields(t *testing.T) {
	var calls int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			if r.Method != http.MethodPost || r.URL.Path != "/api/v1/projects/project-a/scenes/build" {
				t.Errorf("build route=%s %s", r.Method, r.URL.String())
			}
			body, _ := io.ReadAll(r.Body)
			if string(body) != `{}` {
				t.Errorf("build body=%s", body)
			}
			_, _ = io.WriteString(w, `{"ok":true,"task_type":"build_scenes","task_id":"real-scene-task"}`)
			return
		}
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/project-a/tasks/build_scenes/0" {
			t.Errorf("task route=%s %s", r.Method, r.URL.String())
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":{"task_type":"build_scenes","task_id":"real-scene-task","status":"running","progress":0.3}}`)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	started := httptest.NewRecorder()
	handler.DramaSceneBuild(started, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`)), "project-a")
	state := httptest.NewRecorder()
	handler.DramaSceneBuildTask(state, httptest.NewRequest(http.MethodGet, "/", nil), "project-a")
	var startEnvelope, stateEnvelope struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(started.Body.Bytes(), &startEnvelope); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(state.Body.Bytes(), &stateEnvelope); err != nil {
		t.Fatal(err)
	}
	if started.Code != http.StatusOK || startEnvelope.Data["task_type"] != "build_scenes" || startEnvelope.Data["task_id"] != "real-scene-task" || startEnvelope.Data["status"] != nil {
		t.Fatalf("build response invented or dropped source fields: %s", started.Body.String())
	}
	if state.Code != http.StatusOK || stateEnvelope.Data["task_id"] != "real-scene-task" || stateEnvelope.Data["status"] != "running" || stateEnvelope.Data["progress"] != 0.3 {
		t.Fatalf("task state changed: %s", state.Body.String())
	}
}

func TestDramaSceneGenerationAndTaskRefreshProxyOperationIdentity(t *testing.T) {
	var requests []string
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.EscapedPath()+"?"+r.URL.RawQuery)
		if r.Method == http.MethodPost {
			body, _ := io.ReadAll(r.Body)
			if string(body) != `{"model":"selected-model"}` {
				t.Errorf("generation request body=%s", body)
			}
			_, _ = io.WriteString(w, `{"ok":true,"task_type":"scene_reference_asset","task_id":"source-task","scope":"scene_ref__f126561a8bba","task_key":"source-key"}`)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":{"task_type":"scene_reference_asset","task_id":"source-task","scope":"scene_ref__f126561a8bba","status":"running","progress":0.5}}`)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	router.RegisterDramaSceneRoutes(engine.Group("/api/v1"))
	start := httptest.NewRecorder()
	engine.ServeHTTP(start, httptest.NewRequest(http.MethodPost, "/api/v1/drama/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/generate/master", strings.NewReader(`{"model":"selected-model"}`)))
	state := httptest.NewRecorder()
	engine.ServeHTTP(state, httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/tasks/master", nil))
	var startedEnvelope, stateEnvelope struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(start.Body.Bytes(), &startedEnvelope); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(state.Body.Bytes(), &stateEnvelope); err != nil {
		t.Fatal(err)
	}
	if start.Code != http.StatusOK || startedEnvelope.Data["task_id"] != "source-task" || startedEnvelope.Data["scope"] != "scene_ref__f126561a8bba" {
		t.Fatalf("source generation identity was changed: status=%d body=%s", start.Code, start.Body.String())
	}
	if state.Code != http.StatusOK || stateEnvelope.Data["task_id"] != "source-task" || stateEnvelope.Data["status"] != "running" || stateEnvelope.Data["progress"] != 0.5 {
		t.Fatalf("source task state was changed: status=%d body=%s", state.Code, state.Body.String())
	}
	want := []string{
		"POST /api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/master/generate-async?",
		"GET /api/v1/projects/p/tasks/scene_reference_asset/0?scope=scene_ref__f126561a8bba",
	}
	if strings.Join(requests, "\n") != strings.Join(want, "\n") {
		t.Fatalf("unexpected source calls: %v", requests)
	}
}

func TestDramaSceneGenerationHandlerRejectsUnconfirmedPayloadFields(t *testing.T) {
	var requests int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		_, _ = io.WriteString(w, `{"ok":true,"task_id":"unexpected"}`)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	router.RegisterDramaSceneRoutes(engine.Group("/api/v1"))
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/drama/projects/p/scenes/room/generate/master", strings.NewReader(`{"model":"m","unexpected":"field"}`)))
	if recorder.Code != http.StatusBadRequest || requests != 0 {
		t.Fatalf("unconfirmed payload should fail before source request: status=%d requests=%d body=%s", recorder.Code, requests, recorder.Body.String())
	}
}

func TestDramaSceneUploadAndDeleteForwardOnlyAllowlistedSourceActions(t *testing.T) {
	var requests []string
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.EscapedPath())
		if r.Header.Get("Authorization") != "Bearer fixed-source-token" {
			t.Errorf("missing fixed source token")
		}
		if strings.HasSuffix(r.URL.Path, "/upload") {
			if err := r.ParseMultipartForm(1024); err != nil {
				t.Errorf("parse source multipart: %v", err)
			}
			file, header, err := r.FormFile("file")
			if err != nil {
				t.Errorf("source file missing: %v", err)
			} else {
				body, _ := io.ReadAll(file)
				_ = file.Close()
				if header.Filename != "master.png" || string(body) != "image-bytes" {
					t.Errorf("source file=%s %q", header.Filename, body)
				}
			}
			_, _ = io.WriteString(w, `{"ok":true,"data":{"name":"room","master_url":"/static/master.png"}}`)
			return
		}
		if r.Method != http.MethodPost {
			t.Errorf("delete method=%s", r.Method)
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":{"deleted":true}}`)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "fixed-source-token", DramaClawUploadMaxBytes: 100}
	defer func() { config.Cfg = previous }()

	upload := httptest.NewRecorder()
	handler.DramaSceneUpload(upload, sceneUploadRequest(t, "master.png", []byte("image-bytes")), "project-a", "room", "master")
	deleted := httptest.NewRecorder()
	handler.DramaSceneFileDelete(deleted, httptest.NewRequest(http.MethodPost, "/", nil), "project-a", "room", "master")
	wantUpload := "/api/v1/projects/project-a/scenes/room/master/upload"
	wantDelete := "/api/v1/projects/project-a/scenes/room/master/delete"
	if upload.Code != http.StatusOK || deleted.Code != http.StatusOK || len(requests) != 2 || requests[0] != "POST "+wantUpload || requests[1] != "POST "+wantDelete {
		t.Fatalf("upload=%d delete=%d requests=%v uploadBody=%s deleteBody=%s", upload.Code, deleted.Code, requests, upload.Body.String(), deleted.Body.String())
	}
	if !bytes.Contains(upload.Body.Bytes(), []byte(`/api/v1/drama/media?url=`)) || bytes.Contains(upload.Body.Bytes(), []byte(source.URL+"/static/master.png")) {
		t.Fatalf("uploaded media URL was not proxied: %s", upload.Body.String())
	}
}

func TestDramaSceneUploadRejectsOversizedAndUnsupportedFilesBeforeUpstream(t *testing.T) {
	var requests int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		_, _ = io.WriteString(w, `{"ok":true,"data":{}}`)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawUploadMaxBytes: 4}
	defer func() { config.Cfg = previous }()

	oversized := httptest.NewRecorder()
	handler.DramaSceneUpload(oversized, sceneUploadRequest(t, "master.png", []byte("12345")), "p", "s", "master")
	unsupportedKind := httptest.NewRecorder()
	handler.DramaSceneUpload(unsupportedKind, sceneUploadRequest(t, "x.png", []byte("x")), "p", "s", "reverse")
	unsupportedCustom := httptest.NewRecorder()
	handler.DramaSceneUpload(unsupportedCustom, sceneUploadRequest(t, "scene.zip", []byte("x")), "p", "s", "custom")
	if oversized.Code != http.StatusRequestEntityTooLarge || unsupportedKind.Code != http.StatusBadRequest || unsupportedCustom.Code != http.StatusBadRequest || requests != 0 {
		t.Fatalf("oversized=%d kind=%d extension=%d upstream=%d", oversized.Code, unsupportedKind.Code, unsupportedCustom.Code, requests)
	}
}

func TestRegisterDramaSceneRoutesMountsOnlyTheSceneSurface(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	router.RegisterDramaSceneRoutes(engine.Group("/api/v1"))
	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	want := []string{
		"GET /api/v1/drama/projects/:project/scenes",
		"GET /api/v1/drama/projects/:project/scenes/plate-preview",
		"POST /api/v1/drama/projects/:project/scenes/build",
		"GET /api/v1/drama/projects/:project/scenes/build-task",
		"POST /api/v1/drama/projects/:project/scenes/:name/generate/:operation",
		"GET /api/v1/drama/projects/:project/scenes/:name/tasks/:operation",
		"POST /api/v1/drama/projects/:project/scenes/:name/:kind/upload",
		"POST /api/v1/drama/projects/:project/scenes/:name/:kind/delete",
	}
	for _, route := range want {
		if !registered[route] {
			t.Errorf("missing scene route %s; registered=%v", route, registered)
		}
	}
}
