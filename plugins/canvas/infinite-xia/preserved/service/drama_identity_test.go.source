package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestCharacterIdentityCRUDUsesDramaClawContracts(t *testing.T) {
	var source *httptest.Server
	var methods, paths []string
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method)
		paths = append(paths, r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer configured-token" {
			t.Errorf("authorization=%q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			if r.URL.Path != "/api/v1/projects/demo/characters/林雨/identities" {
				t.Errorf("GET path=%q", r.URL.Path)
			}
			_, _ = io.WriteString(w, `{"ok":true,"data":[{"identity_id":"林雨_雨夜","identity_name":"雨夜","image_url":"`+source.URL+`/static/identity.png"}]}`)
		case http.MethodPost:
			assertDramaIdentityJSONBody(t, r, `{"identity_name":"雨夜","age_group":"青年","appearance_details":"黑色雨衣"}`)
			_, _ = io.WriteString(w, `{"ok":true,"data":{"identity_id":"林雨_雨夜","identity_name":"雨夜","image_url":"`+source.URL+`/static/identity.png"}}`)
		case http.MethodPatch:
			assertDramaIdentityJSONBody(t, r, `{"identity_name":"雨夜新版","appearance_details":"深色风衣","face_prompt":"短发","age_group":"青年","body_type":"修长"}`)
			_, _ = io.WriteString(w, `{"ok":true,"data":{"identity_id":"林雨_雨夜新版","identity_name":"雨夜新版","image_url":"`+source.URL+`/static/identity.png"}}`)
		case http.MethodDelete:
			body, _ := io.ReadAll(r.Body)
			if len(body) != 0 {
				t.Errorf("DELETE body=%s; want empty", body)
			}
			if r.URL.Path != "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜" {
				t.Errorf("DELETE path=%q", r.URL.Path)
			}
			_, _ = io.WriteString(w, `{"ok":true,"data":{"identity_id":"林雨_雨夜"}}`)
		default:
			t.Errorf("unexpected method %s", r.Method)
			http.Error(w, "unexpected", http.StatusMethodNotAllowed)
		}
	}))
	defer source.Close()
	client := &DramaClawClient{BaseURL: source.URL, APIToken: "configured-token", HTTPClient: source.Client()}

	list, err := client.GetCharacterIdentities(context.Background(), "demo", "林雨")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(list), source.URL+"/static/identity.png") || !strings.Contains(string(list), "/api/v1/drama/media?url=") {
		t.Fatalf("identity media URL was not proxied: %s", list)
	}
	created, err := client.CreateCharacterIdentity(context.Background(), "demo", "林雨", json.RawMessage(`{"identity_name":"雨夜","age_group":"青年","appearance_details":"黑色雨衣"}`))
	if err != nil || !strings.Contains(string(created), "/api/v1/drama/media?url=") {
		t.Fatalf("create response=%s err=%v", created, err)
	}
	updated, err := client.UpdateCharacterIdentity(context.Background(), "demo", "林雨", "林雨_雨夜", json.RawMessage(`{"identity_name":"雨夜新版","appearance_details":"深色风衣","face_prompt":"短发","age_group":"青年","body_type":"修长"}`))
	if err != nil || !strings.Contains(string(updated), "/api/v1/drama/media?url=") {
		t.Fatalf("update response=%s err=%v", updated, err)
	}
	if _, err := client.DeleteCharacterIdentity(context.Background(), "demo", "林雨", "林雨_雨夜"); err != nil {
		t.Fatal(err)
	}
	wantMethods := []string{http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete}
	wantPaths := []string{
		"/api/v1/projects/demo/characters/林雨/identities",
		"/api/v1/projects/demo/characters/林雨/identities",
		"/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜",
		"/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜",
	}
	if !reflect.DeepEqual(methods, wantMethods) || !reflect.DeepEqual(paths, wantPaths) {
		t.Fatalf("source calls=%v %v; want %v %v", methods, paths, wantMethods, wantPaths)
	}
}

func TestCharacterIdentityWritesRejectUnknownFieldsAndUnsafeSegments(t *testing.T) {
	calls := 0
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = io.WriteString(w, `{"ok":true,"data":{}}`)
	}))
	defer source.Close()
	client := &DramaClawClient{BaseURL: source.URL, HTTPClient: source.Client()}
	ctx := context.Background()
	invalid := []struct {
		name string
		call func() error
	}{
		{"create rejects schema-only field omitted from UI hook", func() error {
			_, err := client.CreateCharacterIdentity(ctx, "demo", "林雨", json.RawMessage(`{"identity_name":"雨夜","fish_voice_id":"voice"}`))
			return err
		}},
		{"create rejects unknown field", func() error {
			_, err := client.CreateCharacterIdentity(ctx, "demo", "林雨", json.RawMessage(`{"identity_name":"雨夜","admin":true}`))
			return err
		}},
		{"create requires identity name", func() error {
			_, err := client.CreateCharacterIdentity(ctx, "demo", "林雨", json.RawMessage(`{"age_group":"青年"}`))
			return err
		}},
		{"update rejects unknown field", func() error {
			_, err := client.UpdateCharacterIdentity(ctx, "demo", "林雨", "林雨_雨夜", json.RawMessage(`{"face_prompt":"短发","file_path":"../../secret"}`))
			return err
		}},
		{"update rejects empty body", func() error {
			_, err := client.UpdateCharacterIdentity(ctx, "demo", "林雨", "林雨_雨夜", json.RawMessage(`{}`))
			return err
		}},
		{"character rejects path separators", func() error { _, err := client.GetCharacterIdentities(ctx, "demo", "林/雨"); return err }},
		{"identity rejects path separators", func() error {
			_, err := client.DeleteCharacterIdentity(ctx, "demo", "林雨", "../identity")
			return err
		}},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
	if calls != 0 {
		t.Fatalf("invalid requests reached DramaClaw %d times", calls)
	}
}

func TestDramaCharacterTasksPreserveSourceTaskTypeAndTaskID(t *testing.T) {
	type call struct {
		method string
		path   string
		body   string
	}
	var calls []call
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls = append(calls, call{method: r.Method, path: r.URL.Path, body: string(body)})
		w.Header().Set("Content-Type", "application/json")
		taskType := map[string]string{
			"/api/v1/projects/demo/characters/build":                                       "build_characters",
			"/api/v1/projects/demo/characters/林雨/portrait-async":                           "character_portrait",
			"/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/generate-async":          "identity_image",
			"/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/portrait/generate-async": "character_portrait",
		}[r.URL.Path]
		if r.Method != http.MethodPost || taskType == "" {
			t.Errorf("unexpected source request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true,"task_type":"`+taskType+`","task_id":"task-123","scope":"source-scope"}`)
	}))
	defer source.Close()
	client := &DramaClawClient{BaseURL: source.URL, APIToken: "task-token", HTTPClient: source.Client()}

	cases := []struct {
		operation DramaCharacterOperation
		character string
		identity  string
		payload   string
		wantPath  string
		wantBody  string
		wantType  string
	}{
		{DramaCharacterBuild, "", "", `{}`, "/api/v1/projects/demo/characters/build", `{}`, "build_characters"},
		{DramaCharacterPortrait, "林雨", "", `{"model":"image-v1","ethnicity":"Chinese"}`, "/api/v1/projects/demo/characters/林雨/portrait-async", `{"model":"image-v1","ethnicity":"Chinese"}`, "character_portrait"},
		{DramaIdentityImage, "林雨", "林雨_雨夜", `{"style":"ink"}`, "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/generate-async", `{"style":"ink"}`, "identity_image"},
		{DramaIdentityPortrait, "林雨", "林雨_雨夜", `{}`, "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/portrait/generate-async", `{}`, "character_portrait"},
	}
	for _, tc := range cases {
		got, err := client.StartDramaCharacterOperation(context.Background(), "demo", tc.character, tc.identity, tc.operation, json.RawMessage(tc.payload))
		if err != nil {
			t.Fatalf("operation %q: %v", tc.operation, err)
		}
		var task struct {
			TaskType string `json:"task_type"`
			TaskID   string `json:"task_id"`
			Scope    string `json:"scope"`
		}
		if err := json.Unmarshal(got, &task); err != nil || task.TaskType != tc.wantType || task.TaskID != "task-123" || task.Scope != "source-scope" {
			t.Fatalf("operation %q task=%s err=%v", tc.operation, got, err)
		}
		last := calls[len(calls)-1]
		if last.method != http.MethodPost || last.path != tc.wantPath || last.body != tc.wantBody {
			t.Fatalf("operation %q request=%+v", tc.operation, last)
		}
	}
}

func TestDramaIdentityAttemptsAndImageDeletesUseSourceRoutes(t *testing.T) {
	var paths []string
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"ok":true,"data":{"image_attempts":4,"portrait_attempts":2}}`)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true,"data":{"deleted":true}}`)
	}))
	defer source.Close()
	client := &DramaClawClient{BaseURL: source.URL, HTTPClient: source.Client()}
	attempts, err := client.GetDramaIdentityAttempts(context.Background(), "demo", "林雨", "林雨_雨夜")
	if err != nil || string(attempts) != `{"image_attempts":4,"portrait_attempts":2}` {
		t.Fatalf("attempts=%s err=%v", attempts, err)
	}
	for _, kind := range []DramaIdentityDeleteKind{DramaIdentityImageDelete, DramaIdentityCostumeDelete} {
		if _, err := client.DeleteDramaIdentityAsset(context.Background(), "demo", "林雨", "林雨_雨夜", kind); err != nil {
			t.Fatalf("delete %q: %v", kind, err)
		}
	}
	want := []string{
		"GET /api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/attempts",
		"POST /api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/image/delete",
		"POST /api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/costume/delete",
	}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("source paths=%v; want %v", paths, want)
	}
}

func TestDramaCharacterAssetUploadsUseOnlySourceSlots(t *testing.T) {
	wantPaths := map[DramaCharacterAssetUploadKind]string{
		DramaCharacterPortraitUpload: "/api/v1/projects/demo/characters/林雨/portrait/upload",
		DramaIdentityImageUpload:     "/api/v1/projects/demo/characters/林雨/identities/雨夜/upload",
		DramaIdentityCostumeUpload:   "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/costume/upload",
		DramaIdentityPortraitUpload:  "/api/v1/projects/demo/characters/林雨/identities/林雨_雨夜/portrait/upload",
	}
	var seen []string
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.Path)
		reader, err := r.MultipartReader()
		if err != nil {
			t.Errorf("multipart request: %v", err)
			http.Error(w, "bad multipart", http.StatusBadRequest)
			return
		}
		part, err := reader.NextPart()
		if err != nil {
			t.Errorf("multipart file part: %v", err)
			http.Error(w, "missing file", http.StatusBadRequest)
			return
		}
		content, _ := io.ReadAll(part)
		if part.FormName() != "file" || part.FileName() != "face.png" || string(content) != "image-bytes" {
			t.Errorf("file part name=%q filename=%q content=%q", part.FormName(), part.FileName(), content)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true,"data":{"url":"/static/asset.png"}}`)
	}))
	defer source.Close()
	client := &DramaClawClient{BaseURL: source.URL, HTTPClient: source.Client()}
	for kind, path := range wantPaths {
		identityID, identityName := "", ""
		if kind == DramaIdentityImageUpload {
			identityName = "雨夜"
		} else if kind != DramaCharacterPortraitUpload {
			identityID = "林雨_雨夜"
		}
		result, err := client.UploadDramaCharacterAsset(context.Background(), "demo", "林雨", identityID, identityName, kind, "face.png", "image/png", strings.NewReader("image-bytes"), int64(len("image-bytes")), 1024)
		if err != nil || !strings.Contains(string(result), "/api/v1/drama/media?url=") {
			t.Fatalf("upload %q result=%s err=%v", kind, result, err)
		}
		if seen[len(seen)-1] != path {
			t.Fatalf("upload %q path=%q; want %q", kind, seen[len(seen)-1], path)
		}
	}
	if len(seen) != len(wantPaths) {
		t.Fatalf("upload calls=%v", seen)
	}
}

func TestDramaCharacterTaskTransportFailureIsOutcomeUnknown(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer source.Close()
	client := &DramaClawClient{BaseURL: source.URL, HTTPClient: source.Client()}
	_, err := client.StartDramaCharacterOperation(context.Background(), "demo", "", "", DramaCharacterBuild, json.RawMessage(`{}`))
	if !errors.Is(err, ErrDramaIdentityWriteOutcomeUnknown) {
		t.Fatalf("error=%v; expected an indeterminate write result", err)
	}
}

func assertDramaIdentityJSONBody(t *testing.T, r *http.Request, want string) {
	t.Helper()
	got, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	var gotValue, wantValue any
	if json.Unmarshal(got, &gotValue) != nil || json.Unmarshal([]byte(want), &wantValue) != nil || !reflect.DeepEqual(gotValue, wantValue) {
		t.Errorf("request body=%s; want %s", got, want)
	}
}
