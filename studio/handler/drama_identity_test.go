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
	"github.com/tigerowo/infinite-canvas/router"
)

func TestRegisterDramaIdentityRoutesUsesCharacterParamAndProxiesSourceMethods(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var source *httptest.Server
	var sourceCalls int
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sourceCalls++
		if r.Header.Get("Authorization") != "Bearer server-owned-token" {
			t.Errorf("upstream auth header=%q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/characters/林雨/identities":
			_, _ = io.WriteString(w, `{"ok":true,"data":[{"identity_id":"林雨_雨夜","identity_name":"雨夜","image_url":"`+source.URL+`/static/identity.png"}]}`)
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects/demo/characters/林雨/identities":
			assertIdentityRequestBody(t, r, `{"identity_name":"雨夜","age_group":"青年","appearance_details":"雨衣"}`)
			_, _ = io.WriteString(w, `{"ok":true,"data":{"identity_id":"林雨_雨夜","identity_name":"雨夜"}}`)
		case r.Method == http.MethodPatch && r.URL.Path == "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜":
			assertIdentityRequestBody(t, r, `{"body_type":"修长"}`)
			_, _ = io.WriteString(w, `{"ok":true,"data":{"identity_id":"林雨_雨夜","identity_name":"雨夜"}}`)
		case r.Method == http.MethodDelete && r.URL.Path == "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜":
			_, _ = io.WriteString(w, `{"ok":true,"data":{"identity_id":"林雨_雨夜"}}`)
		default:
			t.Errorf("unexpected source request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "server-owned-token"}
	defer func() { config.Cfg = previous }()

	engine := gin.New()
	router.RegisterDramaIdentityRoutes(engine.Group("/api/v1"))
	requests := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/v1/drama/projects/demo/characters/林雨/identities", ""},
		{http.MethodPost, "/api/v1/drama/projects/demo/characters/林雨/identities", `{"identity_name":"雨夜","age_group":"青年","appearance_details":"雨衣"}`},
		{http.MethodPatch, "/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜", `{"body_type":"修长"}`},
		{http.MethodDelete, "/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜", ""},
	}
	for _, item := range requests {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(item.method, item.path, strings.NewReader(item.body)))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s %s returned %d: %s", item.method, item.path, recorder.Code, recorder.Body.String())
		}
		if item.method == http.MethodGet && !bytes.Contains(recorder.Body.Bytes(), []byte("/api/v1/drama/media?url=")) {
			t.Fatalf("GET leaked upstream media URL: %s", recorder.Body.String())
		}
	}
	if sourceCalls != len(requests) {
		t.Fatalf("source calls=%d; want %d", sourceCalls, len(requests))
	}
	invalid := httptest.NewRecorder()
	engine.ServeHTTP(invalid, httptest.NewRequest(http.MethodPost, requests[1].path, strings.NewReader(`{"identity_name":"雨夜","fish_voice_id":"not-in-hook"}`)))
	if invalid.Code != http.StatusBadRequest || sourceCalls != len(requests) {
		t.Fatalf("unknown field status=%d source calls=%d body=%s", invalid.Code, sourceCalls, invalid.Body.String())
	}
}

func TestRegisterDramaIdentityRoutesExposesCharacterTasksAndAssetOperations(t *testing.T) {
	gin.SetMode(gin.TestMode)
	type sourceCall struct{ method, path string }
	var calls []sourceCall
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, sourceCall{r.Method, r.URL.Path})
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/attempts"):
			_, _ = io.WriteString(w, `{"ok":true,"data":{"image_attempts":5,"portrait_attempts":2}}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/build"):
			_, _ = io.WriteString(w, `{"ok":true,"task_type":"build_characters","task_id":"build-1"}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/portrait-async"):
			_, _ = io.WriteString(w, `{"ok":true,"task_type":"character_portrait","task_id":"portrait-1"}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/generate-async") && !strings.Contains(r.URL.Path, "/portrait/"):
			_, _ = io.WriteString(w, `{"ok":true,"task_type":"identity_image","task_id":"identity-1"}`)
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/portrait/generate-async"):
			_, _ = io.WriteString(w, `{"ok":true,"task_type":"character_portrait","task_id":"identity-portrait-1"}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/delete"):
			_, _ = io.WriteString(w, `{"ok":true,"data":{"deleted":true}}`)
		case r.Method == http.MethodPost && strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data"):
			if _, _, err := r.FormFile("file"); err != nil {
				t.Errorf("source upload has no file part: %v", err)
				http.Error(w, "missing file", http.StatusBadRequest)
				return
			}
			_, _ = io.WriteString(w, `{"ok":true,"data":{"image_url":"/static/image.png","portrait_url":"/static/portrait.png","costume_image_url":"/static/costume.png","portrait_image_url":"/static/identity-portrait.png"}}`)
		default:
			t.Errorf("unexpected source request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "server-owned-token", DramaClawUploadMaxBytes: 1024}
	defer func() { config.Cfg = previous }()
	engine := gin.New()
	router.RegisterDramaIdentityRoutes(engine.Group("/api/v1"))

	jsonRequests := []struct{ method, path, body, wantTaskType, wantTaskID string }{
		{http.MethodPost, "/api/v1/drama/projects/demo/characters/build", `{}`, "build_characters", "build-1"},
		{http.MethodPost, "/api/v1/drama/projects/demo/characters/林雨/portrait-async", `{"model":"image-v1"}`, "character_portrait", "portrait-1"},
		{http.MethodPost, "/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜/generate-async", `{}`, "identity_image", "identity-1"},
		{http.MethodPost, "/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜/portrait/generate-async", `{}`, "character_portrait", "identity-portrait-1"},
		{http.MethodGet, "/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜/attempts", "", "", ""},
		{http.MethodPost, "/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜/image/delete", "", "", ""},
		{http.MethodPost, "/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜/costume/delete", "", "", ""},
	}
	for _, item := range jsonRequests {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(item.method, item.path, strings.NewReader(item.body)))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s %s returned %d: %s", item.method, item.path, recorder.Code, recorder.Body.String())
		}
		var response struct {
			Code int            `json:"code"`
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("invalid BFF response: %s err=%v", recorder.Body.String(), err)
		}
		if item.wantTaskID != "" && (response.Data["task_type"] != item.wantTaskType || response.Data["task_id"] != item.wantTaskID) {
			t.Fatalf("task receipt=%v; want type=%s id=%s", response.Data, item.wantTaskType, item.wantTaskID)
		}
		if strings.HasSuffix(item.path, "/attempts") && (response.Data["image_attempts"] != float64(5) || response.Data["portrait_attempts"] != float64(2)) {
			t.Fatalf("attempts=%v", response.Data)
		}
	}

	uploads := []struct{ path, wantSource string }{
		{"/api/v1/drama/projects/demo/characters/林雨/portrait/upload", "/api/v1/projects/demo/characters/林雨/portrait/upload"},
		{"/api/v1/drama/projects/demo/characters/林雨/identities/by-name/雨夜/upload", "/api/v1/projects/demo/characters/林雨/identities/雨夜/upload"},
		{"/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜/costume/upload", "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/costume/upload"},
		{"/api/v1/drama/projects/demo/characters/林雨/identities/林雨_雨夜/portrait/upload", "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/portrait/upload"},
	}
	for _, item := range uploads {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "portrait.png")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write([]byte("image-bytes"))
		_ = writer.Close()
		request := httptest.NewRequest(http.MethodPost, item.path, &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte("code")) {
			t.Fatalf("upload %s returned %d: %s", item.path, recorder.Code, recorder.Body.String())
		}
		if got := calls[len(calls)-1].path; got != item.wantSource {
			t.Fatalf("upload path=%q; want %q", got, item.wantSource)
		}
	}
}

func TestDramaIdentityTaskRouteMarksServerFailureAsUnknownWrite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "upstream error", http.StatusServiceUnavailable)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()
	engine := gin.New()
	router.RegisterDramaIdentityRoutes(engine.Group("/api/v1"))
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/drama/projects/demo/characters/build", strings.NewReader(`{}`)))
	if recorder.Code != http.StatusGatewayTimeout || !strings.Contains(recorder.Body.String(), "写入结果未知") || !strings.Contains(recorder.Body.String(), "不要重复提交") {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func assertIdentityRequestBody(t *testing.T, r *http.Request, want string) {
	t.Helper()
	got, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	var gotValue, wantValue any
	if json.Unmarshal(got, &gotValue) != nil || json.Unmarshal([]byte(want), &wantValue) != nil || !equalIdentityJSON(gotValue, wantValue) {
		t.Errorf("body=%s; want %s", got, want)
	}
}

func equalIdentityJSON(a, b any) bool {
	left, errLeft := json.Marshal(a)
	right, errRight := json.Marshal(b)
	return errLeft == nil && errRight == nil && bytes.Equal(left, right)
}
