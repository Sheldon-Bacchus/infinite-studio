package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func TestDramaClawClientUploadsCandidateAsStream(t *testing.T) {
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength <= 10 || len(r.TransferEncoding) != 0 {
			t.Errorf("multipart request length=%d transfer-encoding=%v; want known content length", r.ContentLength, r.TransferEncoding)
		}
		if r.URL.Path != "/api/v1/projects/demo/freezone/upload" || r.Method != http.MethodPost {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		if err := r.ParseMultipartForm(1024); err != nil {
			t.Errorf("parse multipart: %v", err)
			http.Error(w, "invalid upload", http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			t.Errorf("file part: %v", err)
			http.Error(w, "missing file", http.StatusBadRequest)
			return
		}
		defer file.Close()
		body, _ := io.ReadAll(file)
		received = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"url":"/static/projects/demo/freezone/_uploads/frame.png?v=1","filename":"frame.png","size":10}}`))
	}))
	defer server.Close()

	client := NewDramaClawClient(server.URL, "secret")
	result, err := client.UploadCandidate(context.Background(), "demo", "frame.png", "image/png", strings.NewReader("0123456789"), 10, 10)
	if err != nil {
		t.Fatalf("upload candidate: %v", err)
	}
	if received != "0123456789" || result.URL != "/static/projects/demo/freezone/_uploads/frame.png?v=1" || result.Size != 10 {
		t.Fatalf("candidate upload result=%+v bytes=%q", result, received)
	}
}

func TestDramaClawClientUploadCandidateEnforcesLimitAndProjectScopedURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"url":"/static/projects/other/freezone/_uploads/frame.png","filename":"frame.png","size":11}}`))
	}))
	defer server.Close()

	client := NewDramaClawClient(server.URL, "")
	_, err := client.UploadCandidate(context.Background(), "demo", "frame.png", "image/png", strings.NewReader("0123456789x"), 11, 10)
	if !errors.Is(err, ErrDramaUploadTooLarge) {
		t.Fatalf("oversize error = %v, want ErrDramaUploadTooLarge", err)
	}
	_, err = client.UploadCandidate(context.Background(), "demo", "frame.png", "image/png", strings.NewReader("small"), 5, 10)
	if err == nil || !strings.Contains(err.Error(), "不属于当前项目") {
		t.Fatalf("cross-project candidate URL error = %v", err)
	}
}

func TestDramaClawClientCreatesIdentityFromProjectCandidate(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/projects/demo/freezone/assets/identities" || r.Method != http.MethodPost {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"character":"hero","identity_id":"hero_rain","identity_name":"rain","target_url":"/static/projects/demo/assets/hero/rain.png"}}`))
	}))
	defer server.Close()

	client := NewDramaClawClient(server.URL, "secret")
	result, err := client.CreateIdentity(context.Background(), "demo", DramaCreateIdentityRequest{
		SourceURL: "/static/projects/demo/freezone/_uploads/candidate.png?v=2", Character: "hero", IdentityName: "rain",
	})
	if err != nil {
		t.Fatalf("create identity: %v", err)
	}
	if received["source_url"] != server.URL+"/static/projects/demo/freezone/_uploads/candidate.png?v=2" || received["character"] != "hero" || result.IdentityID != "hero_rain" {
		t.Fatalf("identity request/result = %#v / %+v", received, result)
	}
	if strings.Contains(result.TargetURL, server.URL) || !strings.HasPrefix(result.TargetURL, "/api/v1/drama/media?url=") {
		t.Fatalf("identity URL was not kept behind the local media proxy: %q", result.TargetURL)
	}
}

func TestDramaClawClientPushValidatesProjectCandidateAndSanitizesResult(t *testing.T) {
	var received map[string]any
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/api/v1/projects/demo/freezone/push" {
			t.Errorf("path = %q", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"target_path":"/srv/private/portrait.png","target_url":"/static/projects/demo/assets/hero.png","backup":"C:\\private\\portrait_20260101.png","stale_marked":1,"affected_count":2}}`))
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")

	_, err := client.PushCandidate(context.Background(), "demo", DramaPushRequest{
		SourceURL: "/static/projects/other/freezone/_uploads/candidate.png",
		Target:    json.RawMessage(`{"kind":"portrait","character":"hero"}`),
	})
	if err == nil || requests != 0 {
		t.Fatalf("cross-project candidate error=%v upstream requests=%d", err, requests)
	}
	result, err := client.PushCandidate(context.Background(), "demo", DramaPushRequest{
		SourceURL: "/static/projects/demo/freezone/_uploads/candidate.png",
		Target:    json.RawMessage(`{"kind":"portrait","character":"hero"}`),
		MarkStale: true,
	})
	if err != nil {
		t.Fatalf("push candidate: %v", err)
	}
	if received["source_url"] != server.URL+"/static/projects/demo/freezone/_uploads/candidate.png" || received["mark_stale"] != true {
		t.Fatalf("push request = %#v", received)
	}
	if result.Backup == nil || *result.Backup != "portrait_20260101.png" || result.AffectedCount != 2 || result.StaleMarked != 1 {
		t.Fatalf("push result leaked or lost fields: %+v", result)
	}
	if strings.Contains(result.TargetURL, server.URL) || !strings.HasPrefix(result.TargetURL, "/api/v1/drama/media?url=") {
		t.Fatalf("push URL was not proxied: %q", result.TargetURL)
	}
}

func TestDramaClawClientListsAndRestoresCharacterAssetHistory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/demo/characters/hero/asset-history":
			if r.URL.Query().Get("kind") != "identity_portrait" || r.URL.Query().Get("identity_id") != "hero_rain" {
				t.Errorf("history query = %v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"kind":"identity_portrait","identity_id":"hero_rain","current_url":"` + serverURLForTest(r) + `/current.png","entries":[{"history_id":"_history/old.png","filename":"old.png","url":"` + serverURLForTest(r) + `/old.png","created_at":"2026-01-01","bytes":123}]}}`))
		case "/api/v1/projects/demo/characters/hero/asset-history/restore":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["history_id"] != "_history/old.png" || body["kind"] != "identity_portrait" {
				t.Errorf("restore body = %#v", body)
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"kind":"identity_portrait","identity_id":"hero_rain","restored":true,"url":"` + serverURLForTest(r) + `/current.png","backup_history_id":"previous.png"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")

	history, err := client.GetAssetHistory(context.Background(), "demo", "hero", "identity_portrait", "hero_rain")
	if err != nil {
		t.Fatalf("list asset history: %v", err)
	}
	if len(history.Entries) != 1 || !strings.HasPrefix(history.Entries[0].URL, "/api/v1/drama/media?url=") {
		t.Fatalf("history entries = %+v", history)
	}
	result, err := client.RestoreAssetHistory(context.Background(), "demo", "hero", DramaAssetHistoryRestoreRequest{Kind: "identity_portrait", IdentityID: "hero_rain", HistoryID: "_history/old.png"})
	if err != nil || !result.Restored || !strings.HasPrefix(result.URL, "/api/v1/drama/media?url=") {
		t.Fatalf("restore result=%+v err=%v", result, err)
	}
}

func TestDramaClawClientListsProjectSummariesThroughConfiguredAuth(t *testing.T) {
	var requested bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = true
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/summaries" || r.URL.Query().Get("status") != "all" {
			t.Errorf("request = %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
		}
		if r.Header.Get("Authorization") != "Bearer source-secret" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":[{"project_id":"rainy-night","name":"雨夜","status":"active","episode_count":2}]}`))
	}))
	defer server.Close()

	client := NewDramaClawClient(server.URL, "source-secret")
	summaries, err := client.GetProjectSummaries(context.Background())
	if err != nil {
		t.Fatalf("list project summaries: %v", err)
	}
	if !requested || !strings.Contains(string(summaries), `"project_id":"rainy-night"`) {
		t.Fatalf("requested=%v summaries=%s", requested, summaries)
	}
}

func TestDramaClawClientRejectsMalformedProjectSummaryPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"data":{"project_id":"not-an-array"}}`))
	}))
	defer server.Close()

	client := NewDramaClawClient(server.URL, "")
	if _, err := client.GetProjectSummaries(context.Background()); err == nil {
		t.Fatal("expected malformed project summary response to fail")
	}
}

func TestDramaClawClientCreatesAndArchivesProjectsUsingSourceRoutes(t *testing.T) {
	var created, archived bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer source-secret" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects":
			created = true
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["name"] != "new_story" {
				t.Errorf("create body = %#v", body)
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"id":"new_story","name":"new_story"}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects/archive_me/archive":
			archived = true
			_, _ = w.Write([]byte(`{"ok":true,"data":{"id":"archive_me","name":"archive_me","status":"archived"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "source-secret")

	if _, err := client.CreateProject(context.Background(), "new_story"); err != nil {
		t.Fatalf("create project: %v", err)
	}
	if _, err := client.UpdateProjectLifecycle(context.Background(), "archive_me", "archive"); err != nil {
		t.Fatalf("archive project: %v", err)
	}
	if !created || !archived {
		t.Fatalf("created=%v archived=%v", created, archived)
	}
}

func TestDramaClawClientRejectsUnsupportedProjectLifecycleAction(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { requests++ }))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")
	if _, err := client.UpdateProjectLifecycle(context.Background(), "demo", "anything"); err == nil || requests != 0 {
		t.Fatalf("err=%v upstream requests=%d", err, requests)
	}
}

func TestDramaClawClientAssetCatalogReadsOnlyProjectAssets(t *testing.T) {
	var paths []string
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/demo/freezone/assets" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":[{"id":"hero","tab":"characters","kind":"portrait","role":"character_portrait","label":"林雨","url":"` + source.URL + `/static/hero.png","exists":true,"media_type":"image"}]}`))
	}))
	defer source.Close()
	client := NewDramaClawClient(source.URL, "")

	catalog, err := client.GetAssetCatalog(context.Background(), "demo")
	if err != nil {
		t.Fatalf("read asset catalog: %v", err)
	}
	if len(paths) != 1 || paths[0] != "/api/v1/projects/demo/freezone/assets" {
		t.Fatalf("source requests = %v; want only the asset route", paths)
	}
	if catalog.Project.ID != "demo" || len(catalog.Assets) != 1 || !strings.HasPrefix(catalog.Assets[0].URL, "/api/v1/drama/media?url=") {
		t.Fatalf("asset catalog = %+v", catalog)
	}
}

func TestDramaClawClientReadsTypedAssetDomainLists(t *testing.T) {
	var paths []string
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/demo/characters":
			if r.URL.Query().Get("summary") != "true" {
				t.Errorf("character query=%v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"name":"林雨","portrait_url":"` + source.URL + `/static/portrait.png","history_url":"/api/v1/projects/demo/characters/林雨/asset-history"}]}`))
		case "/api/v1/projects/demo/scenes":
			if r.URL.Query().Get("summary") != "true" {
				t.Errorf("scene query=%v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"name":"车站","master_url":"` + source.URL + `/static/station.png"}]}`))
		case "/api/v1/projects/demo/props":
			if r.URL.Query().Get("summary") != "true" {
				t.Errorf("prop query=%v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"name":"红伞","reference_url":"` + source.URL + `/static/umbrella.png"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	client := NewDramaClawClient(source.URL, "")

	for _, domain := range []string{"characters", "scenes", "props"} {
		data, err := client.GetAssetDomainList(context.Background(), "demo", domain)
		if err != nil {
			t.Fatalf("read %s: %v", domain, err)
		}
		var items []map[string]any
		if err := json.Unmarshal(data, &items); err != nil || len(items) != 1 {
			t.Fatalf("%s data=%s err=%v", domain, data, err)
		}
		for key, value := range items[0] {
			if strings.HasSuffix(key, "_url") && key != "history_url" {
				if !strings.HasPrefix(value.(string), "/api/v1/drama/media?url=") {
					t.Fatalf("%s %s URL not proxied: %#v", domain, key, value)
				}
			}
		}
	}
	if len(paths) != 3 || paths[0] != "/api/v1/projects/demo/characters?summary=true" || paths[1] != "/api/v1/projects/demo/scenes?summary=true" || paths[2] != "/api/v1/projects/demo/props?summary=true" {
		t.Fatalf("source requests=%v", paths)
	}
	if _, err := client.GetAssetDomainList(context.Background(), "demo", "episodes"); err == nil {
		t.Fatal("unsupported domain must fail closed")
	}
}

func TestDramaClawClientWritesOnlyTypedAssetDomainCRUDRoutes(t *testing.T) {
	var paths []string
	var methods []string
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		methods = append(methods, r.Method)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects/demo/props" {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["name"] != "红伞" || body["prop_type"] != "object" {
				t.Errorf("create prop body=%#v", body)
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"name":"红伞","prop_type":"object"}}`))
			return
		}
		if r.Method == http.MethodPatch && r.URL.Path == "/api/v1/projects/demo/scenes/车站" {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["description"] != "雨夜站台" {
				t.Errorf("update scene body=%#v", body)
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"name":"车站","description":"雨夜站台"}}`))
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects/demo/characters/林雨/delete" {
			_, _ = w.Write([]byte(`{"ok":true,"data":{"deleted":true}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer source.Close()
	client := NewDramaClawClient(source.URL, "")

	if _, err := client.CreateAssetDomainItem(context.Background(), "demo", "props", json.RawMessage(`{"name":"红伞","prop_type":"object"}`)); err != nil {
		t.Fatalf("create prop: %v", err)
	}
	if _, err := client.UpdateAssetDomainItem(context.Background(), "demo", "scenes", "车站", json.RawMessage(`{"description":"雨夜站台"}`)); err != nil {
		t.Fatalf("update scene: %v", err)
	}
	if _, err := client.DeleteAssetDomainItem(context.Background(), "demo", "characters", "林雨"); err != nil {
		t.Fatalf("delete character: %v", err)
	}
	if strings.Join(methods, ",") != "POST,PATCH,POST" || strings.Join(paths, ",") != "/api/v1/projects/demo/props,/api/v1/projects/demo/scenes/车站,/api/v1/projects/demo/characters/林雨/delete" {
		t.Fatalf("source requests=%v %v", methods, paths)
	}
	if _, err := client.CreateAssetDomainItem(context.Background(), "demo", "episodes", json.RawMessage(`{"name":"x"}`)); err == nil {
		t.Fatal("unsupported domain must fail closed")
	}
	if _, err := client.CreateAssetDomainItem(context.Background(), "demo", "props", json.RawMessage(`{"name":"x","arbitrary_path":"/etc/passwd"}`)); err == nil {
		t.Fatal("unknown source fields must fail closed")
	}
	if _, err := client.UpdateAssetDomainItem(context.Background(), "demo", "props", "../secret", json.RawMessage(`{"name":"x"}`)); err == nil {
		t.Fatal("unsafe entity path must fail closed")
	}
}

func TestDramaClawClientReadsCharacterAndNarratorVoicePages(t *testing.T) {
	var paths []string
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/api/v1/projects/demo/characters/林雨/voice-samples":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"character":"林雨","slots":[{"slot":"default","url":"` + source.URL + `/static/voice.wav","required":true}]}}`))
		case "/api/v1/projects/demo/narrator-voice":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"source":"uploaded","reference_url":"` + source.URL + `/static/narrator.wav","is_first_person":false}}`))
		case "/api/v1/projects/demo/narrator-voice/sources":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"options":[{"label":"片段","path":"/private/source.wav","rel_path":"source.wav"}]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	client := NewDramaClawClient(source.URL, "")
	character, err := client.GetCharacterVoiceSamples(context.Background(), "demo", "林雨")
	if err != nil || !strings.Contains(string(character), "/api/v1/drama/media?url=") {
		t.Fatalf("character voice=%s err=%v", character, err)
	}
	narrator, err := client.GetNarratorVoice(context.Background(), "demo", false)
	if err != nil || !strings.Contains(string(narrator), "/api/v1/drama/media?url=") {
		t.Fatalf("narrator voice=%s err=%v", narrator, err)
	}
	sources, err := client.GetNarratorVoice(context.Background(), "demo", true)
	if err != nil || !strings.Contains(string(sources), "rel_path") {
		t.Fatalf("narrator sources=%s err=%v", sources, err)
	}
	if len(paths) != 3 {
		t.Fatalf("source paths=%v", paths)
	}
}

func TestDramaClawClientWritesExactCharacterAndNarratorVoiceOperations(t *testing.T) {
	var got []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"message":"updated"}}`))
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")

	operations := []struct {
		name, character, slot, operation, body, want string
	}{
		{"character record", "林雨", "default", "record", `{"data_url":"data:audio/webm;base64,AA=="}`, "POST /api/v1/projects/demo/characters/林雨/voice-samples/default/record"},
		{"character trim", "林雨", "youth", "trim", `{"source_path":"audio/voice.wav","start_seconds":1,"duration_seconds":3}`, "POST /api/v1/projects/demo/characters/林雨/voice-samples/youth/trim"},
		{"character delete", "林雨", "elder", "delete", `{}`, "POST /api/v1/projects/demo/characters/林雨/voice-samples/elder/delete"},
	}
	for _, operation := range operations {
		if _, err := client.UpdateCharacterVoice(context.Background(), "demo", operation.character, operation.slot, operation.operation, json.RawMessage(operation.body)); err != nil {
			t.Fatalf("%s: %v", operation.name, err)
		}
	}
	for _, operation := range []struct {
		name, operation, body, want string
	}{
		{"narrator record", "record", `{"data_url":"data:audio/webm;base64,AA=="}`, "POST /api/v1/projects/demo/narrator-voice/record"},
		{"narrator copy", "copy", `{"source_path":"audio/dialogue.wav"}`, "POST /api/v1/projects/demo/narrator-voice/copy"},
		{"narrator trim", "trim", `{"start_seconds":0,"duration_seconds":4}`, "POST /api/v1/projects/demo/narrator-voice/trim"},
		{"narrator delete", "delete", `{}`, "POST /api/v1/projects/demo/narrator-voice/delete"},
	} {
		if _, err := client.UpdateNarratorVoice(context.Background(), "demo", operation.operation, json.RawMessage(operation.body)); err != nil {
			t.Fatalf("%s: %v", operation.name, err)
		}
	}
	want := []string{
		"POST /api/v1/projects/demo/characters/林雨/voice-samples/default/record",
		"POST /api/v1/projects/demo/characters/林雨/voice-samples/youth/trim",
		"POST /api/v1/projects/demo/characters/林雨/voice-samples/elder/delete",
		"POST /api/v1/projects/demo/narrator-voice/record",
		"POST /api/v1/projects/demo/narrator-voice/copy",
		"POST /api/v1/projects/demo/narrator-voice/trim",
		"POST /api/v1/projects/demo/narrator-voice/delete",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("source operations=%v; want %v", got, want)
	}
	before := len(got)
	if _, err := client.UpdateCharacterVoice(context.Background(), "demo", "林雨", "default", "copy", json.RawMessage(`{"source_path":"x"}`)); err == nil {
		t.Fatal("character voice copy is unsupported and must fail closed")
	}
	if _, err := client.UpdateNarratorVoice(context.Background(), "demo", "unknown", json.RawMessage(`{}`)); err == nil {
		t.Fatal("unknown narrator operation must fail closed")
	}
	if _, err := client.UpdateCharacterVoice(context.Background(), "demo", "林雨", "../../x", "delete", json.RawMessage(`{}`)); err == nil {
		t.Fatal("unsafe voice slot must fail closed")
	}
	if len(got) != before {
		t.Fatalf("invalid voice operations reached source: %v", got[before:])
	}
}

func TestDramaClawClientUploadsVoiceFilesToTheSourceVoiceSlots(t *testing.T) {
	var gotPath string
	var gotFile, gotContentType string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Errorf("parse voice multipart: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		defer file.Close()
		body, _ := io.ReadAll(file)
		gotFile = string(body)
		gotContentType = header.Header.Get("Content-Type")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"slots":[{"slot":"default","path":"audio/voice.wav"}]}}`))
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")
	if _, err := client.UploadCharacterVoiceSample(context.Background(), "demo", "林雨", "default", "voice.wav", "audio/wav", strings.NewReader("voice-bytes"), 11, 100); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/api/v1/projects/demo/characters/林雨/voice-samples/default/upload" || gotFile != "voice-bytes" || gotContentType != "audio/wav" {
		t.Fatalf("upload path=%q file=%q type=%q", gotPath, gotFile, gotContentType)
	}
	if _, err := client.UploadNarratorVoice(context.Background(), "demo", "voice.wav", "audio/wav", strings.NewReader("large"), 5, 4); !errors.Is(err, ErrDramaUploadTooLarge) {
		t.Fatalf("oversized narrator voice err=%v", err)
	}
}

func TestDramaClawClientRejectsRestoreResponseWithoutRestoredFlag(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"data":{"kind":"portrait","restored":false}}`))
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")
	result, err := client.RestoreAssetHistory(context.Background(), "demo", "hero", DramaAssetHistoryRestoreRequest{Kind: "portrait", HistoryID: "old.png"})
	if err == nil || result.Restored {
		t.Fatalf("restore result=%+v err=%v; expected explicit failure", result, err)
	}
}

func TestDramaClawClientReadsPushImpactForValidatedTarget(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/api/v1/projects/demo/freezone/impact" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		var body map[string]map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["target"]["kind"] != "portrait" {
			t.Errorf("impact target = %#v", body)
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"target":{"kind":"portrait","character":"hero"},"affected_beats":[{"episode":1,"beat":2}],"affected_count":1}}`))
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")
	impact, err := client.GetPushImpact(context.Background(), "demo", json.RawMessage(`{"kind":"portrait","character":"hero"}`))
	if err != nil || impact.AffectedCount != 1 || len(impact.AffectedBeats) != 1 {
		t.Fatalf("impact=%+v err=%v", impact, err)
	}
	if _, err := client.GetPushImpact(context.Background(), "demo", json.RawMessage(`{"kind":"made_up","character":"hero"}`)); err == nil || requests != 1 {
		t.Fatalf("invalid target err=%v requests=%d", err, requests)
	}
}

func TestDramaClawWritebackDoesNotFollowRedirects(t *testing.T) {
	firstRequests := 0
	secondRequests := 0
	var second *httptest.Server
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		firstRequests++
		http.Redirect(w, r, second.URL+"/replayed", http.StatusTemporaryRedirect)
	}))
	second = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		secondRequests++
		_, _ = w.Write([]byte(`{"ok":true,"data":{"target_url":"/static/target.png"}}`))
	}))
	defer first.Close()
	defer second.Close()

	client := NewDramaClawClient(first.URL, "")
	_, err := client.CreateIdentity(context.Background(), "demo", DramaCreateIdentityRequest{
		SourceURL: "/static/projects/demo/freezone/_uploads/candidate.png", Character: "hero", IdentityName: "rain",
	})
	if err == nil || firstRequests != 1 || secondRequests != 0 {
		t.Fatalf("redirect err=%v first requests=%d replay requests=%d", err, firstRequests, secondRequests)
	}
}
func TestNormalizeDramaEpisodesPreservesCatalogFields(t *testing.T) {
	data := json.RawMessage(`[
		{
			"number": 1,
			"title": "雨夜相遇",
			"summary": "主角在车站第一次见面",
			"beat_count": 2,
			"identity_ids": ["hero", "heroine"],
			"scene_menu": ["station"],
			"prop_menu": ["umbrella"]
		}
	]`)

	episodes, err := normalizeDramaEpisodes(data)
	if err != nil {
		t.Fatalf("normalize episodes: %v", err)
	}
	if len(episodes) != 1 {
		t.Fatalf("expected one episode, got %d", len(episodes))
	}
	if episodes[0].Number != 1 || episodes[0].Title != "雨夜相遇" {
		t.Fatalf("unexpected episode identity: %+v", episodes[0])
	}
	if episodes[0].BeatCount != 2 || len(episodes[0].IdentityIDs) != 2 {
		t.Fatalf("episode metadata was not preserved: %+v", episodes[0])
	}
}

func TestDramaClawClientFetchesEpisodeBeatsAndBuildsRevision(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/demo/episodes":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"number":2,"title":"追车","summary":"雨夜追逐","beat_count":1}]}`))
		case "/api/v1/projects/demo/episodes/2/beats":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"beat_number":1,"title":"车站奔跑","content":"镜头跟随人物穿过站台","prompt":"cinematic rain","frame_url":"/media/frame.png","video_url":"/media/shot.mp4","audio_url":"/media/shot.wav","identity_ids":["hero"],"prop_ids":["umbrella"]}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewDramaClawClient(server.URL, "secret")
	episode := 2
	catalog, err := client.GetImportCatalog(context.Background(), "demo", &episode, nil)
	if err != nil {
		t.Fatalf("get import catalog: %v", err)
	}
	if catalog.SourceSnapshot.Revision == "" {
		t.Fatal("expected a source revision")
	}
	if len(catalog.Episodes) != 1 || len(catalog.Episodes[0].Beats) != 1 {
		t.Fatalf("expected selected episode beats, got %+v", catalog.Episodes)
	}
	beat := catalog.Episodes[0].Beats[0]
	if beat.Content == "" || beat.FrameURL == "" || len(beat.IdentityIDs) != 1 {
		t.Fatalf("beat fields were not normalized: %+v", beat)
	}
	if !strings.HasPrefix(beat.FrameURL, "/api/v1/drama/media?url=") {
		t.Fatalf("frame URL was not routed through the authenticated media proxy: %q", beat.FrameURL)
	}
}

func TestGetImportCatalogIncludesFreezoneAssets(t *testing.T) {
	assetResponse := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/demo/episodes":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"number":1,"title":"雨夜"}]}`))
		case "/api/v1/projects/demo/freezone/assets":
			assetResponse++
			label := "hero portrait"
			if assetResponse > 1 {
				label = "hero portrait revised"
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":[` +
				`{"id":"portrait:character_portrait:characters/hero.png","tab":"characters","kind":"portrait","role":"character_portrait","label":"` + label + `","url":"` + serverURLForTest(r) + `/static/hero.png","exists":true,"media_type":"image","meta":{"character":"hero"},"slot_target":{"kind":"portrait","character":"hero"},"pushable":true,"history_url":"/api/v1/projects/demo/characters/hero/asset-history","restore_url":"/api/v1/projects/demo/characters/hero/asset-history/restore"},` +
				`{"id":"portrait:character_portrait:characters/missing.png","tab":"characters","kind":"portrait","role":"character_portrait","label":"missing portrait","url":null,"exists":false,"media_type":"image","meta":{"character":"missing"},"pushable":false}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")

	first, err := client.GetImportCatalog(context.Background(), "demo", nil, nil)
	if err != nil {
		t.Fatalf("get first catalog: %v", err)
	}
	second, err := client.GetImportCatalog(context.Background(), "demo", nil, nil)
	if err != nil {
		t.Fatalf("get second catalog: %v", err)
	}
	if len(first.Assets) != 2 {
		t.Fatalf("assets = %d, want 2", len(first.Assets))
	}
	asset := first.Assets[0]
	if asset.Tab != "characters" || asset.Kind != "portrait" || asset.Role != "character_portrait" || asset.MediaType != "image" {
		t.Fatalf("asset classification was not preserved: %+v", asset)
	}
	if !asset.Exists || asset.URL == "" || strings.Contains(asset.URL, server.URL) {
		t.Fatalf("existing asset URL was not rewritten to the local media proxy: %+v", asset)
	}
	proxyURL, err := url.Parse(asset.URL)
	if err != nil || proxyURL.Path != "/api/v1/drama/media" || proxyURL.Query().Get("url") != server.URL+"/static/hero.png" {
		t.Fatalf("unexpected proxied asset URL %q", asset.URL)
	}
	missing := first.Assets[1]
	if missing.Exists || missing.URL != "" {
		t.Fatalf("missing asset concept must be retained without a usable URL: %+v", missing)
	}
	if asset.Pushable == nil || !*asset.Pushable || len(asset.SlotTarget) == 0 {
		t.Fatalf("write capability metadata was not preserved: %+v", asset)
	}
	if !asset.HistoryAvailable || !asset.RestoreAvailable {
		t.Fatalf("history capabilities were not preserved: %+v", asset)
	}
	encoded, err := json.Marshal(asset)
	if err != nil {
		t.Fatalf("marshal asset: %v", err)
	}
	if strings.Contains(string(encoded), "history_url") || strings.Contains(string(encoded), "/api/v1/projects/demo/characters") {
		t.Fatalf("upstream history URL leaked into the browser response: %s", encoded)
	}
	if first.SourceSnapshot.Revision == second.SourceSnapshot.Revision {
		t.Fatal("source revision did not change when freezone asset content changed")
	}
}

func TestGetImportCatalogIncludesBeatContext(t *testing.T) {
	var requestedQuery url.Values
	var failPath string
	contextResponse := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == failPath {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		switch r.URL.Path {
		case "/api/v1/projects/demo/episodes":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"number":3,"title":"第三集"}]}`))
		case "/api/v1/projects/demo/episodes/3/beats":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"episode":3,"beat_number":7,"title":"屋顶"}]}`))
		case "/api/v1/projects/demo/freezone/assets":
			_, _ = w.Write([]byte(`{"ok":true,"data":[]}`))
		case "/api/v1/projects/demo/freezone/assets/beat-context":
			requestedQuery = r.URL.Query()
			contextResponse++
			label := "屋顶画面"
			if contextResponse > 1 {
				label = "屋顶画面更新"
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"scope":{"episode":3,"beat":7},"episodes":[{"episode":3,"beats":[{"episode":3,"beat":7,"assets":[]}]}],"assets":[{"id":"beat:003:007:image:current_frame:frame.png","tab":"beats","kind":"image","role":"current_frame","label":"` + label + `","url":"` + serverURLForTest(r) + `/static/frame.png","exists":true,"media_type":"image","meta":{"episode":3,"beat":7}}]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewDramaClawClient(server.URL, "")
	episode, beat := 3, 7
	catalog, err := client.GetImportCatalog(context.Background(), "demo", &episode, &beat)
	if err != nil {
		t.Fatalf("get catalog with beat context: %v", err)
	}
	if requestedQuery.Get("episode") != "3" || requestedQuery.Get("beat") != "7" {
		t.Fatalf("beat-context query = %v, want episode=3 and beat=7", requestedQuery)
	}
	if len(catalog.BeatContextAssets) != 1 || catalog.BeatContextAssets[0].Meta["episode"] != float64(3) || catalog.BeatContextAssets[0].Meta["beat"] != float64(7) {
		t.Fatalf("beat-context asset scope was not preserved: %+v", catalog.BeatContextAssets)
	}
	if len(catalog.Warnings) != 0 {
		t.Fatalf("unexpected catalog warnings: %+v", catalog.Warnings)
	}
	updated, err := client.GetImportCatalog(context.Background(), "demo", &episode, &beat)
	if err != nil {
		t.Fatalf("get updated context catalog: %v", err)
	}
	if catalog.SourceSnapshot.Revision == updated.SourceSnapshot.Revision {
		t.Fatal("source revision did not change when beat-context asset content changed")
	}

	for _, failedEndpoint := range []string{
		"/api/v1/projects/demo/freezone/assets",
		"/api/v1/projects/demo/freezone/assets/beat-context",
	} {
		t.Run(failedEndpoint, func(t *testing.T) {
			failPath = failedEndpoint
			partial, err := client.GetImportCatalog(context.Background(), "demo", &episode, &beat)
			if err != nil {
				t.Fatalf("optional source failure should preserve the catalog: %v", err)
			}
			if len(partial.Episodes) != 1 || len(partial.Warnings) == 0 {
				t.Fatalf("partial catalog must retain episodes and report the failed source: %+v", partial)
			}
			if failedEndpoint == "/api/v1/projects/demo/freezone/assets" && len(partial.Assets) != 0 {
				t.Fatalf("failed assets endpoint must not be represented as successful data: %+v", partial.Assets)
			}
			if failedEndpoint == "/api/v1/projects/demo/freezone/assets/beat-context" && len(partial.Assets) != 0 {
				t.Fatalf("base asset catalog should still be available: %+v", partial.Assets)
			}
		})
	}
}

func serverURLForTest(r *http.Request) string {
	return "http://" + r.Host
}
