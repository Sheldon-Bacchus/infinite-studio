package works

import (
	"encoding/json"
	"errors"
)

const (
	// SchemaVersion 是所有规范作品清单与不可变记录的基础 Schema 版本号
	SchemaVersion = 1

	// ProductID 标识当前系统所属产品
	ProductID = "infinite-studio"
)

// 基础错误类型定义
var (
	ErrWorkNotFound             = errors.New("作品不存在")
	ErrWorkExists               = errors.New("作品已存在")
	ErrStoreNotFound            = errors.New("存储根目录不存在")
	ErrStoreNotInitialized      = errors.New("存储根目录尚未初始化或缺少 root.json")
	ErrStoreExists              = errors.New("存储根目录已包含有效 root.json，拒绝重复初始化")
	ErrConflict                 = errors.New("版本或操作冲突")
	ErrInvalidRequest          = errors.New("请求无效")
	ErrInvalidID               = errors.New("存储标识符格式无效，必须为固定 32 位小写十六进制 ASCII [0-9a-f]{32}")
	ErrInvalidHash             = errors.New("哈希标识符格式无效，必须为固定 64 位小写十六进制 ASCII [0-9a-f]{64}")
	ErrPathOutOfBounds         = errors.New("目标路径越界出作品根目录")
	ErrReparsePointDetected     = errors.New("检测到重解析点（符号链接/连接点），拒绝访问")
	ErrRootLocked              = errors.New("作品根目录已被其他服务实例独占锁定")
	ErrUnsupportedPlatform     = errors.New("当前平台不受支持，仅支持 Windows 原生环境")
	ErrStoreClosed             = errors.New("存储实例已关闭")
	ErrCommitFailed            = errors.New("提交失败，已安全保留旧版本权威指针")
	ErrCommitResultUndetermined = errors.New("提交切换可能已发生，但状态无法完全确定，请重新核验权威清单")
	ErrCorruptData             = errors.New("数据损坏或格式未知")
	ErrMediaHashMismatch       = errors.New("已有物理媒体文件内容与哈希摘要不匹配")
)

// 统一媒体类型常量（kind=text|image|video|audio）
const (
	MediaKindText  = "text"
	MediaKindImage = "image"
	MediaKindVideo = "video"
	MediaKindAudio = "audio"
)

// 业务记录类型常量
const (
	RecordTypeEpisode        = "episode"
	RecordTypeShot           = "shot"
	RecordTypeShotRevision   = "shot_revision"
	RecordTypeAsset          = "asset"
	RecordTypeMedia          = "media"
	RecordTypePromptRevision = "prompt_revision"
	RecordTypeGeneration     = "generation"
	RecordTypeCanvasBinding  = "canvas_binding"
	RecordTypeMigration      = "migration"
	RecordTypeArchive        = "archive"
	RecordTypeScript         = "script"
)

// ValidRecordTypes 有效记录类型枚举集合
var ValidRecordTypes = map[string]struct{}{
	RecordTypeEpisode:        {},
	RecordTypeShot:           {},
	RecordTypeShotRevision:   {},
	RecordTypeAsset:          {},
	RecordTypeMedia:          {},
	RecordTypePromptRevision: {},
	RecordTypeGeneration:     {},
	RecordTypeCanvasBinding:  {},
	RecordTypeMigration:      {},
	RecordTypeArchive:        {},
	RecordTypeScript:         {},
}

// StoreManifest 代表存储根目录的标识清单 (root.json)
type StoreManifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	Product       string `json:"product"`
	CreatedAt     string `json:"createdAt"`
}

// Work 代表作品的唯一权威元数据清单 (work.json)
type Work struct {
	SchemaVersion   int    `json:"schemaVersion"`
	ID              string `json:"id"`
	Title           string `json:"title"`
	CurrentCommitID string `json:"currentCommitId"`
	Revision        int64  `json:"revision"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

// CommitReceipt 是提交持久化在 Commit 清单中的操作回执
type CommitReceipt struct {
	WorkID      string `json:"workId"`
	Revision    int64  `json:"revision"`
	CommitID    string `json:"commitId"`
	OperationID string `json:"operationId"`
	Committed   bool   `json:"committed"`
}

// Commit 代表一次不可变版本提交清单 (commits/{commitId}/manifest.json)
type Commit struct {
	SchemaVersion    int               `json:"schemaVersion"`
	ID               string            `json:"id"`
	WorkID           string            `json:"workId"`
	Revision         int64             `json:"revision"`
	BaseRevision     int64             `json:"baseRevision"`
	OperationID      string            `json:"operationId"`
	RequestDigest    string            `json:"requestDigest"`
	RecordRefs       map[string]string `json:"recordRefs"` // object ID -> record revisionId
	PreviousCommitID string            `json:"previousCommitId"`
	Receipt          CommitReceipt     `json:"receipt"`
	CreatedAt        string            `json:"createdAt"`
}

// Record 代表单一实体不可变版本记录 (records/{revisionId}.json)
type Record struct {
	SchemaVersion int             `json:"schemaVersion"`
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	RevisionID    string          `json:"revisionId"`
	WorkID        string          `json:"workId"`
	Data          json.RawMessage `json:"data"`
	CreatedAt     string          `json:"createdAt"`
}

// MediaDescriptor 统一媒体记录模型 (descriptor 是版本化记录，原文件名只作元数据)
type MediaDescriptor struct {
	FileID           string          `json:"fileId"`
	WorkID           string          `json:"workId"`
	SHA256           string          `json:"sha256"`
	Bytes            int64           `json:"bytes"`
	MIMEType         string          `json:"mimeType"`
	Kind             string          `json:"kind"`
	Extension        string          `json:"extension"`
	OriginalFilename string          `json:"originalFilename"` // 仅作为展示与导出元数据，不得作为物理文件路径
	Metadata         json.RawMessage `json:"metadata,omitempty"`
	CreatedAt        string          `json:"createdAt"`
}

// RecordChange 代表提交请求中的单个记录变更项
type RecordChange struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	Data   json.RawMessage `json:"data"`
	Delete bool            `json:"delete,omitempty"`
}

// CommitRequest 提交请求载荷
type CommitRequest struct {
	BaseRevision int64          `json:"baseRevision"`
	OperationID  string         `json:"operationId"`
	Changes      []RecordChange `json:"changes"`
}

// 索引状态常量定义
const (
	IndexStateUpToDate       = "up_to_date"
	IndexStatePendingRebuild = "pending_rebuild"
)

// CommitResult 提交响应结果
type CommitResult struct {
	WorkID      string `json:"workId"`
	Revision    int64  `json:"revision"`
	CommitID    string `json:"commitId"`
	OperationID string `json:"operationId"`
	Committed   bool   `json:"committed"`
	IndexState  string `json:"indexState"`
}

// CreateWorkRequest 创建作品请求体
type CreateWorkRequest struct {
	OperationID string `json:"operationId"`
	ID          string `json:"id,omitempty"`
	Title       string `json:"title"`
}

// CreateWorkResult 创建作品响应结果
type CreateWorkResult struct {
	Work       *Work  `json:"work"`
	Committed  bool   `json:"committed"`
	IndexState string `json:"indexState"`
}

// --- 业务数据模型定义（契合 data-model.md 规格） ---

// EpisodeData 剧集/分集业务模型
type EpisodeData struct {
	ID                    string          `json:"id"`
	WorkID                string          `json:"workId"`
	Order                 int             `json:"order"`
	Title                 string          `json:"title"`
	CurrentScriptRevision string          `json:"currentScriptRevision,omitempty"`
	CurrentShotIDs        []string        `json:"currentShotIds"`
	CurrentBeatAssetIDs   []string        `json:"currentBeatAssetIds,omitempty"`
	Archived              bool            `json:"archived,omitempty"`
	Projection            json.RawMessage `json:"projection,omitempty"`
}

// ScriptData 剧本修订业务模型
type ScriptData struct {
	ID           string          `json:"id"`
	WorkID       string          `json:"workId"`
	EpisodeID    string          `json:"episodeId,omitempty"`
	Content      string          `json:"content"`
	DocumentKind string          `json:"documentKind,omitempty"`
	Archived     bool            `json:"archived,omitempty"`
	Projection   json.RawMessage `json:"projection,omitempty"`
}

// ShotData 镜头业务模型
type ShotData struct {
	ID                string          `json:"id"`
	WorkID            string          `json:"workId"`
	EpisodeID         string          `json:"episodeId,omitempty"`
	CurrentRevision   string          `json:"currentRevision"`
	SelectedOutputIDs []string        `json:"selectedOutputIds"`
	Archived          bool            `json:"archived,omitempty"`
	Projection        json.RawMessage `json:"projection,omitempty"`
}

// ShotRevisionData 镜头修订业务模型
type ShotRevisionData struct {
	ID                string          `json:"id"`
	ShotID            string          `json:"shotId"`
	Content           string          `json:"content"`
	Dialogue          string          `json:"dialogue,omitempty"`
	ReferenceAssetIDs []string        `json:"referenceAssetIds,omitempty"`
	PromptRevisionIDs []string        `json:"promptRevisionIds,omitempty"`
	Archived          bool            `json:"archived,omitempty"`
	Projection        json.RawMessage `json:"projection,omitempty"`
}

// AssetData 资产业务模型
type AssetData struct {
	ID              string          `json:"id"`
	WorkID          string          `json:"workId"`
	Domain          string          `json:"domain"`
	ParentID        string          `json:"parentId,omitempty"`
	CurrentMediaIDs []string        `json:"currentMediaIds"`
	Archived        bool            `json:"archived"`
	Projection      json.RawMessage `json:"projection,omitempty"`
}

// PromptRevisionData 提示词修订模型
type PromptRevisionData struct {
	ID             string `json:"id"`
	ShotID         string `json:"shotId"`
	SourceRevision string `json:"sourceRevision,omitempty"`
	ImagePrompt    string `json:"imagePrompt,omitempty"`
	VideoPrompt    string `json:"videoPrompt,omitempty"`
	Archived       bool   `json:"archived,omitempty"`
}

// GenerationData 生成历史模型
type GenerationData struct {
	ID             string          `json:"id"`
	WorkID         string          `json:"workId"`
	EpisodeID      string          `json:"episodeId,omitempty"`
	ShotID         string          `json:"shotId,omitempty"`
	SourceRevision string          `json:"sourceRevision,omitempty"`
	InputSnapshot  json.RawMessage `json:"inputSnapshot"`
	ModelChannel   string          `json:"modelChannel"`
	Parameters     json.RawMessage `json:"parameters,omitempty"`
	TaskID         string          `json:"taskId"`
	Status         string          `json:"status"`
	OutputFileIDs  []string        `json:"outputFileIds"`
	Archived       bool            `json:"archived,omitempty"`
}

// CanvasBindingData 画布绑定模型
type CanvasBindingData struct {
	WorkID         string                 `json:"workId"`
	CanvasID       string                 `json:"canvasId"`
	CanvasSnapshot json.RawMessage        `json:"canvasSnapshot,omitempty"`
	NodeRefs       map[string]NodeRefData `json:"nodeRefs,omitempty"`
}

// NodeRefData 画布节点对象/修订/来源身份引用模型
type NodeRefData struct {
	ObjectID   string `json:"objectId"`
	RevisionID string `json:"revisionId,omitempty"`
	SourceID   string `json:"sourceId,omitempty"`
}

// MigrationData 迁移映射模型
type MigrationData struct {
	SourceID         string            `json:"sourceId"`
	SourceDigest     string            `json:"sourceDigest"`
	EntityMappings   map[string]string `json:"entityMappings"`
	FileMappings     map[string]string `json:"fileMappings"`
	Status           string            `json:"status"`
	BackupReferences []string          `json:"backupReferences"`
}

// MigrationFileInfo 清单中记录的媒体文件信息
type MigrationFileInfo struct {
	Path             string `json:"path"`
	SHA256           string `json:"sha256"`
	Bytes            int64  `json:"bytes"`
	MIMEType         string `json:"mimeType"`
	OriginalFilename string `json:"originalFilename,omitempty"`
}

// MissingFileInfo 缺失文件信息
type MissingFileInfo struct {
	SourceAssetID string `json:"sourceAssetId,omitempty"`
	Path          string `json:"path,omitempty"`
	Reason        string `json:"reason"`
	URL           string `json:"url,omitempty"`
	SHA256        string `json:"sha256,omitempty"`
}

// ConflictInfo 迁移冲突信息
type ConflictInfo struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// OperationInfo 迁移预期操作信息
type OperationInfo struct {
	Action     string `json:"action"`
	TargetID   string `json:"targetId"`
	TargetName string `json:"targetName"`
	Details    string `json:"details,omitempty"`
}

// MigrationEntityItem 迁移清单中的实体项
type MigrationEntityItem struct {
	Type     string          `json:"type"`
	SourceID string          `json:"sourceId"`
	TargetID string          `json:"targetId"`
	Title    string          `json:"title,omitempty"`
	Data     json.RawMessage `json:"data"`
}

// MigrationManifest 规范迁移来源清单 (manifest.json)
type MigrationManifest struct {
	SchemaVersion        int                   `json:"schemaVersion"`
	SourceID             string                `json:"sourceId"`
	SourceDigest         string                `json:"sourceDigest"`
	SourceSnapshotDigest string                `json:"sourceSnapshotDigest,omitempty"`
	SourceType           string                `json:"sourceType"`
	Title                string                `json:"title"`
	Entities             []MigrationEntityItem `json:"entities"`
	Files                []MigrationFileInfo   `json:"files"`
	MissingFiles         []MissingFileInfo     `json:"missingFiles"`
	EntityMappings       map[string]string     `json:"entityMappings"`
	FileMappings         map[string]string     `json:"fileMappings"`
}

// MigrationPreviewResult 迁移预览响应模型
type MigrationPreviewResult struct {
	SourceID       string            `json:"sourceId"`
	SourceDigest   string            `json:"sourceDigest"`
	SourceType     string            `json:"sourceType"`
	Title          string            `json:"title"`
	EntityMappings map[string]string `json:"entityMappings"`
	FileMappings   map[string]string `json:"fileMappings"`
	MissingFiles   []MissingFileInfo `json:"missingFiles"`
	Conflicts      []ConflictInfo    `json:"conflicts"`
	Operations     []OperationInfo   `json:"operations"`
	CanCommit      bool              `json:"canCommit"`
}

// MigrationCommitResult 迁移提交响应模型
type MigrationCommitResult struct {
	WorkID          string         `json:"workId"`
	Revision        int64          `json:"revision"`
	CommitID        string         `json:"commitId"`
	OperationID     string         `json:"operationId"`
	Committed       bool           `json:"committed"`
	IndexState      string         `json:"indexState"`
	SourceID        string         `json:"sourceId"`
	SourceDigest    string         `json:"sourceDigest"`
	BackupID        string         `json:"backupId"`
	EntityCount     int            `json:"entityCount"`
	MediaCount      int            `json:"mediaCount"`
	MigrationRecord *MigrationData `json:"migrationRecord"`
}

// ArchiveData 归档记录模型
type ArchiveData struct {
	ID             string   `json:"id"`
	WorkID         string   `json:"workId"`
	EntityRefs     []string `json:"entityRefs"`
	SourceRevision string   `json:"sourceRevision"`
	Status         string   `json:"status,omitempty"`
	OperationID    string   `json:"operationId,omitempty"`
	RequestDigest  string   `json:"requestDigest,omitempty"`
}
