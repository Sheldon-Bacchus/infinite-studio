package model

// LocalWorkspaceAsset stores one browser-independent asset index entry.
// AssetData preserves the front-end Asset union without duplicating its schema.
type LocalWorkspaceAsset struct {
	WorkspaceID string `json:"workspaceId" gorm:"primaryKey;index:idx_local_workspace_assets_workspace_deleted_updated,priority:1"`
	ID          string `json:"id" gorm:"primaryKey"`
	AssetData   string `json:"assetData" gorm:"type:text"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt" gorm:"index:idx_local_workspace_assets_workspace_deleted_updated,priority:3"`
	DeletedAt   string `json:"deletedAt" gorm:"not null;default:'';index:idx_local_workspace_assets_workspace_deleted_updated,priority:2"`
}
