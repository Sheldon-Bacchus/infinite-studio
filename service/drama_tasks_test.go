package service

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestDramaTaskRoutesKeepSourceSchemaAndServerAuthorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer source-secret" {
			t.Errorf("authorization=%q", r.Header.Get("Authorization"))
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/tasks":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"task_type":"scene_build","task_id":"task-1","task_key":"source-key","status":"running","progress":0.4,"episode":2,"beat_num":null,"scope":"scene:rain"}]}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/tasks/limits":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"default":{"limit":3,"active":1,"remaining":2,"user_limit":2,"user_active":1,"user_remaining":1}}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/tasks/scene_build/2":
			if r.URL.Query().Get("beat_num") != "4" || r.URL.Query().Get("scope") != "scene:rain" {
				t.Errorf("query=%v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"task_type":"scene_build","task_id":"task-1","status":"running","progress":0.4,"episode":2,"beat_num":4,"scope":"scene:rain"}}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/api/v1/projects/demo/tasks/scene_build/2":
			if r.URL.Query().Get("beat_num") != "4" || r.URL.Query().Get("scope") != "scene:rain" || r.URL.Query().Get("force") != "true" || r.URL.Query().Get("acknowledge_no_refund") != "true" {
				t.Errorf("cancel query=%v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"ok":true,"status":"cancelled","refund_eligible":false,"refund_status":"not_refunded"}`))
		default:
			t.Errorf("unexpected upstream request %s %s", r.Method, r.URL)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "source-secret")

	list, err := client.GetProjectTasks(context.Background(), "demo")
	if err != nil || !strings.Contains(string(list), `"task_id":"task-1"`) || !strings.Contains(string(list), `"task_type":"scene_build"`) {
		t.Fatalf("list=%s err=%v", list, err)
	}
	limits, err := client.GetProjectTaskLimits(context.Background(), "demo")
	if err != nil || !strings.Contains(string(limits), `"user_remaining":1`) {
		t.Fatalf("limits=%s err=%v", limits, err)
	}
	beat := 4
	task, err := client.GetProjectTask(context.Background(), "demo", "scene_build", 2, &beat, "scene:rain")
	if err != nil || !strings.Contains(string(task), `"progress":0.4`) {
		t.Fatalf("task=%s err=%v", task, err)
	}
	cancelled, err := client.CancelProjectTask(context.Background(), "demo", "scene_build", 2, &beat, "scene:rain", true, true)
	if err != nil || !strings.Contains(string(cancelled), `"refund_status":"not_refunded"`) {
		t.Fatalf("cancelled=%s err=%v", cancelled, err)
	}
}

func TestDramaTaskCancelPreservesSourceConflictStatusAndBody(t *testing.T) {
	wantBody := `{"ok":false,"status":"running","requires_confirmation":true,"refund_eligible":false,"message":"终止不会退还积分"}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(wantBody))
	}))
	defer server.Close()
	_, err := NewDramaClawClient(server.URL, "source-secret").CancelProjectTask(context.Background(), "demo", "video", 1, nil, "", false, false)
	var sourceErr *DramaTaskSourceError
	if !errors.As(err, &sourceErr) {
		t.Fatalf("error=%T %v, want DramaTaskSourceError", err, err)
	}
	if sourceErr.StatusCode != http.StatusConflict || string(sourceErr.Body) != wantBody || !strings.Contains(sourceErr.Message, "终止不会退还积分") {
		t.Fatalf("source error=%+v body=%s", sourceErr, sourceErr.Body)
	}
}

func TestDramaTaskSSEStreamsSourceEventsAndRequestCancellation(t *testing.T) {
	upstreamCancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/projects/demo/tasks/stream" || r.URL.Query().Get("snapshot") != "false" || r.Header.Get("Authorization") != "Bearer source-secret" {
			t.Errorf("request=%s %s auth=%q", r.Method, r.URL, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("ResponseWriter has no Flusher")
			return
		}
		_, _ = io.WriteString(w, "event: heartbeat\ndata: {\"ts\":1}\n\n")
		flusher.Flush()
		select {
		case <-r.Context().Done():
			close(upstreamCancelled)
			return
		case <-time.After(60 * time.Millisecond):
		}
		_, _ = io.WriteString(w, "event: heartbeat\ndata: {\"ts\":2}\n\n")
		flusher.Flush()
		<-r.Context().Done()
		close(upstreamCancelled)
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "source-secret")
	client.HTTPClient.Timeout = 20 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	response, err := client.OpenProjectTasksStream(ctx, "demo", url.Values{"snapshot": {"false"}})
	if err != nil {
		t.Fatalf("OpenProjectTasksStream() error=%v", err)
	}
	if response.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("content-type=%q", response.Header.Get("Content-Type"))
	}
	reader := bufio.NewReader(response.Body)
	for _, want := range []string{"event: heartbeat\n", "data: {\"ts\":1}\n", "\n"} {
		line, err := reader.ReadString('\n')
		if err != nil || line != want {
			t.Fatalf("first SSE line=%q want=%q err=%v", line, want, err)
		}
	}
	secondEvent := make(chan error, 1)
	go func() {
		line, err := reader.ReadString('\n')
		if err == nil && line != "event: heartbeat\n" {
			err = errors.New("unexpected second SSE event: " + line)
		}
		secondEvent <- err
	}()
	select {
	case err := <-secondEvent:
		if err != nil {
			cancel()
			t.Fatalf("SSE body timed out while stream remained open: %v", err)
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("SSE stream did not deliver the delayed heartbeat")
	}
	cancel()
	_ = response.Body.Close()
	select {
	case <-upstreamCancelled:
	case <-time.After(time.Second):
		t.Fatal("downstream cancellation did not cancel the upstream request")
	}
}

func TestDramaTaskSourceErrorsAreNotTreatedAsSuccessfulData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":false,"error":"Task not found"}`))
	}))
	defer server.Close()
	_, err := NewDramaClawClient(server.URL, "source-secret").GetProjectTasks(context.Background(), "demo")
	if err == nil {
		t.Fatal("expected source ok=false response to be rejected")
	}
}
