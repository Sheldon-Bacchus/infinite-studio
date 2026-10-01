package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func propReferenceTestClient(t *testing.T, fn http.HandlerFunc) *DramaClawClient {
	t.Helper()
	server := httptest.NewServer(fn)
	t.Cleanup(server.Close)
	client := NewDramaClawClient(server.URL, "scene-test-token")
	client.HTTPClient = server.Client()
	return client
}

func TestStartDramaPropReferencePreservesSourceTaskResponse(t *testing.T) {
	client := propReferenceTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/projects/project-a/props/宝剑/reference/generate-async" {
			t.Fatalf("source route mismatch: %s %s", r.Method, r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer scene-test-token" {
			t.Fatal("source API token was not forwarded")
		}
		body, err := io.ReadAll(r.Body)
		if err != nil || string(body) != `{"model":"banana-v2"}` {
			t.Fatalf("source body mismatch: %s (%v)", body, err)
		}
		_, _ = io.WriteString(w, `{"ok":true,"task_type":"prop_reference_asset","scope":"prop_ref__a87302d6d2cc","task_id":"source-task-9","task_key":"source-key-9","backend":"celery","queue":"default","message":"queued"}`)
	})

	response, err := client.StartDramaPropReference(context.Background(), "project-a", "宝剑", "banana-v2")
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"task_id":"source-task-9"`, `"task_type":"prop_reference_asset"`, `"scope":"prop_ref__a87302d6d2cc"`, `"backend":"celery"`} {
		if !strings.Contains(string(response), field) {
			t.Fatalf("source task field %s was not preserved: %s", field, response)
		}
	}
	if strings.Contains(string(response), `"status"`) {
		t.Fatalf("start response must not invent task status: %s", response)
	}
}

func TestGetDramaPropReferenceTaskUsesSourceScopeAndPreservesNotFoundResponse(t *testing.T) {
	client := propReferenceTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/project-a/tasks/prop_reference_asset/0" {
			t.Fatalf("task route mismatch: %s %s", r.Method, r.URL.String())
		}
		if got := r.URL.Query().Get("scope"); got != "prop_ref__a87302d6d2cc" {
			t.Fatalf("source task scope mismatch: %q", got)
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":null,"message":"Task not found"}`)
	})

	response, err := client.GetDramaPropReferenceTask(context.Background(), "project-a", "宝剑")
	if err != nil {
		t.Fatal(err)
	}
	if string(response) != `{"ok":true,"data":null,"message":"Task not found"}` {
		t.Fatalf("source null response/message must remain inspectable: %s", response)
	}
}

func TestDramaPropReferenceRejectsInvalidIdentifiersWithoutCallingSource(t *testing.T) {
	calls := 0
	client := propReferenceTestClient(t, func(http.ResponseWriter, *http.Request) { calls++ })
	if _, err := client.StartDramaPropReference(context.Background(), "../project", "sword", ""); err == nil {
		t.Fatal("expected invalid project id to be rejected")
	}
	if _, err := client.GetDramaPropReferenceTask(context.Background(), "project-a", "../sword"); err == nil {
		t.Fatal("expected invalid prop name to be rejected")
	}
	if calls != 0 {
		t.Fatalf("invalid identifiers reached source %d times", calls)
	}
}
