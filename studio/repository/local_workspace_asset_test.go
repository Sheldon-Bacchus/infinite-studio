package repository

import (
	"context"
	"os"
	"os/exec"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

func TestLocalWorkspaceAssetOrderingAndDeleteTombstone(t *testing.T) {
	const childMarker = "LOCAL_WORKSPACE_ASSET_ORDERING_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestLocalWorkspaceAssetOrderingAndDeleteTombstone$", "-test.v")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated local asset ordering: %v\n%s", err, output)
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

	const workspace = "local-workspace"
	first := model.LocalWorkspaceAsset{ID: "asset-one", AssetData: `{"id":"asset-one","title":"first"}`, CreatedAt: "2026-09-23T10:00:00Z", UpdatedAt: "2026-09-23T10:00:00Z"}
	if err := SaveLocalWorkspaceAssets(workspace, []model.LocalWorkspaceAsset{first}); err != nil {
		t.Fatal(err)
	}
	newer := first
	newer.AssetData = `{"id":"asset-one","title":"newer"}`
	newer.UpdatedAt = "2026-09-23T11:00:00Z"
	if err := SaveLocalWorkspaceAssets(workspace, []model.LocalWorkspaceAsset{newer}); err != nil {
		t.Fatal(err)
	}
	newerFractional := newer
	newerFractional.AssetData = `{"id":"asset-one","title":"newer fractional timestamp"}`
	newerFractional.UpdatedAt = "2026-09-23T11:00:00.500Z"
	if err := SaveLocalWorkspaceAssets(workspace, []model.LocalWorkspaceAsset{newerFractional}); err != nil {
		t.Fatal(err)
	}
	invalid := newerFractional
	invalid.AssetData = `{"id":"asset-one","title":"invalid timestamp overwrite"}`
	invalid.UpdatedAt = "2026-9-23T12:00:00Z"
	if err := SaveLocalWorkspaceAssets(workspace, []model.LocalWorkspaceAsset{invalid}); err == nil {
		t.Fatal("asset with a non-RFC3339 timestamp was accepted")
	}
	stale := first
	stale.AssetData = `{"id":"asset-one","title":"stale"}`
	stale.UpdatedAt = "2026-09-23T10:30:00Z"
	if err := SaveLocalWorkspaceAssets(workspace, []model.LocalWorkspaceAsset{stale}); err != nil {
		t.Fatal(err)
	}
	active, err := ListLocalWorkspaceAssets(workspace)
	if err != nil || len(active) != 1 || active[0].AssetData != newerFractional.AssetData {
		t.Fatalf("stale snapshot replaced newer asset: active=%#v err=%v", active, err)
	}
	if err := DeleteLocalWorkspaceAssets(workspace, []string{first.ID}, "2026-09-23T12:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.LocalWorkspaceAsset{}).
		Where("workspace_id = ? AND id = ?", workspace, first.ID).
		Update("updated_at", "2026-9-23T12:00:00Z").Error; err != nil {
		t.Fatal(err)
	}
	stale.UpdatedAt = "2026-09-23T13:00:00Z"
	if err := SaveLocalWorkspaceAssets(workspace, []model.LocalWorkspaceAsset{stale}); err == nil {
		t.Fatal("asset tombstone with an invalid stored timestamp did not report the data error")
	}
	active, err = ListLocalWorkspaceAssets(workspace)
	if err != nil || len(active) != 0 {
		t.Fatalf("stale snapshot resurrected tombstoned asset: active=%#v err=%v", active, err)
	}
	var deleted model.LocalWorkspaceAsset
	if err := db.First(&deleted, "workspace_id = ? AND id = ?", workspace, first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if deleted.DeletedAt == "" {
		t.Fatal("stale snapshot cleared asset deletion tombstone")
	}
}
