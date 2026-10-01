package repository

import (
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func ListLocalWorkspaceAssets(workspaceID string) ([]model.LocalWorkspaceAsset, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var assets []model.LocalWorkspaceAsset
	err = db.Where("workspace_id = ? AND deleted_at = ''", strings.TrimSpace(workspaceID)).
		Order("updated_at DESC").
		Order("id ASC").
		Find(&assets).Error
	return assets, err
}

// SaveLocalWorkspaceAssets merges an incoming browser snapshot into the shared
// index. Tombstones are authoritative and can only be cleared by a future
// explicit restore operation, not by a stale browser snapshot.
func SaveLocalWorkspaceAssets(workspaceID string, incoming []model.LocalWorkspaceAsset) error {
	unlock := LockLocalWorkspaceReferences()
	defer unlock()
	db, err := DB()
	if err != nil {
		return err
	}
	workspaceID = strings.TrimSpace(workspaceID)
	for _, asset := range incoming {
		if err := validateLocalTimestamp(asset.UpdatedAt); err != nil {
			return errors.New("本地素材更新时间无效：" + err.Error())
		}
		if err := ValidateLocalWorkspaceStorageReferences(asset.AssetData); err != nil {
			return err
		}
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, asset := range incoming {
			asset.WorkspaceID = workspaceID
			asset.ID = strings.TrimSpace(asset.ID)
			if asset.ID == "" {
				return errors.New("本地素材 ID 不能为空")
			}
			var current model.LocalWorkspaceAsset
			err := tx.First(&current, "workspace_id = ? AND id = ?", workspaceID, asset.ID).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(&asset).Error; err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			if current.DeletedAt != "" {
				if err := validateLocalTimestamp(current.UpdatedAt); err != nil {
					return errors.New("已删除本地素材更新时间无效：" + err.Error())
				}
				continue
			}
			incomingIsNewer, err := localTimestampAfter(asset.UpdatedAt, current.UpdatedAt)
			if err != nil {
				return err
			}
			if !incomingIsNewer {
				continue
			}
			createdAt := asset.CreatedAt
			if createdAt == "" {
				createdAt = current.CreatedAt
			}
			result := tx.Model(&model.LocalWorkspaceAsset{}).
				Where("workspace_id = ? AND id = ? AND deleted_at = '' AND updated_at = ?", workspaceID, asset.ID, current.UpdatedAt).
				Updates(map[string]any{
					"asset_data": asset.AssetData,
					"created_at": createdAt,
					"updated_at": asset.UpdatedAt,
				})
			if result.Error != nil {
				return result.Error
			}
		}
		return nil
	})
}

func DeleteLocalWorkspaceAssets(workspaceID string, ids []string, deletedAt string) error {
	unlock := LockLocalWorkspaceReferences()
	defer unlock()
	db, err := DB()
	if err != nil {
		return err
	}
	workspaceID = strings.TrimSpace(workspaceID)
	return db.Transaction(func(tx *gorm.DB) error {
		seen := make(map[string]struct{}, len(ids))
		for _, rawID := range ids {
			id := strings.TrimSpace(rawID)
			if id == "" {
				continue
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			var current model.LocalWorkspaceAsset
			err := tx.First(&current, "workspace_id = ? AND id = ?", workspaceID, id).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(&model.LocalWorkspaceAsset{
					WorkspaceID: workspaceID,
					ID:          id,
					AssetData:   "{}",
					CreatedAt:   deletedAt,
					UpdatedAt:   deletedAt,
					DeletedAt:   deletedAt,
				}).Error; err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			if current.DeletedAt != "" {
				continue
			}
			if err := tx.Model(&model.LocalWorkspaceAsset{}).
				Where("workspace_id = ? AND id = ? AND deleted_at = ''", workspaceID, id).
				Updates(map[string]any{"deleted_at": deletedAt, "asset_data": "{}"}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
