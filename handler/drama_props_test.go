package handler_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/handler"
)

func TestDramaPropReferenceHandlersKeepSourceTaskAndStatusFields(t *testing.T) {
	calls := 0
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			if r.Method != http.MethodPost || r.URL.Path != "/api/v1/projects/project-a/props/宝剑/reference/generate-async" {
				t.Errorf("source start route=%s %s", r.Method, r.URL.String())
			}
			body, _ := io.ReadAll(r.Body)
			if string(body) != `{}` {
				t.Errorf("source start body=%s", body)
			}
			_, _ = io.WriteString(w, `{"ok":true,"task_type":"prop_reference_asset","scope":"prop_ref__a87302d6d2cc","task_id":"prop-task-8","task_key":"source-key","backend":"celery","queue":"default","message":"queued"}`)
			return
		}
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/project-a/tasks/prop_reference_asset/0" || r.URL.Query().Get("scope") != "prop_ref__a87302d6d2cc" {
			t.Errorf("source status route=%s %s", r.Method, r.URL.String())
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":{"task_type":"prop_reference_asset","task_id":"prop-task-8","status":"failed","error":"provider unavailable","scope":"prop_ref__a87302d6d2cc"}}`)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	started := httptest.NewRecorder()
	handler.DramaPropReferenceGenerateAsync(started, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`)), "project-a", "宝剑")
	status := httptest.NewRecorder()
	handler.DramaPropReferenceTask(status, httptest.NewRequest(http.MethodGet, "/", nil), "project-a", "宝剑")

	var startEnvelope, statusEnvelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(started.Body.Bytes(), &startEnvelope); err != nil || started.Code != http.StatusOK || startEnvelope.Code != 0 {
		t.Fatalf("start status=%d body=%s err=%v", started.Code, started.Body, err)
	}
	if !strings.Contains(string(startEnvelope.Data), `"task_id":"prop-task-8"`) || strings.Contains(string(startEnvelope.Data), `"status"`) {
		t.Fatalf("start must preserve source id without inventing status: %s", startEnvelope.Data)
	}
	if err := json.Unmarshal(status.Body.Bytes(), &statusEnvelope); err != nil || status.Code != http.StatusOK || statusEnvelope.Code != 0 {
		t.Fatalf("status=%d body=%s err=%v", status.Code, status.Body, err)
	}
	for _, field := range []string{`"status":"failed"`, `"error":"provider unavailable"`, `"task_id":"prop-task-8"`} {
		if !strings.Contains(string(statusEnvelope.Data), field) {
			t.Fatalf("source status field %s missing: %s", field, statusEnvelope.Data)
		}
	}
	if calls != 2 {
		t.Fatalf("source calls=%d, want 2", calls)
	}
}

func TestDramaPropReferenceRejectsUnknownRequestFields(t *testing.T) {
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: "http://127.0.0.1:1"}
	defer func() { config.Cfg = previous }()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"model":"x","output_dir":"/tmp"}`))
	handler.DramaPropReferenceGenerateAsync(recorder, request, "project-a", "sword")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status=%d body=%s", recorder.Code, recorder.Body)
	}
}
