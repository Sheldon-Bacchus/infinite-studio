package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/router"
)

func TestLocalCanvasImportIsExplicitAndStaleSaveCannotRestore(t *testing.T) {
	const childMarker = "LOCAL_CANVAS_IMPORT_ENDPOINT_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestLocalCanvasImportIsExplicitAndStaleSaveCannotRestore$", "-test.v")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated local canvas endpoint test: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	previousConfig := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", LocalFilesDir: t.TempDir()}
	t.Cleanup(func() { config.Cfg = previousConfig })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	server := httptest.NewServer(router.New())
	defer server.Close()
	project := `{"id":"explicit-import-project","title":"test","createdAt":"2026-09-23T10:00:00Z","updatedAt":"2026-09-23T10:00:00Z","nodes":[],"connections":[]}`
	request := func(method, path, body string) (int, map[string]any) {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var payload map[string]any
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, payload
	}

	if status, payload := request(http.MethodPost, "/api/local/canvas/projects", `{"data":`+project+`,"expected":null}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("initial save failed: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodPost, "/api/local/canvas/projects/delete", `{"ids":["explicit-import-project"],"expectedProjects":{"explicit-import-project":`+project+`}}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("delete failed: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodPost, "/api/local/canvas/projects", `{"data":`+project+`,"expected":`+project+`}`); status != http.StatusOK || payload["code"] == float64(0) {
		t.Fatalf("stale save should be rejected: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodGet, "/api/local/canvas/projects", ""); status != http.StatusOK || len(payload["data"].([]any)) != 0 {
		t.Fatalf("stale save resurrected deleted project: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodPost, "/api/local/canvas/projects/import", `{"projects":[`+project+`]}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("explicit import failed: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodPost, "/api/local/canvas/projects/import", `{"projects":[`+project+`]}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("repeated explicit import failed: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodGet, "/api/local/canvas/projects", ""); status != http.StatusOK || len(payload["data"].([]any)) != 1 {
		t.Fatalf("repeated import created a duplicate project: status=%d payload=%v", status, payload)
	}

	asset := `{"id":"shared-asset","kind":"image","title":"shared","createdAt":"2026-09-23T10:00:00Z","updatedAt":"2026-09-23T10:00:00Z","tags":[],"data":{"dataUrl":"server:asset-file"}}`
	if status, payload := request(http.MethodPost, "/api/local/assets/sync", `{"assets":[`+asset+`]}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("shared asset sync failed: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodGet, "/api/local/assets", ""); status != http.StatusOK || len(payload["data"].([]any)) != 1 {
		t.Fatalf("shared asset list mismatch: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodPost, "/api/local/assets/delete", `{"ids":["shared-asset"]}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("shared asset delete failed: status=%d payload=%v", status, payload)
	}
	asset = `{"id":"shared-asset","kind":"image","title":"stale","createdAt":"2026-09-23T10:00:00Z","updatedAt":"2026-09-23T12:00:00Z","tags":[],"data":{"dataUrl":"server:asset-file"}}`
	if status, payload := request(http.MethodPost, "/api/local/assets/sync", `{"assets":[`+asset+`]}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("stale asset sync response failed: status=%d payload=%v", status, payload)
	}
	if status, payload := request(http.MethodGet, "/api/local/assets", ""); status != http.StatusOK || len(payload["data"].([]any)) != 0 {
		t.Fatalf("stale asset sync resurrected deleted asset: status=%d payload=%v", status, payload)
	}

	fileContents := bytes.Repeat([]byte("streaming-local-media"), 4096)
	var multipartBody bytes.Buffer
	form := multipart.NewWriter(&multipartBody)
	part, err := form.CreateFormFile("file", "stream.bin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(fileContents); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	uploadRequest, err := http.NewRequest(http.MethodPost, server.URL+"/api/local/files", &multipartBody)
	if err != nil {
		t.Fatal(err)
	}
	uploadRequest.Header.Set("Content-Type", form.FormDataContentType())
	uploadResponse, err := http.DefaultClient.Do(uploadRequest)
	if err != nil {
		t.Fatal(err)
	}
	var uploadPayload map[string]any
	if err := json.NewDecoder(uploadResponse.Body).Decode(&uploadPayload); err != nil {
		t.Fatal(err)
	}
	_ = uploadResponse.Body.Close()
	if uploadResponse.StatusCode != http.StatusOK || uploadPayload["code"] != float64(0) {
		t.Fatalf("streaming upload failed: status=%d payload=%v", uploadResponse.StatusCode, uploadPayload)
	}
	uploadData := uploadPayload["data"].(map[string]any)
	fileResponse, err := http.Get(server.URL + "/api/files/" + uploadData["id"].(string) + "/content")
	if err != nil {
		t.Fatal(err)
	}
	readBack, err := io.ReadAll(fileResponse.Body)
	_ = fileResponse.Body.Close()
	if err != nil || fileResponse.StatusCode != http.StatusOK || !bytes.Equal(readBack, fileContents) {
		t.Fatalf("streamed file did not round-trip: status=%d bytes=%d err=%v", fileResponse.StatusCode, len(readBack), err)
	}
}

func TestLocalCanvasSyncRejectsStaleConcurrentSnapshot(t *testing.T) {
	const childMarker = "LOCAL_CANVAS_SYNC_CAS_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestLocalCanvasSyncRejectsStaleConcurrentSnapshot$", "-test.v")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated local canvas sync CAS test: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	previousConfig := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", LocalFilesDir: t.TempDir()}
	t.Cleanup(func() { config.Cfg = previousConfig })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	server := httptest.NewServer(router.New())
	defer server.Close()
	request := func(body string) (int, map[string]any) {
		t.Helper()
		response, err := http.Post(server.URL+"/api/local/canvas/projects/sync", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var payload map[string]any
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, payload
	}

	baseline := `{"id":"shared-canvas","title":"baseline","createdAt":"2026-09-25T10:00:00Z","updatedAt":"2026-09-25T10:00:00Z","nodes":[],"connections":[]}`
	if status, payload := request(`{"projects":[` + baseline + `],"expectedProjects":{"shared-canvas":null}}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("initial canvas create failed: status=%d payload=%v", status, payload)
	}

	firstWriter := `{"id":"shared-canvas","title":"writer one","createdAt":"2026-09-25T10:00:00Z","updatedAt":"2026-09-25T10:01:00Z","nodes":[{"id":"writer-one"}],"connections":[]}`
	secondWriter := `{"id":"shared-canvas","title":"writer two","createdAt":"2026-09-25T10:00:00Z","updatedAt":"2026-09-25T10:02:00Z","nodes":[{"id":"writer-two"}],"connections":[]}`
	newCanvas := `{"id":"must-rollback","title":"must roll back","createdAt":"2026-09-25T10:00:00Z","updatedAt":"2026-09-25T10:00:00Z","nodes":[],"connections":[]}`
	if status, payload := request(`{"projects":[` + firstWriter + `],"expectedProjects":{"shared-canvas":` + baseline + `}}`); status != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("first writer failed: status=%d payload=%v", status, payload)
	}
	if status, payload := request(`{"projects":[` + secondWriter + `],"expectedProjects":{"shared-canvas":` + baseline + `}}`); status != http.StatusOK || payload["code"] != float64(1) || payload["msg"] != "画布已在其他页面修改，请刷新后确认并重试" {
		t.Fatalf("stale second writer did not receive a recoverable conflict: status=%d payload=%v", status, payload)
	}
	deleteResponse, err := http.Post(
		server.URL+"/api/local/canvas/projects/delete",
		"application/json",
		strings.NewReader(`{"ids":["shared-canvas"],"expectedProjects":{"shared-canvas":`+baseline+`}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	var deletePayload map[string]any
	if err := json.NewDecoder(deleteResponse.Body).Decode(&deletePayload); err != nil {
		_ = deleteResponse.Body.Close()
		t.Fatal(err)
	}
	_ = deleteResponse.Body.Close()
	if deleteResponse.StatusCode == http.StatusOK && deletePayload["code"] == float64(0) {
		t.Fatalf("delete from a stale snapshot unexpectedly succeeded: status=%d payload=%v", deleteResponse.StatusCode, deletePayload)
	}
	if status, payload := request(`{"projects":[` + newCanvas + `,` + secondWriter + `],"expectedProjects":{"must-rollback":null,"shared-canvas":` + baseline + `}}`); status == http.StatusOK && payload["code"] == float64(0) {
		t.Fatalf("stale second writer unexpectedly succeeded: status=%d payload=%v", status, payload)
	}

	response, err := http.Get(server.URL + "/api/local/canvas/projects")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var projectsResponse struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&projectsResponse); err != nil {
		t.Fatal(err)
	}
	if len(projectsResponse.Data) != 1 || projectsResponse.Data[0]["title"] != "writer one" {
		t.Fatalf("stale writer replaced canonical canvas: %#v", projectsResponse.Data)
	}
}
