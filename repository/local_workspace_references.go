package repository

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

var (
	localWorkspaceReferenceMu = sync.Mutex{}
	localFileReferencePattern = regexp.MustCompile(`(?:server:|/api/files/)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`)
)

// LockLocalWorkspaceReferences serializes writes that add local-file
// references with the check-and-delete operation for those files.
func LockLocalWorkspaceReferences() func() {
	localWorkspaceReferenceMu.Lock()
	return localWorkspaceReferenceMu.Unlock
}

// LocalWorkspaceStorageObjectReferenced protects a shared media object from
// deletion while any active project, asset, account snapshot, or result log uses it.
func LocalWorkspaceStorageObjectReferenced(id string) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return false, nil
	}

	var values []string
	queries := []struct {
		model any
		field string
		where string
	}{
		{model: &model.CanvasProject{}, field: "project_data", where: "deleted_at = ''"},
		{model: &model.LocalWorkspaceAsset{}, field: "asset_data", where: "deleted_at = ''"},
		{model: &model.UserConfig{}, field: "asset_data", where: "asset_data <> ''"},
		{model: &model.UserConfig{}, field: "image_history", where: "image_history <> ''"},
		{model: &model.ImageGenerationLog{}, field: "payload_json", where: "deleted_at = '' AND payload_json <> ''"},
		{model: &model.VideoGenerationLog{}, field: "payload_json", where: "deleted_at = '' AND payload_json <> ''"},
		{model: &model.CanvasImageTask{}, field: "storage_key", where: "storage_key <> ''"},
	}
	for _, query := range queries {
		values = values[:0]
		if err := db.Model(query.model).Where(query.where).Pluck(query.field, &values).Error; err != nil {
			return false, fmt.Errorf("检查本地媒体引用失败：%w", err)
		}
		for _, value := range values {
			if containsLocalFileReference(value, id) {
				return true, nil
			}
		}
	}
	return false, nil
}

// ValidateLocalWorkspaceStorageReferences rejects a new dangling reference
// after a concurrently deleted local file. Callers that write reference-bearing
// records must hold LockLocalWorkspaceReferences while validating and saving.
func ValidateLocalWorkspaceStorageReferences(values ...string) error {
	ids := map[string]struct{}{}
	for _, value := range values {
		for _, match := range localFileReferencePattern.FindAllStringSubmatch(value, -1) {
			ids[match[1]] = struct{}{}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	db, err := DB()
	if err != nil {
		return err
	}
	for id := range ids {
		var object model.StorageObject
		err := db.First(&object, "id = ?", id).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("本地媒体引用 %s 对应的文件已不存在，未保存该引用", id)
		}
		if err != nil {
			return fmt.Errorf("检查本地媒体引用失败：%w", err)
		}
	}
	return nil
}

func containsLocalFileReference(value string, id string) bool {
	return strings.Contains(value, "server:"+id) || strings.Contains(value, "/api/files/"+id+"/")
}
