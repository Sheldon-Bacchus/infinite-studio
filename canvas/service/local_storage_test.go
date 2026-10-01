package service

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestLocalFileDeletionWaitsUntilWorkspaceReferencesAreGone(t *testing.T) {
	const childMarker = "LOCAL_FILE_REFERENCE_GUARD_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestLocalFileDeletionWaitsUntilWorkspaceReferencesAreGone$", "-test.v")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated local file reference guard: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	filesDir := t.TempDir()
	previousConfig := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", LocalFilesDir: filesDir}
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

	upload, err := UploadLocalStorageObject("reference.png", "image/png", []byte("shared-media"))
	if err != nil {
		t.Fatal(err)
	}
	object, err := repository.GetStorageObject(upload.ID)
	if err != nil {
		t.Fatal(err)
	}
	filePath := filepath.Join(filesDir, object.ObjectKey)
	project := model.CanvasProject{
		UserID:      LocalWorkspaceID,
		ID:          "project-ref",
		ProjectData: `{"nodes":[{"metadata":{"storageKey":"server:` + upload.ID + `"}}]}`,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	}
	if _, err := repository.SaveLocalCanvasProject(project); err != nil {
		t.Fatal(err)
	}
	asset := model.LocalWorkspaceAsset{
		WorkspaceID: LocalWorkspaceID,
		ID:          "asset-ref",
		AssetData:   `{"id":"asset-ref","kind":"image","data":{"storageKey":"server:` + upload.ID + `"}}`,
		CreatedAt:   project.CreatedAt,
		UpdatedAt:   project.UpdatedAt,
	}
	if err := repository.SaveLocalWorkspaceAssets(LocalWorkspaceID, []model.LocalWorkspaceAsset{asset}); err != nil {
		t.Fatal(err)
	}

	if err := DeleteLocalStorageObject(upload.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("file referenced by active project and asset was deleted: %v", err)
	}
	if err := repository.DeleteLocalWorkspaceAssets(LocalWorkspaceID, []string{asset.ID}, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	if err := DeleteLocalStorageObject(upload.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("file referenced by active project was deleted: %v", err)
	}
	if err := repository.SoftDeleteUserCanvasProjects(LocalWorkspaceID, []string{project.ID}, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	if err := DeleteLocalStorageObject(upload.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("unreferenced local file was not deleted: stat err=%v", err)
	}
	orphanReference := model.CanvasProject{
		UserID:      LocalWorkspaceID,
		ID:          "project-with-deleted-media",
		ProjectData: `{"id":"project-with-deleted-media","nodes":[{"metadata":{"storageKey":"server:` + upload.ID + `"}}]}`,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	}
	if _, err := repository.SaveLocalCanvasProject(orphanReference); err == nil {
		t.Fatal("a canvas was allowed to attach a file reference after its local media had been deleted")
	}

	secondUpload, err := UploadLocalStorageObject("reupload.png", "image/png", []byte("repairable-media"))
	if err != nil {
		t.Fatal(err)
	}
	secondObject, err := repository.GetStorageObject(secondUpload.ID)
	if err != nil {
		t.Fatal(err)
	}
	secondPath := filepath.Join(filesDir, secondObject.ObjectKey)
	if err := os.Remove(secondPath); err != nil {
		t.Fatal(err)
	}
	repairedUpload, err := UploadLocalStorageObject("reupload.png", "image/png", []byte("repairable-media"))
	if err != nil {
		t.Fatal(err)
	}
	if repairedUpload.ID != secondUpload.ID {
		t.Fatalf("repair created a second storage object: got %s, want %s", repairedUpload.ID, secondUpload.ID)
	}
	if _, err := os.Stat(secondPath); err != nil {
		t.Fatalf("repeat upload did not repair the missing deduplicated file: %v", err)
	}
}
