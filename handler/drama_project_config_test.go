package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
)

func TestDramaProjectConfigGetReturnsSourceConfig(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/demo" {
			t.Fatalf("request=%s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"project_id":"demo","visual_style":"anime"}}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaProjectConfigGet(recorder, httptest.NewRequest(http.MethodGet, "/", nil), "demo")
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"visual_style":"anime"`) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDramaProjectConfigPatchKeepsSourceBusinessError(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/v1/projects/demo" {
			t.Fatalf("request=%s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"detail":"项目类型已锁定；如需切换请重新导入"}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "source-secret"}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"spine_template":"narrated"}`))
	DramaProjectConfigPatch(recorder, request, "demo")
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "项目类型已锁定；如需切换请重新导入") {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDramaProjectConfigPatchRejectsUnknownFieldsAndBoundsBody(t *testing.T) {
	var requests int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		_, _ = w.Write([]byte(`{"ok":true,"data":{}}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	unknown := httptest.NewRecorder()
	DramaProjectConfigPatch(unknown, httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"owner_username":"admin"}`)), "demo")
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status=%d body=%s", unknown.Code, unknown.Body.String())
	}

	oversized := httptest.NewRecorder()
	DramaProjectConfigPatch(oversized, httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"visual_style":"`+strings.Repeat("x", 70<<10)+`"}`)), "demo")
	if oversized.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status=%d body=%s", oversized.Code, oversized.Body.String())
	}
	if requests != 0 {
		t.Fatalf("invalid requests reached source %d times", requests)
	}
}
