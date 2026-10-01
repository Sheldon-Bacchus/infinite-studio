package repository

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

func TestSaveLocalCanvasProjectDoesNotResurrectDeletedProject(t *testing.T) {
	const childMarker = "LOCAL_CANVAS_DELETE_REGRESSION_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestSaveLocalCanvasProjectDoesNotResurrectDeletedProject$", "-test.v")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated local canvas regression: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	previousConfig := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	t.Cleanup(func() { config.Cfg = previousConfig })
	db, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	const workspaceID = "local-workspace"
	project := model.CanvasProject{
		UserID:      workspaceID,
		ID:          "project-that-was-deleted",
		ProjectData: `{"id":"project-that-was-deleted","nodes":[]}`,
		CreatedAt:   "2026-09-23T10:00:00Z",
		UpdatedAt:   "2026-09-23T10:00:00Z",
	}
	if _, err := SaveLocalCanvasProject(project); err != nil {
		t.Fatal(err)
	}
	invalidTimestamp := project
	invalidTimestamp.ProjectData = `{"id":"project-that-was-deleted","nodes":[{"id":"invalid-timestamp"}]}`
	invalidTimestamp.UpdatedAt = "2026-9-23T11:00:00Z"
	if _, err := SaveLocalCanvasProject(invalidTimestamp); err == nil {
		t.Fatal("canvas with a non-RFC3339 timestamp was accepted")
	}
	if err := SoftDeleteUserCanvasProjects(workspaceID, []string{project.ID}, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}

	// A stale tab may autosave after the delete request. That save must not
	// clear the tombstone even when its updatedAt is newer than the original.
	project.ProjectData = `{"id":"project-that-was-deleted","nodes":[{"id":"stale-node"}]}`
	project.UpdatedAt = time.Now().UTC().Add(time.Minute).Format(time.RFC3339Nano)
	if _, err := SaveLocalCanvasProject(project); err == nil {
		t.Fatal("stale autosave unexpectedly succeeded for a deleted project")
	}

	projects, err := ListUserCanvasProjects(workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 0 {
		t.Fatalf("deleted project was resurrected by stale autosave: %#v", projects)
	}
	var stored model.CanvasProject
	if err := db.First(&stored, "user_id = ? AND id = ?", workspaceID, project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.DeletedAt == "" {
		t.Fatal("stale autosave cleared the deletion tombstone")
	}

	project.ProjectData = `{"id":"project-that-was-deleted","nodes":[]}`
	project.UpdatedAt = "2026-09-23T10:00:00Z"
	if _, err := ImportLocalCanvasProject(project); err != nil {
		t.Fatalf("explicit import should restore the same project ID: %v", err)
	}
	projects, err = ListUserCanvasProjects(workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].ID != project.ID || !sameLocalCanvasProjectContent(projects[0].ProjectData, project.ProjectData) {
		t.Fatalf("explicit import did not restore the expected project: %#v", projects)
	}
	if err := SoftDeleteUserCanvasProjects(workspaceID, []string{project.ID}, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).
		Where("user_id = ? AND id = ?", workspaceID, project.ID).
		Update("updated_at", "2026-9-23T11:00:00Z").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := SaveLocalCanvasProject(project); err == nil || !strings.Contains(err.Error(), "已删除画布更新时间无效") {
		t.Fatalf("invalid tombstone timestamp was not reported: %v", err)
	}
}

func TestImportLocalCanvasProjectsDoesNotOverwriteIDCollisions(t *testing.T) {
	const childMarker = "LOCAL_CANVAS_IMPORT_ID_COLLISION_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestImportLocalCanvasProjectsDoesNotOverwriteIDCollisions$", "-test.v")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated local canvas import collision: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	previousConfig := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	t.Cleanup(func() { config.Cfg = previousConfig })
	db, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	const workspaceID = "local-workspace"
	current := model.CanvasProject{
		UserID:      workspaceID,
		ID:          "same-source-id",
		ProjectData: `{"id":"same-source-id","title":"existing local canvas","nodes":[]}`,
		CreatedAt:   "2026-09-23T10:00:00Z",
		UpdatedAt:   "2026-09-23T10:00:00Z",
	}
	if _, err := SaveLocalCanvasProject(current); err != nil {
		t.Fatal(err)
	}

	imported := func(key, title string) model.CanvasProject {
		return model.CanvasProject{
			UserID:      workspaceID,
			ID:          current.ID,
			ProjectData: `{"id":"same-source-id","importKey":"` + key + `","title":"` + title + `","nodes":[]}`,
			CreatedAt:   "2026-09-23T10:00:00Z",
			UpdatedAt:   "2026-09-23T11:00:00Z",
		}
	}
	first, err := ImportLocalCanvasProject(imported("zip-project:111111111111111111111111", "archive one"))
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == current.ID {
		t.Fatalf("import collision overwrote the existing canvas ID %q", current.ID)
	}
	var firstData map[string]any
	if err := json.Unmarshal([]byte(first.ProjectData), &firstData); err != nil {
		t.Fatal(err)
	}
	if firstData["id"] != first.ID {
		t.Fatalf("stored project JSON ID %v does not match canonical ID %q", firstData["id"], first.ID)
	}

	repeated, err := ImportLocalCanvasProject(imported("zip-project:111111111111111111111111", "archive one"))
	if err != nil {
		t.Fatal(err)
	}
	if repeated.ID != first.ID {
		t.Fatalf("repeat import changed canonical ID: got %q, want %q", repeated.ID, first.ID)
	}
	aliased := imported("zip-project:111111111111111111111111", "archive one")
	aliased.ID = "different-source-id"
	aliased.ProjectData = `{"id":"different-source-id","importKey":"zip-project:111111111111111111111111","title":"archive one","nodes":[]}`
	aliasedResult, err := ImportLocalCanvasProject(aliased)
	if err != nil {
		t.Fatal(err)
	}
	if aliasedResult.ID != first.ID {
		t.Fatalf("same import key with a changed source ID created a second project: got %q, want %q", aliasedResult.ID, first.ID)
	}

	second, err := ImportLocalCanvasProject(imported("zip-project:222222222222222222222222", "archive two"))
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || second.ID == current.ID {
		t.Fatalf("distinct import identity collided: first=%q second=%q existing=%q", first.ID, second.ID, current.ID)
	}
	projects, err := ListUserCanvasProjects(workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 3 {
		t.Fatalf("expected existing canvas and two imported canvases, got %d", len(projects))
	}
}

func TestCanvasProjectXiajiBindingIsUniqueUnderConcurrentWrites(t *testing.T) {
	const childMarker = "LOCAL_CANVAS_XIAJI_BINDING_UNIQUE_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestCanvasProjectXiajiBindingIsUniqueUnderConcurrentWrites$", "-test.v")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated local canvas xiaji binding test: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	previousConfig := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	t.Cleanup(func() { config.Cfg = previousConfig })
	db, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	const workspaceID = "local-workspace"
	const xiajiProjectAssetID = "xiaji-project-1"
	const firstCanvasID = "canvas-one"
	const secondCanvasID = "canvas-two"
	makeProject := func(id string) model.CanvasProject {
		projectData, marshalErr := json.Marshal(map[string]any{
			"id":                  id,
			"xiajiProjectAssetId": xiajiProjectAssetID,
			"nodes":               []any{},
		})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		return model.CanvasProject{
			UserID: workspaceID, ID: id, ProjectData: string(projectData),
			CreatedAt: "2026-09-27T10:00:00Z", UpdatedAt: "2026-09-27T10:00:00Z",
		}
	}

	projects := []model.CanvasProject{makeProject(firstCanvasID), makeProject(secondCanvasID)}
	results := make(chan error, len(projects))
	var start sync.WaitGroup
	start.Add(1)
	for _, project := range projects {
		project := project
		go func() {
			start.Wait()
			_, saveErr := SaveLocalCanvasProjectsIfUnchanged(workspaceID, []model.CanvasProject{project}, map[string]*model.CanvasProject{project.ID: nil})
			results <- saveErr
		}()
	}
	start.Done()

	successes := 0
	var conflict error
	for range projects {
		if saveErr := <-results; saveErr == nil {
			successes++
		} else {
			conflict = saveErr
		}
	}
	if successes != 1 {
		t.Fatalf("expected exactly one project binding to save, got %d successes (conflict: %v)", successes, conflict)
	}
	if conflict == nil || !errors.Is(conflict, ErrLocalCanvasProjectConflict) {
		t.Fatalf("expected the losing write to return a binding conflict, got %v", conflict)
	}
	projectsAfterSave, err := ListUserCanvasProjects(workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(projectsAfterSave) != 1 {
		t.Fatalf("expected exactly one canvas for the bound project, got %d", len(projectsAfterSave))
	}
	if !strings.Contains(conflict.Error(), projectsAfterSave[0].ID) {
		t.Fatalf("binding conflict should identify the canonical canvas %q: %v", projectsAfterSave[0].ID, conflict)
	}
}
