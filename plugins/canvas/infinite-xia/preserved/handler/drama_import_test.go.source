package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
)

func multipartFileRequest(t *testing.T, content []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "frame.png")
	if err != nil {
		t.Fatalf("create upload part: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write upload part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close upload form: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/drama/projects/demo/freezone/upload", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func TestDramaCandidateUploadStreamsMultipartWithConfiguredAuth(t *testing.T) {
	var received string
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/projects/demo/freezone/upload" || r.Header.Get("Authorization") != "Bearer source-secret" {
			http.Error(w, "bad upstream request", http.StatusUnauthorized)
			return
		}
		if err := r.ParseMultipartForm(1024); err != nil {
			http.Error(w, "bad multipart", http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "missing file", http.StatusBadRequest)
			return
		}
		defer file.Close()
		content, _ := io.ReadAll(file)
		received = string(content)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"url":"/static/projects/demo/freezone/_uploads/frame.png?v=1","filename":"frame.png","size":10}}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "source-secret", DramaClawUploadMaxBytes: 10}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaCandidateUpload(recorder, multipartFileRequest(t, []byte("0123456789")), "demo")
	if recorder.Code != http.StatusOK || received != "0123456789" {
		t.Fatalf("status=%d upstream bytes=%q body=%s", recorder.Code, received, recorder.Body.String())
	}
	if bytes.Contains(recorder.Body.Bytes(), []byte("source-secret")) {
		t.Fatalf("upstream credential leaked in response: %s", recorder.Body.String())
	}
}

func TestDramaCandidateUploadRejectsOversizeBeforeUpstream(t *testing.T) {
	var upstreamRequests int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		upstreamRequests++
		http.Error(w, "unexpected", http.StatusInternalServerError)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawUploadMaxBytes: 4}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaCandidateUpload(recorder, multipartFileRequest(t, []byte("12345")), "demo")
	if recorder.Code != http.StatusRequestEntityTooLarge || upstreamRequests != 0 {
		t.Fatalf("status=%d upstream requests=%d body=%s", recorder.Code, upstreamRequests, recorder.Body.String())
	}
}

func TestDramaCandidateUploadReturns413WhenMultipartBodyLimitIsExceeded(t *testing.T) {
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: "http://127.0.0.1:1", DramaClawUploadMaxBytes: 4}
	defer func() { config.Cfg = previous }()
	request := multipartFileRequest(t, make([]byte, (1<<20)+32))
	recorder := httptest.NewRecorder()
	DramaCandidateUpload(recorder, request, "demo")
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s; want 413", recorder.Code, recorder.Body.String())
	}
}

func TestDramaMediaStreamsConfiguredSourceWithAuth(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("png-bytes"))
	}))
	defer source.Close()

	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "secret"}
	defer func() { config.Cfg = previous }()

	request := httptest.NewRequest(http.MethodGet, "/api/v1/drama/media?url="+url.QueryEscape(source.URL+"/frame.png"), nil)
	recorder := httptest.NewRecorder()
	DramaMedia(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if recorder.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content type = %q, want image/png", recorder.Header().Get("Content-Type"))
	}
	body, err := io.ReadAll(recorder.Result().Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if string(body) != "png-bytes" {
		t.Fatalf("body = %q, want png-bytes", string(body))
	}
}

func TestDramaImportCatalogIncludesAssets(t *testing.T) {
	var contextEpisode, contextBeat string
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/demo/episodes":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"number":4,"title":"第四集"}]}`))
		case "/api/v1/projects/demo/episodes/4/beats":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"episode":4,"beat_number":2,"title":"夜景"}]}`))
		case "/api/v1/projects/demo/freezone/assets":
			_, _ = w.Write([]byte(`{"ok":true,"data":[{"id":"portrait:hero","tab":"characters","kind":"portrait","role":"character_portrait","label":"主角","url":"http://` + r.Host + `/portrait.png","exists":true,"media_type":"image","meta":{"character":"hero"}}]}`))
		case "/api/v1/projects/demo/freezone/assets/beat-context":
			contextEpisode = r.URL.Query().Get("episode")
			contextBeat = r.URL.Query().Get("beat")
			_, _ = w.Write([]byte(`{"ok":true,"data":{"scope":{"episode":4,"beat":2},"assets":[{"id":"beat:4:2","tab":"beats","kind":"image","role":"current_frame","label":"分镜图","url":"http://` + r.Host + `/frame.png","exists":true,"media_type":"image","meta":{"episode":4,"beat":2}}]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()

	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	request := httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects/demo/import-catalog?episode=4&beat=2", nil)
	recorder := httptest.NewRecorder()
	DramaImportCatalog(recorder, request, "demo")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var response struct {
		Code int                        `json:"code"`
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode handler response: %v", err)
	}
	if response.Code != 0 || len(response.Data["assets"]) == 0 || len(response.Data["beatContextAssets"]) == 0 || len(response.Data["warnings"]) == 0 || len(response.Data["sourceSnapshot"]) == 0 {
		t.Fatalf("catalog response omitted data or snapshot fields: %s", recorder.Body.String())
	}
	if contextEpisode != "4" || contextBeat != "2" {
		t.Fatalf("beat-context query = episode %q, beat %q; want 4 and 2", contextEpisode, contextBeat)
	}
}

func TestDramaAssetCatalogReadsOnlyAssetEndpoint(t *testing.T) {
	var requestedPaths []string
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPaths = append(requestedPaths, r.URL.Path)
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/demo/freezone/assets" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":[{"id":"hero","tab":"characters","kind":"portrait","role":"character_portrait","label":"林雨","url":"/static/hero.png","exists":true,"media_type":"image"}]}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaAssetCatalog(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects/demo/asset-catalog", nil), "demo")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Assets   []json.RawMessage `json:"assets"`
			Episodes json.RawMessage   `json:"episodes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode asset catalog: %v", err)
	}
	if envelope.Code != 0 || len(envelope.Data.Assets) != 1 || envelope.Data.Episodes != nil {
		t.Fatalf("response must contain only source assets, got %s", recorder.Body.String())
	}
	if len(requestedPaths) != 1 || requestedPaths[0] != "/api/v1/projects/demo/freezone/assets" {
		t.Fatalf("upstream calls=%v; want only the freezone assets route", requestedPaths)
	}
}

func TestDramaAssetDomainListUsesTheExplicitSourceDomainRoute(t *testing.T) {
	var requests int
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/demo/characters" || r.URL.Query().Get("summary") != "true" {
			http.Error(w, "unexpected source request", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":[{"name":"林雨","portrait_url":"` + source.URL + `/static/portrait.png","history_url":"/api/v1/projects/demo/characters/林雨/asset-history"}]}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaAssetDomainList(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects/demo/domain/characters", nil), "demo", "characters")
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`/api/v1/drama/media?url=`)) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if bytes.Contains(recorder.Body.Bytes(), []byte(source.URL+"/static/portrait.png")) {
		t.Fatalf("source media origin leaked to browser: %s", recorder.Body.String())
	}
	if requests != 1 {
		t.Fatalf("source requests=%d; want 1", requests)
	}

	DramaAssetDomainList(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil), "demo", "episodes")
	if requests != 1 {
		t.Fatalf("unsupported domain reached DramaClaw: requests=%d", requests)
	}
}

func TestDramaAssetDomainCRUDHandlersKeepTheSourceContract(t *testing.T) {
	var requests int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects/demo/props":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"name":"红伞"}}`))
		case r.Method == http.MethodPatch && r.URL.Path == "/api/v1/projects/demo/scenes/车站":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"name":"车站","description":"雨夜站台"}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects/demo/characters/林雨/delete":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"deleted":true}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	create := httptest.NewRecorder()
	DramaAssetDomainCreate(create, httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"红伞","prop_type":"object"}`)), "demo", "props")
	if create.Code != http.StatusOK || !bytes.Contains(create.Body.Bytes(), []byte(`"name":"红伞"`)) {
		t.Fatalf("create status=%d body=%s", create.Code, create.Body.String())
	}
	update := httptest.NewRecorder()
	DramaAssetDomainUpdate(update, httptest.NewRequest(http.MethodPatch, "/", bytes.NewBufferString(`{"description":"雨夜站台"}`)), "demo", "scenes", "车站")
	if update.Code != http.StatusOK || !bytes.Contains(update.Body.Bytes(), []byte("雨夜站台")) {
		t.Fatalf("update status=%d body=%s", update.Code, update.Body.String())
	}
	delete := httptest.NewRecorder()
	DramaAssetDomainDelete(delete, httptest.NewRequest(http.MethodPost, "/", nil), "demo", "characters", "林雨")
	if delete.Code != http.StatusOK || !bytes.Contains(delete.Body.Bytes(), []byte(`"deleted":true`)) {
		t.Fatalf("delete status=%d body=%s", delete.Code, delete.Body.String())
	}
	invalid := httptest.NewRecorder()
	DramaAssetDomainCreate(invalid, httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"x","arbitrary":"/outside"}`)), "demo", "props")
	if invalid.Code != http.StatusBadRequest || requests != 3 {
		t.Fatalf("invalid create status=%d source requests=%d body=%s", invalid.Code, requests, invalid.Body.String())
	}
}

func TestDramaVoiceMutationHandlersProxyExactCharacterAndNarratorOperations(t *testing.T) {
	var sourceRequests int
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sourceRequests++
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/demo/characters/林雨/voice-samples/default/record":
			if r.Method != http.MethodPost {
				t.Errorf("character voice method=%s", r.Method)
			}
			body, _ := io.ReadAll(r.Body)
			if !bytes.Contains(body, []byte(`"data_url":"data:audio/webm;base64,AA=="`)) {
				t.Errorf("character record body=%s", body)
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"slot":"default","path":"audio/voice.wav"}}`))
		case "/api/v1/projects/demo/narrator-voice/upload":
			if err := r.ParseMultipartForm(1024); err != nil {
				t.Errorf("parse narrator upload: %v", err)
			}
			file, _, err := r.FormFile("file")
			if err != nil {
				t.Errorf("narrator upload file: %v", err)
			} else {
				defer file.Close()
				body, _ := io.ReadAll(file)
				if string(body) != "voice-file" {
					t.Errorf("narrator file=%q", body)
				}
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"reference_path":"audio/voice.wav","reference_url":"` + source.URL + `/static/voice.wav","is_first_person":false}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	record := httptest.NewRecorder()
	DramaCharacterVoiceOperation(record, httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"data_url":"data:audio/webm;base64,AA=="}`)), "demo", "林雨", "default", "record")
	if record.Code != http.StatusOK || !bytes.Contains(record.Body.Bytes(), []byte(`"slot":"default"`)) {
		t.Fatalf("character record status=%d body=%s", record.Code, record.Body.String())
	}

	upload := httptest.NewRecorder()
	DramaNarratorVoiceOperation(upload, multipartFileRequest(t, []byte("voice-file")), "demo", "upload")
	if upload.Code != http.StatusOK || !bytes.Contains(upload.Body.Bytes(), []byte("/api/v1/drama/media?url=")) {
		t.Fatalf("narrator upload status=%d body=%s", upload.Code, upload.Body.String())
	}
	if sourceRequests != 2 {
		t.Fatalf("source requests=%d; want 2", sourceRequests)
	}
	invalid := httptest.NewRecorder()
	DramaCharacterVoiceOperation(invalid, httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`)), "demo", "林雨", "default", "copy")
	if invalid.Code != http.StatusBadRequest || sourceRequests != 2 {
		t.Fatalf("unsupported character copy status=%d source requests=%d body=%s", invalid.Code, sourceRequests, invalid.Body.String())
	}
}

func TestDramaImportCatalogRequiresEpisodeForBeat(t *testing.T) {
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: "http://127.0.0.1:1"}
	defer func() { config.Cfg = previous }()

	request := httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects/demo/import-catalog?beat=2", nil)
	recorder := httptest.NewRecorder()
	DramaImportCatalog(recorder, request, "demo")

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if response.Code != 1 || response.Msg == "" {
		t.Fatalf("invalid parameter response must use the standard error envelope: %+v", response)
	}
}

func TestDramaImportCatalogErrorEnvelopes(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "source failure", http.StatusInternalServerError)
	}))
	defer upstream.Close()

	tests := []struct {
		name       string
		baseURL    string
		query      string
		wantStatus int
	}{
		{name: "source not configured", wantStatus: http.StatusServiceUnavailable},
		{name: "invalid episode", baseURL: upstream.URL, query: "?episode=abc", wantStatus: http.StatusBadRequest},
		{name: "upstream failure", baseURL: upstream.URL, wantStatus: http.StatusBadGateway},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			previous := config.Cfg
			config.Cfg = config.Config{DramaClawBaseURL: test.baseURL}
			defer func() { config.Cfg = previous }()

			request := httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects/demo/import-catalog"+test.query, nil)
			recorder := httptest.NewRecorder()
			DramaImportCatalog(recorder, request, "demo")

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			var response struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if response.Code != 1 || response.Msg == "" {
				t.Fatalf("failure must use the standard error envelope: %+v", response)
			}
		})
	}
}

func TestDramaProjectsReturnsSourceProjectSummariesWithoutLeakingCredentials(t *testing.T) {
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/summaries" || r.URL.Query().Get("status") != "all" {
			http.Error(w, "unexpected source request", http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer source-secret" {
			http.Error(w, "missing source auth", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":[{"project_id":"rainy-night","name":"雨夜","status":"active"}]}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "source-secret"}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaProjects(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects", nil))
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"project_id":"rainy-night"`)) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if bytes.Contains(recorder.Body.Bytes(), []byte("source-secret")) {
		t.Fatalf("source credential leaked: %s", recorder.Body.String())
	}
}

func TestDramaProjectsReportsMissingSourceConfiguration(t *testing.T) {
	previous := config.Cfg
	config.Cfg = config.Config{}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaProjects(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s; want 503", recorder.Code, recorder.Body.String())
	}
}

func TestDramaCreateProjectValidatesAndProxiesProjectCreation(t *testing.T) {
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/projects" || r.Header.Get("Authorization") != "Bearer source-secret" {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		var payload map[string]string
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if payload["name"] != "new_story" {
			t.Errorf("payload=%#v", payload)
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"id":"new_story","name":"new_story"}}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "source-secret"}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaCreateProject(recorder, httptest.NewRequest(http.MethodPost, "/projects", bytes.NewBufferString(`{"name":"new_story"}`)))
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"new_story"`)) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDramaCreateProjectRejectsInvalidNameBeforeUpstream(t *testing.T) {
	var requests int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { requests++ }))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaCreateProject(recorder, httptest.NewRequest(http.MethodPost, "/projects", bytes.NewBufferString(`{"name":"../private"}`)))
	if recorder.Code != http.StatusBadRequest || requests != 0 {
		t.Fatalf("status=%d upstream requests=%d body=%s", recorder.Code, requests, recorder.Body.String())
	}
}

func TestDramaProjectLifecycleProxiesExplicitArchiveAction(t *testing.T) {
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/projects/rainy_night/archive" {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"id":"rainy_night","name":"rainy_night","status":"archived"}}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()

	recorder := httptest.NewRecorder()
	DramaProjectLifecycle(recorder, httptest.NewRequest(http.MethodPost, "/projects/rainy_night/archive", nil), "rainy_night", "archive")
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"status":"archived"`)) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDramaWritebackHandlersProxyActualCharacterAndSlotRoutes(t *testing.T) {
	var historyRequested bool
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer source-secret" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/demo/freezone/assets/identities":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["source_url"] != source.URL+"/static/projects/demo/freezone/_uploads/candidate.png" {
				t.Errorf("identity source_url = %#v", body["source_url"])
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"character":"hero","identity_id":"hero_rain","identity_name":"rain","target_path":"/private/identity.png","target_url":"` + source.URL + `/static/projects/demo/characters/hero/identities/rain.png"}}`))
		case "/api/v1/projects/demo/freezone/push":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["mark_stale"] != true {
				t.Errorf("mark_stale = %#v", body["mark_stale"])
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"target_path":"/private/portrait.png","target_url":"` + source.URL + `/static/projects/demo/characters/hero.png","backup":"/private/hero_20260922.png","stale_marked":1,"affected_count":2}}`))
		case "/api/v1/projects/demo/characters/hero/asset-history":
			historyRequested = r.URL.Query().Get("kind") == "portrait"
			_, _ = w.Write([]byte(`{"ok":true,"data":{"kind":"portrait","current_url":"` + source.URL + `/static/current.png","entries":[]}}`))
		case "/api/v1/projects/demo/characters/hero/asset-history/restore":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"kind":"portrait","restored":true,"url":"` + source.URL + `/static/current.png"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "source-secret"}
	defer func() { config.Cfg = previous }()
	candidateURL := "/static/projects/demo/freezone/_uploads/candidate.png"

	identityRequest := httptest.NewRequest(http.MethodPost, "/identity", bytes.NewBufferString(`{"source_url":"`+candidateURL+`","character":"hero","identity_name":"rain"}`))
	identityRecorder := httptest.NewRecorder()
	DramaCreateIdentity(identityRecorder, identityRequest, "demo")
	if identityRecorder.Code != http.StatusOK || bytes.Contains(identityRecorder.Body.Bytes(), []byte("target_path")) || bytes.Contains(identityRecorder.Body.Bytes(), []byte("/private/")) {
		t.Fatalf("identity status=%d body=%s", identityRecorder.Code, identityRecorder.Body.String())
	}

	pushRequest := httptest.NewRequest(http.MethodPost, "/push", bytes.NewBufferString(`{"source_url":"`+candidateURL+`","target":{"kind":"portrait","character":"hero"},"mark_stale":true}`))
	pushRecorder := httptest.NewRecorder()
	DramaPushCandidate(pushRecorder, pushRequest, "demo")
	if pushRecorder.Code != http.StatusOK || bytes.Contains(pushRecorder.Body.Bytes(), []byte("/private/")) || !bytes.Contains(pushRecorder.Body.Bytes(), []byte(`"backup":"hero_20260922.png"`)) {
		t.Fatalf("push status=%d body=%s", pushRecorder.Code, pushRecorder.Body.String())
	}

	historyRequest := httptest.NewRequest(http.MethodGet, "/history?kind=portrait", nil)
	historyRecorder := httptest.NewRecorder()
	DramaAssetHistory(historyRecorder, historyRequest, "demo", "hero")
	if historyRecorder.Code != http.StatusOK || !historyRequested {
		t.Fatalf("history status=%d requested=%v body=%s", historyRecorder.Code, historyRequested, historyRecorder.Body.String())
	}
	restoreRequest := httptest.NewRequest(http.MethodPost, "/restore", bytes.NewBufferString(`{"kind":"portrait","history_id":"hero_20260922.png"}`))
	restoreRecorder := httptest.NewRecorder()
	DramaAssetHistory(restoreRecorder, restoreRequest, "demo", "hero")
	if restoreRecorder.Code != http.StatusOK || !bytes.Contains(restoreRecorder.Body.Bytes(), []byte(`"restored":true`)) {
		t.Fatalf("restore status=%d body=%s", restoreRecorder.Code, restoreRecorder.Body.String())
	}
}

func TestDramaPushHandlerRejectsForeignCandidateWithoutCallingUpstream(t *testing.T) {
	upstreamRequests := 0
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamRequests++
		http.Error(w, "unexpected", http.StatusInternalServerError)
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL}
	defer func() { config.Cfg = previous }()
	request := httptest.NewRequest(http.MethodPost, "/push", bytes.NewBufferString(`{"source_url":"https://elsewhere.invalid/candidate.png","target":{"kind":"portrait","character":"hero"}}`))
	recorder := httptest.NewRecorder()
	DramaPushCandidate(recorder, request, "demo")
	if recorder.Code != http.StatusBadGateway || upstreamRequests != 0 {
		t.Fatalf("status=%d upstream requests=%d body=%s", recorder.Code, upstreamRequests, recorder.Body.String())
	}
	var envelope struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil || envelope.Code == 0 || envelope.Msg == "" {
		t.Fatalf("expected readable safe failure envelope: %+v err=%v", envelope, err)
	}
}

func TestDramaPushImpactHandlerReturnsAffectedBeatSummary(t *testing.T) {
	var source *httptest.Server
	source = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/projects/demo/freezone/impact" || r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "invalid upstream request", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"target":{"kind":"portrait","character":"hero"},"affected_beats":[{"episode":1,"beat":2}],"affected_count":1}}`))
	}))
	defer source.Close()
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: source.URL, DramaClawAPIToken: "secret"}
	defer func() { config.Cfg = previous }()
	request := httptest.NewRequest(http.MethodPost, "/impact", bytes.NewBufferString(`{"target":{"kind":"portrait","character":"hero"}}`))
	recorder := httptest.NewRecorder()
	DramaPushImpact(recorder, request, "demo")
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"affected_count":1`)) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
