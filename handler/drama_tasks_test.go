package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
)

func withDramaTasksSource(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: server.URL, DramaClawAPIToken: "server-owned-token"}
	t.Cleanup(func() {
		config.Cfg = previous
		server.Close()
	})
}

func TestDramaProjectTasksGetAndLimitsExposeSourceDataEnvelope(t *testing.T) {
	withDramaTasksSource(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer server-owned-token" {
			t.Errorf("upstream Authorization=%q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/api/v1/projects/demo/tasks":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"task_type":"scene_build","task_id":"source-id","status":"running","progress":0.25,"episode":1,"scope":"scene:rain"}]}`))
		case "/api/v1/projects/demo/tasks/limits":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"default":{"limit":4,"active":1,"remaining":3,"user_limit":2,"user_active":1,"user_remaining":1}}}`))
		default:
			t.Errorf("unexpected upstream path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	})
	list := httptest.NewRecorder()
	DramaProjectTasks(list, httptest.NewRequest(http.MethodGet, "/", nil), "demo")
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"task_id":"source-id"`) || !strings.Contains(list.Body.String(), `"task_type":"scene_build"`) {
		t.Fatalf("list status=%d body=%s", list.Code, list.Body.String())
	}
	limits := httptest.NewRecorder()
	DramaProjectTaskLimits(limits, httptest.NewRequest(http.MethodGet, "/", nil), "demo")
	if limits.Code != http.StatusOK || !strings.Contains(limits.Body.String(), `"user_remaining":1`) {
		t.Fatalf("limits status=%d body=%s", limits.Code, limits.Body.String())
	}
}

func TestDramaProjectTaskGetForwardsOnlySourceTaskScope(t *testing.T) {
	withDramaTasksSource(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/projects/demo/tasks/scene_build/2" || r.URL.Query().Get("beat_num") != "5" || r.URL.Query().Get("scope") != "scene:rain" {
			t.Errorf("upstream request=%s %s", r.Method, r.URL)
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"task_type":"scene_build","task_id":"source-id","status":"running","progress":0.75,"episode":2,"beat_num":5,"scope":"scene:rain"}}`))
	})
	request := httptest.NewRequest(http.MethodGet, "/?beat_num=5&scope=scene%3Arain", nil)
	recorder := httptest.NewRecorder()
	DramaProjectTaskGet(recorder, request, "demo", "scene_build", 2)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"task_id":"source-id"`) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDramaProjectTaskCancelReturnsSource409ConflictForConfirmation(t *testing.T) {
	const conflict = `{"ok":false,"status":"running","requires_confirmation":true,"refund_eligible":false,"message":"任务已开始，终止不会退还积分"}`
	withDramaTasksSource(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Query().Get("scope") != "scene:rain" || r.URL.Query().Has("force") || r.URL.Query().Has("acknowledge_no_refund") {
			t.Errorf("upstream request=%s %s", r.Method, r.URL)
		}
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(conflict))
	})
	request := httptest.NewRequest(http.MethodDelete, "/?scope=scene%3Arain", nil)
	recorder := httptest.NewRecorder()
	DramaProjectTaskCancel(recorder, request, "demo", "scene_build", 2)
	var envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, recorder.Body.String())
	}
	if recorder.Code != http.StatusConflict || envelope.Code == 0 || !strings.Contains(string(envelope.Data), `"requires_confirmation":true`) || envelope.Msg != "任务已开始，终止不会退还积分" {
		t.Fatalf("status=%d envelope=%+v", recorder.Code, envelope)
	}
}

func TestDramaProjectTasksStreamFlushesAndCancelsUpstreamOnClientDisconnect(t *testing.T) {
	upstreamDone := make(chan struct{})
	withDramaTasksSource(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("snapshot") != "false" || r.Header.Get("Authorization") != "Bearer server-owned-token" {
			t.Errorf("upstream query=%v auth=%q", r.URL.Query(), r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		f := w.(http.Flusher)
		_, _ = io.WriteString(w, "event: heartbeat\ndata: {\"ts\":1}\n\n")
		f.Flush()
		<-r.Context().Done()
		close(upstreamDone)
	})
	downstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		DramaProjectTasksStream(w, r, "demo")
	}))
	defer downstream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, downstream.URL+"/?snapshot=false", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := downstream.Client().Do(request)
	if err != nil {
		t.Fatalf("open downstream stream: %v", err)
	}
	if response.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("content-type=%q", response.Header.Get("Content-Type"))
	}
	reader := bufio.NewReader(response.Body)
	for _, want := range []string{"event: heartbeat\n", "data: {\"ts\":1}\n", "\n"} {
		line, err := reader.ReadString('\n')
		if err != nil || line != want {
			cancel()
			t.Fatalf("SSE line=%q want=%q err=%v", line, want, err)
		}
	}
	cancel()
	_ = response.Body.Close()
	select {
	case <-upstreamDone:
	case <-time.After(time.Second):
		t.Fatal("downstream disconnect did not cancel source stream")
	}
}
