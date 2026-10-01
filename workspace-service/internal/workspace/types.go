package workspace

import "encoding/json"

const (
	LocalWorkspaceID = "local-workspace"
	ProductID        = "infinite-studio"
	SchemaVersion    = 1
)

type Manifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceID   string `json:"workspaceId"`
	Product       string `json:"product"`
}

type WorkspaceInfo struct {
	SchemaVersion     int    `json:"schemaVersion"`
	WorkspaceID       string `json:"workspaceId"`
	DataRoot          string `json:"dataRoot"`
	Storage           string `json:"storage"`
	ServiceInstanceID string `json:"serviceInstanceId"`
}

type RecordEnvelope struct {
	WorkspaceID string          `json:"workspaceId"`
	ID          string          `json:"id"`
	Revision    int64           `json:"revision"`
	Data        json.RawMessage `json:"data"`
}

type WriteRequest struct {
	WorkspaceID  string          `json:"workspaceId"`
	OperationID  string          `json:"operationId"`
	BaseRevision *int64          `json:"baseRevision"`
	Data         json.RawMessage `json:"data"`
}

type WriteResult struct {
	RecordEnvelope
	OperationID string `json:"operationId"`
}

type DeleteRequest struct {
	WorkspaceID  string `json:"workspaceId"`
	OperationID  string `json:"operationId"`
	BaseRevision *int64 `json:"baseRevision"`
}

type DeleteResult struct {
	WorkspaceID string `json:"workspaceId"`
	ID          string `json:"id"`
	Revision    int64  `json:"revision"`
	OperationID string `json:"operationId"`
	Deleted     bool   `json:"deleted"`
}

type APIResponse struct {
	Code int    `json:"code"`
	Data any    `json:"data"`
	Msg  string `json:"msg"`
}

type FileReference struct {
	FileID     string `json:"fileId"`
	StorageKey string `json:"storageKey"`
	SHA256     string `json:"sha256"`
	Bytes      int64  `json:"bytes"`
	MIMEType   string `json:"mimeType"`
	URL        string `json:"url"`
}

type WorkspaceMetadata struct {
	ID            int    `gorm:"primaryKey;column:id"`
	WorkspaceID   string `gorm:"column:workspace_id;not null"`
	Product       string `gorm:"column:product;not null"`
	SchemaVersion int    `gorm:"column:schema_version;not null"`
}

func (WorkspaceMetadata) TableName() string { return "workspace_metadata" }

type WorkspaceRevision struct {
	WorkspaceID string `gorm:"primaryKey;column:workspace_id"`
	RecordType  string `gorm:"primaryKey;column:record_type"`
	RecordID    string `gorm:"primaryKey;column:record_id"`
	Revision    int64  `gorm:"column:revision;not null"`
}

func (WorkspaceRevision) TableName() string { return "workspace_record_revisions" }

type WorkspaceOperation struct {
	WorkspaceID string `gorm:"primaryKey;column:workspace_id"`
	OperationID string `gorm:"primaryKey;column:operation_id"`
	Digest      string `gorm:"column:digest;not null"`
	ResultJSON  string `gorm:"column:result_json;type:text;not null"`
}

func (WorkspaceOperation) TableName() string { return "workspace_operations" }

type WorkspaceFile struct {
	ID           string `gorm:"primaryKey;column:id"`
	WorkspaceID  string `gorm:"column:workspace_id;not null;index:idx_workspace_files_workspace_state,priority:1"`
	RelativePath string `gorm:"column:relative_path;not null;uniqueIndex"`
	SHA256       string `gorm:"column:sha256;not null"`
	MIMEType     string `gorm:"column:mime_type;not null"`
	Bytes        int64  `gorm:"column:bytes;not null"`
	Filename     string `gorm:"column:filename;not null"`
	State        string `gorm:"column:state;not null;index:idx_workspace_files_workspace_state,priority:2"`
	CreatedAt    string `gorm:"column:created_at;not null"`
}

func (WorkspaceFile) TableName() string { return "workspace_files" }

type BackupFile struct {
	FileID string `json:"fileId"`
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}

type BackupManifest struct {
	SchemaVersion  int          `json:"schemaVersion"`
	WorkspaceID    string       `json:"workspaceId"`
	Product        string       `json:"product"`
	CreatedAt      string       `json:"createdAt"`
	DatabaseSHA256 string       `json:"databaseSha256"`
	Files          []BackupFile `json:"files"`
}

type BackupVerification struct {
	WorkspaceID string `json:"workspaceId"`
	Files       int    `json:"files"`
	Valid       bool   `json:"valid"`
}
