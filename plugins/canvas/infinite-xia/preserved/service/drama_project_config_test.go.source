package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDramaProjectConfigReadUsesAuthenticatedSourceProjectRoute(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/demo" {
			t.Fatalf("request=%s %s; want GET source project config", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer source-secret" {
			t.Fatalf("authorization=%q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"project_id":"demo","spine_template":"narrated","visual_style":"anime"}}`))
	}))
	defer source.Close()

	got, err := NewDramaClawClient(source.URL, "source-secret").GetProjectConfig(context.Background(), "demo")
	if err != nil {
		t.Fatalf("GetProjectConfig() error=%v", err)
	}
	var config map[string]any
	if err := json.Unmarshal(got, &config); err != nil {
		t.Fatalf("response is not a config object: %s", got)
	}
	if config["spine_template"] != "narrated" || config["project_id"] != "demo" {
		t.Fatalf("config=%v", config)
	}
}

func TestDramaProjectConfigPatchSendsOnlyWhitelistedSourceFields(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/v1/projects/demo" {
			t.Fatalf("request=%s %s; want PATCH source project config", r.Method, r.URL.Path)
		}
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode patch: %v", err)
		}
		if len(body) != 2 || string(body["spine_template"]) != `"narrated"` || string(body["add_subtitles"]) != "false" {
			t.Fatalf("patch=%s", mustJSON(t, body))
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"spine_template":"narrated","add_subtitles":false}}`))
	}))
	defer source.Close()

	got, err := NewDramaClawClient(source.URL, "").UpdateProjectConfig(context.Background(), "demo", json.RawMessage(`{"spine_template":"narrated","add_subtitles":false}`))
	if err != nil {
		t.Fatalf("UpdateProjectConfig() error=%v", err)
	}
	if !strings.Contains(string(got), `"spine_template":"narrated"`) {
		t.Fatalf("response=%s", got)
	}
}

func TestDramaProjectConfigPatchRejectsUnknownAndInvalidFieldsBeforeRequest(t *testing.T) {
	var requests int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		_, _ = w.Write([]byte(`{"ok":true,"data":{}}`))
	}))
	defer source.Close()
	client := NewDramaClawClient(source.URL, "")

	for _, patch := range []string{
		`{"scene_build_supported":false}`,
		`{"spine_template":"documentary"}`,
		`{"aspect_ratio":"1:1"}`,
		`{"add_subtitles":"false"}`,
		`[]`,
		`{}`,
		`{"visual_style":"anime"} {}`,
	} {
		if _, err := client.UpdateProjectConfig(context.Background(), "demo", json.RawMessage(patch)); err == nil {
			t.Errorf("patch %s was accepted", patch)
		}
	}
	if requests != 0 {
		t.Fatalf("invalid patches made %d upstream requests", requests)
	}
}

func TestDramaProjectConfigPreservesSourceBusinessStatusAndMessage(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"detail":"项目类型已锁定；如需切换请重新导入"}`))
	}))
	defer source.Close()

	_, err := NewDramaClawClient(source.URL, "").UpdateProjectConfig(context.Background(), "demo", json.RawMessage(`{"spine_template":"narrated"}`))
	var sourceErr *DramaProjectConfigSourceError
	if !errors.As(err, &sourceErr) {
		t.Fatalf("error type=%T, want DramaProjectConfigSourceError; err=%v", err, err)
	}
	if sourceErr.StatusCode != http.StatusUnprocessableEntity || sourceErr.Message != "项目类型已锁定；如需切换请重新导入" {
		t.Fatalf("source error=%+v", sourceErr)
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
