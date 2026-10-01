package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func sceneTestClient(t *testing.T, fn http.HandlerFunc) (*DramaClawClient, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(fn)
	t.Cleanup(server.Close)
	client := NewDramaClawClient(server.URL, "scene-test-token")
	client.HTTPClient = server.Client()
	return client, server
}

func sceneEnvelope(w http.ResponseWriter, data string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"ok":true,"data":`+data+`}`)
}

func TestGetDramaScenesUsesSummaryAndRepeatedDetailNames(t *testing.T) {
	requests := 0
	client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/drama-1/scenes" {
			t.Fatalf("unexpected source request: %s %s", r.Method, r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer scene-test-token" {
			t.Fatalf("authorization header was not forwarded")
		}
		switch requests {
		case 1:
			if r.URL.Query().Get("summary") != "true" || len(r.URL.Query()["names"]) != 0 {
				t.Fatalf("summary query mismatch: %v", r.URL.Query())
			}
		case 2:
			if r.URL.Query().Get("summary") != "false" || strings.Join(r.URL.Query()["names"], ",") != "室内主场景,雨夜变体" {
				t.Fatalf("detail query mismatch: %v", r.URL.Query())
			}
		default:
			t.Fatalf("unexpected request %d", requests)
		}
		sceneEnvelope(w, `[{"name":"室内主场景","master_url":"`+serverURLForRequest(r)+`/static/projects/drama-1/master.png","pano_url":"/static/projects/drama-1/pano.jpg","variant_id":"rain"}]`)
	})

	if _, err := client.GetDramaScenes(context.Background(), "drama-1", true, nil); err != nil {
		t.Fatal(err)
	}
	data, err := client.GetDramaScenes(context.Background(), "drama-1", false, []string{"室内主场景", "雨夜变体"})
	if err != nil {
		t.Fatal(err)
	}
	var scenes []map[string]any
	if err := json.Unmarshal(data, &scenes); err != nil {
		t.Fatal(err)
	}
	if requests != 2 || len(scenes) != 1 || scenes[0]["variant_id"] != "rain" {
		t.Fatalf("unexpected scene data: %s", data)
	}
	for _, key := range []string{"master_url", "pano_url"} {
		value, _ := scenes[0][key].(string)
		if !strings.HasPrefix(value, "/api/v1/drama/media?url=") {
			t.Fatalf("%s was not rewritten through the media proxy: %q", key, value)
		}
	}
}

func serverURLForRequest(r *http.Request) string {
	return "http://" + r.Host
}

func TestGetDramaScenePlatePreviewUsesSourceQuery(t *testing.T) {
	client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/project-a/scenes/plate-preview" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
		query := r.URL.Query()
		if query.Get("scene_id") != "hall" || query.Get("variant_id") != "rain" || query.Get("time_of_day") != "night" {
			t.Fatalf("plate preview query mismatch: %v", query)
		}
		sceneEnvelope(w, `{"scene_id":"hall","variant_id":"rain","time_of_day":"night","resolved_scene_name":"hall__rain__night","time_baked":true,"render":{"status":"time_baked"}}`)
	})
	data, err := client.GetDramaScenePlatePreview(context.Background(), "project-a", "hall", "rain", "night")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte(`"resolved_scene_name":"hall__rain__night"`)) {
		t.Fatalf("unexpected preview: %s", data)
	}
}

func TestDramaSceneBuildKeepsSourceTaskIdentityAndStatus(t *testing.T) {
	calls := 0
	client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch calls {
		case 1:
			body, _ := io.ReadAll(r.Body)
			if r.Method != http.MethodPost || r.URL.Path != "/api/v1/projects/project-a/scenes/build" || string(body) != `{}` {
				t.Fatalf("build request mismatch: %s %s body=%s", r.Method, r.URL.String(), body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true,"task_type":"build_scenes","task_id":"source-task-42","task_key":"source-key"}`)
		case 2:
			if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/project-a/tasks/build_scenes/0" {
				t.Fatalf("task query route mismatch: %s %s", r.Method, r.URL.String())
			}
			sceneEnvelope(w, `{"task_type":"build_scenes","task_id":"source-task-42","status":"running","progress":0.4}`)
		default:
			t.Fatalf("unexpected source request %d", calls)
		}
	})
	started, err := client.StartDramaSceneBuild(context.Background(), "project-a")
	if err != nil {
		t.Fatal(err)
	}
	var start map[string]any
	if err := json.Unmarshal(started, &start); err != nil {
		t.Fatal(err)
	}
	if start["task_id"] != "source-task-42" || start["task_type"] != "build_scenes" || start["status"] != nil {
		t.Fatalf("source build response was changed or a status was invented: %s", started)
	}
	state, err := client.GetDramaSceneBuildTask(context.Background(), "project-a")
	if err != nil {
		t.Fatal(err)
	}
	var task map[string]any
	if err := json.Unmarshal(state, &task); err != nil {
		t.Fatal(err)
	}
	if task["task_id"] != "source-task-42" || task["task_type"] != "build_scenes" || task["status"] != "running" || task["progress"] != 0.4 {
		t.Fatalf("source task state was not preserved: %s", state)
	}
}

func TestStartDramaSceneGenerationUsesOnlyConfirmedSourceRoutes(t *testing.T) {
	cases := []struct {
		operation string
		source    string
		model     string
		path      string
		body      string
	}{
		{"master", "", "", "/api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/master/generate-async", `{}`},
		{"reverse", "", "", "/api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/reverse/generate-async", `{}`},
		{"pano", "master", "", "/api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/pano/generate-async", `{"source":"master"}`},
		{"pano", "text", "", "/api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/pano/generate-async", `{"source":"text"}`},
		{"3gs-master", "", "", "/api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/3gs/master-ply/generate-async", ""},
		{"3gs-reverse", "", "", "/api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/3gs/reverse-ply/generate-async", ""},
		{"3gs-pano", "", "", "/api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/3gs/pano-ply/generate-async", ""},
		{"master", "", "image-selection", "/api/v1/projects/p/scenes/%E5%A4%A7%E5%AD%A6%E5%AE%BF%E8%88%8D/master/generate-async", `{"model":"image-selection"}`},
	}
	for _, tc := range cases {
		t.Run(tc.operation+"/"+tc.source+"/"+tc.model, func(t *testing.T) {
			client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.EscapedPath() != tc.path {
					t.Fatalf("source generation route mismatch: %s %s", r.Method, r.URL.EscapedPath())
				}
				body, _ := io.ReadAll(r.Body)
				if string(body) != tc.body {
					t.Fatalf("source generation body = %s, want %s", body, tc.body)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"ok":true,"task_type":"source-kind","task_id":"source-id","scope":"source-scope","task_key":"source-key"}`)
			})
			got, err := client.StartDramaSceneGeneration(context.Background(), "p", "大学宿舍", tc.operation, tc.source, tc.model)
			if err != nil {
				t.Fatal(err)
			}
			var response map[string]any
			if err := json.Unmarshal(got, &response); err != nil {
				t.Fatal(err)
			}
			for key, value := range map[string]any{"task_type": "source-kind", "task_id": "source-id", "scope": "source-scope", "task_key": "source-key"} {
				if response[key] != value {
					t.Fatalf("source task identity %s = %v; response=%s", key, response[key], got)
				}
			}
		})
	}
}

func TestGetDramaSceneTaskUsesSourceTaskTypeAndGoldenScope(t *testing.T) {
	cases := []struct {
		operation string
		source    string
		taskType  string
		scope     string
	}{
		{"master", "", "scene_reference_asset", "scene_ref__f126561a8bba"},
		{"reverse", "", "scene_reference_asset", "scene_ref__02e6e3b31892"},
		{"pano", "master", "scene_pano_generation", "stage_asset__0060da8d52de"},
		{"pano", "text", "scene_pano_generation", "stage_asset__03118b334715"},
		{"3gs-master", "", "stage_asset", "stage_asset__a1b352c6307b"},
		{"3gs-reverse", "", "stage_asset", "stage_asset__a1b352c6307b"},
		{"3gs-pano", "", "stage_asset", "stage_asset__f3813dfc19bc"},
	}
	for _, tc := range cases {
		t.Run(tc.operation+"/"+tc.source, func(t *testing.T) {
			client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				wantPath := "/api/v1/projects/p/tasks/" + tc.taskType + "/0"
				if r.Method != http.MethodGet || r.URL.Path != wantPath || r.URL.Query().Get("scope") != tc.scope {
					t.Fatalf("scene task query mismatch: %s %s, want path=%s scope=%s", r.Method, r.URL.String(), wantPath, tc.scope)
				}
				sceneEnvelope(w, `null`)
			})
			got, err := client.GetDramaSceneTask(context.Background(), "p", "大学宿舍", tc.operation, tc.source)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != "null" {
				t.Fatalf("source null task state changed: %s", got)
			}
		})
	}
}

func TestDramaSceneGenerationRejectsUnknownOperationsAndTaskScopes(t *testing.T) {
	requests := 0
	client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		sceneEnvelope(w, `null`)
	})
	for _, tc := range []struct{ operation, source string }{
		{"director-world", ""},
		{"pano", "reverse"},
		{"../master", ""},
	} {
		if _, err := client.StartDramaSceneGeneration(context.Background(), "p", "room", tc.operation, tc.source, ""); err == nil {
			t.Errorf("unsupported generation operation %q/%q should fail", tc.operation, tc.source)
		}
		if _, err := client.GetDramaSceneTask(context.Background(), "p", "room", tc.operation, tc.source); err == nil {
			t.Errorf("unsupported task operation %q/%q should fail", tc.operation, tc.source)
		}
	}
	if requests != 0 {
		t.Fatalf("invalid operations reached source: %d", requests)
	}
}

func TestUploadDramaSceneFileUsesSourceMultipartRoutes(t *testing.T) {
	for _, kind := range []string{"master", "pano", "custom"} {
		t.Run(kind, func(t *testing.T) {
			client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				want := "/api/v1/projects/project-a/scenes/%E5%AE%A4%E5%86%85/" + kind + "/upload"
				if r.Method != http.MethodPost || r.URL.EscapedPath() != want {
					t.Fatalf("upload route mismatch: %s %s", r.Method, r.URL.EscapedPath())
				}
				if r.Header.Get("Authorization") != "Bearer scene-test-token" {
					t.Fatal("missing source bearer token")
				}
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Fatal(err)
				}
				file, header, err := r.FormFile("file")
				if err != nil {
					t.Fatal(err)
				}
				defer file.Close()
				body, _ := io.ReadAll(file)
				if header.Filename != map[string]string{"master": "master.png", "pano": "pano.jpg", "custom": "scene.ply"}[kind] || string(body) != "payload-"+kind {
					t.Fatalf("multipart payload mismatch: filename=%q body=%q", header.Filename, body)
				}
				sceneEnvelope(w, `{"name":"室内","master_url":"/static/projects/project-a/master.png","pano_url":"/static/projects/project-a/pano.jpg","custom_scene_url":"/static/projects/project-a/custom.ply"}`)
			})
			filename := map[string]string{"master": "master.png", "pano": "pano.jpg", "custom": "scene.ply"}[kind]
			data, err := client.UploadDramaSceneFile(context.Background(), "project-a", "室内", kind, filename, "application/octet-stream", strings.NewReader("payload-"+kind), 1024)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(data, []byte(`"name":"室内"`)) {
				t.Fatalf("unexpected upload result: %s", data)
			}
		})
	}
}

func TestUploadDramaSceneFileRejectsUnsupportedKindAndOversizedStream(t *testing.T) {
	requests := 0
	client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		sceneEnvelope(w, `{"name":"scene"}`)
	})
	if _, err := client.UploadDramaSceneFile(context.Background(), "p", "s", "reverse", "x.png", "image/png", strings.NewReader("x"), 10); err == nil {
		t.Fatal("unsupported scene file kind should be rejected")
	}
	_, err := client.UploadDramaSceneFile(context.Background(), "p", "s", "master", "x.png", "image/png", strings.NewReader("12345"), 4)
	if !errors.Is(err, ErrDramaUploadTooLarge) {
		t.Fatalf("oversized upload error = %v, want ErrDramaUploadTooLarge", err)
	}
	if requests != 0 {
		t.Fatalf("invalid uploads reached upstream: %d requests", requests)
	}
}

func TestDeleteDramaSceneFileUsesExactSourceAction(t *testing.T) {
	for _, kind := range []string{"master", "pano", "custom"} {
		t.Run(kind, func(t *testing.T) {
			client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				want := "/api/v1/projects/project-a/scenes/room/" + kind + "/delete"
				if r.Method != http.MethodPost || r.URL.Path != want {
					t.Fatalf("delete route mismatch: %s %s", r.Method, r.URL.String())
				}
				body, _ := io.ReadAll(r.Body)
				if len(body) != 0 {
					t.Fatalf("source delete uses empty POST, got body %s", body)
				}
				sceneEnvelope(w, `{"deleted":true}`)
			})
			if _, err := client.DeleteDramaSceneFile(context.Background(), "project-a", "room", kind); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDramaSceneRoutesRejectUnsafeIDs(t *testing.T) {
	requests := 0
	client, _ := sceneTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		sceneEnvelope(w, `[]`)
	})
	if _, err := client.GetDramaScenes(context.Background(), "../escape", true, nil); err == nil {
		t.Fatal("unsafe project route segment should fail")
	}
	if _, err := client.GetDramaScenes(context.Background(), "p", false, []string{"../escape"}); err == nil {
		t.Fatal("unsafe scene name should fail")
	}
	if _, err := client.GetDramaScenePlatePreview(context.Background(), "p", "room", "../escape", ""); err == nil {
		t.Fatal("unsafe variant route segment should fail")
	}
	if _, err := client.DeleteDramaSceneFile(context.Background(), "p", "room", "unknown"); err == nil {
		t.Fatal("unsupported deletion kind should fail")
	}
	if requests != 0 {
		t.Fatalf("unsafe routes reached upstream: %d requests", requests)
	}
}
