package workspace

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

var (
	ErrRecordNotFound = errors.New("工作区记录不存在")
	ErrConflict       = errors.New("工作区记录版本冲突")
	ErrInvalidRequest = errors.New("工作区请求无效")
)

const (
	recordCanvas = "canvas"
	recordAsset  = "asset"
)

func (a *App) ListRecords(kind string) ([]RecordEnvelope, error) {
	var result []RecordEnvelope
	switch kind {
	case recordCanvas:
		var rows []legacyCanvasProject
		if err := a.db.Where("user_id = ? AND deleted_at = ''", a.workspaceID).Order("id ASC").Find(&rows).Error; err != nil {
			return nil, err
		}
		result = make([]RecordEnvelope, 0, len(rows))
		for _, row := range rows {
			revision, err := revisionIn(a.db, a.workspaceID, kind, row.ID)
			if err != nil {
				return nil, err
			}
			result = append(result, RecordEnvelope{WorkspaceID: a.workspaceID, ID: row.ID, Revision: revision, Data: json.RawMessage(row.ProjectData)})
		}
	case recordAsset:
		var rows []legacyWorkspaceAsset
		if err := a.db.Where("workspace_id = ? AND deleted_at = ''", a.workspaceID).Order("id ASC").Find(&rows).Error; err != nil {
			return nil, err
		}
		result = make([]RecordEnvelope, 0, len(rows))
		for _, row := range rows {
			revision, err := revisionIn(a.db, a.workspaceID, kind, row.ID)
			if err != nil {
				return nil, err
			}
			result = append(result, RecordEnvelope{WorkspaceID: a.workspaceID, ID: row.ID, Revision: revision, Data: json.RawMessage(row.AssetData)})
		}
	default:
		return nil, ErrInvalidRequest
	}
	return result, nil
}

func (a *App) GetRecord(kind, id string) (RecordEnvelope, error) {
	if id == "" {
		return RecordEnvelope{}, ErrInvalidRequest
	}
	var data string
	switch kind {
	case recordCanvas:
		var row legacyCanvasProject
		err := a.db.Where("user_id = ? AND id = ? AND deleted_at = ''", a.workspaceID, id).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return RecordEnvelope{}, ErrRecordNotFound
		}
		if err != nil {
			return RecordEnvelope{}, err
		}
		data = row.ProjectData
	case recordAsset:
		var row legacyWorkspaceAsset
		err := a.db.Where("workspace_id = ? AND id = ? AND deleted_at = ''", a.workspaceID, id).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return RecordEnvelope{}, ErrRecordNotFound
		}
		if err != nil {
			return RecordEnvelope{}, err
		}
		data = row.AssetData
	default:
		return RecordEnvelope{}, ErrInvalidRequest
	}
	if !json.Valid([]byte(data)) {
		return RecordEnvelope{}, errors.New("工作区记录包含无效 JSON")
	}
	revision, err := revisionIn(a.db, a.workspaceID, kind, id)
	if err != nil {
		return RecordEnvelope{}, err
	}
	return RecordEnvelope{WorkspaceID: a.workspaceID, ID: id, Revision: revision, Data: json.RawMessage(data)}, nil
}

func (a *App) GetOperation(operationID string) (json.RawMessage, error) {
	if operationID == "" {
		return nil, ErrInvalidRequest
	}
	var operation WorkspaceOperation
	err := a.db.Where("workspace_id = ? AND operation_id = ?", a.workspaceID, operationID).Take(&operation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrRecordNotFound
	}
	if err != nil {
		return nil, err
	}
	if !json.Valid([]byte(operation.ResultJSON)) {
		return nil, errors.New("工作区操作包含无效 JSON")
	}
	return json.RawMessage(operation.ResultJSON), nil
}

func (a *App) WriteRecord(kind, id string, request WriteRequest) (WriteResult, error) {
	if kind != recordCanvas && kind != recordAsset || id == "" || request.OperationID == "" ||
		request.WorkspaceID != a.workspaceID || len(request.Data) == 0 || !json.Valid(request.Data) {
		return WriteResult{}, ErrInvalidRequest
	}
	if request.BaseRevision != nil && *request.BaseRevision < 1 {
		return WriteResult{}, ErrInvalidRequest
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(request.Data, &payload); err != nil || payload == nil {
		return WriteResult{}, ErrInvalidRequest
	}
	var dataID string
	if err := json.Unmarshal(payload["id"], &dataID); err != nil || dataID != id {
		return WriteResult{}, fmt.Errorf("%w: data.id 必须与路径 ID 一致", ErrInvalidRequest)
	}
	if err := a.validateFileReferences(request.Data); err != nil {
		return WriteResult{}, err
	}
	digestInput, err := json.Marshal(struct {
		WorkspaceID  string          `json:"workspaceId"`
		RecordType   string          `json:"recordType"`
		ID           string          `json:"id"`
		BaseRevision *int64          `json:"baseRevision"`
		Data         json.RawMessage `json:"data"`
	}{request.WorkspaceID, kind, id, request.BaseRevision, request.Data})
	if err != nil {
		return WriteResult{}, err
	}
	digestValue := sha256.Sum256(digestInput)
	digest := hex.EncodeToString(digestValue[:])
	var saved WriteResult
	err = a.db.Transaction(func(tx *gorm.DB) error {
		var previous WorkspaceOperation
		err := tx.Where("workspace_id = ? AND operation_id = ?", a.workspaceID, request.OperationID).Take(&previous).Error
		if err == nil {
			if previous.Digest != digest {
				return ErrConflict
			}
			return json.Unmarshal([]byte(previous.ResultJSON), &saved)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		revision, currentData, currentCreatedAt, currentUpdatedAt, exists, err := a.currentRecord(tx, kind, id)
		if err != nil {
			return err
		}
		if request.BaseRevision == nil {
			if exists {
				return ErrConflict
			}
			revision = 0
		} else if !exists || revision != *request.BaseRevision {
			return ErrConflict
		}
		if err := a.saveRecord(tx, kind, id, string(request.Data), currentData, currentCreatedAt, currentUpdatedAt, exists); err != nil {
			return err
		}
		nextRevision := revision + 1
		if err := a.writeRevision(tx, kind, id, revision, nextRevision); err != nil {
			return err
		}
		saved = WriteResult{
			RecordEnvelope: RecordEnvelope{WorkspaceID: a.workspaceID, ID: id, Revision: nextRevision, Data: append(json.RawMessage(nil), request.Data...)},
			OperationID: request.OperationID,
		}
		encoded, err := json.Marshal(saved)
		if err != nil {
			return err
		}
		return tx.Create(&WorkspaceOperation{WorkspaceID: a.workspaceID, OperationID: request.OperationID, Digest: digest, ResultJSON: string(encoded)}).Error
	})
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return WriteResult{}, ErrConflict
	}
	if err != nil {
		return WriteResult{}, err
	}
	return saved, nil
}

func (a *App) DeleteRecord(kind, id string, request DeleteRequest) (DeleteResult, error) {
	if (kind != recordCanvas && kind != recordAsset) || id == "" || request.OperationID == "" ||
		request.WorkspaceID != a.workspaceID || request.BaseRevision == nil || *request.BaseRevision < 1 {
		return DeleteResult{}, ErrInvalidRequest
	}
	digestInput, err := json.Marshal(struct {
		WorkspaceID  string `json:"workspaceId"`
		RecordType   string `json:"recordType"`
		ID           string `json:"id"`
		BaseRevision int64  `json:"baseRevision"`
		Deleted      bool   `json:"deleted"`
	}{request.WorkspaceID, kind, id, *request.BaseRevision, true})
	if err != nil {
		return DeleteResult{}, err
	}
	digestValue := sha256.Sum256(digestInput)
	digest := hex.EncodeToString(digestValue[:])
	var saved DeleteResult
	err = a.db.Transaction(func(tx *gorm.DB) error {
		var previous WorkspaceOperation
		err := tx.Where("workspace_id = ? AND operation_id = ?", a.workspaceID, request.OperationID).Take(&previous).Error
		if err == nil {
			if previous.Digest != digest {
				return ErrConflict
			}
			return json.Unmarshal([]byte(previous.ResultJSON), &saved)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		revision, currentData, createdAt, updatedAt, exists, err := a.currentRecord(tx, kind, id)
		if err != nil {
			return err
		}
		if !exists || revision != *request.BaseRevision {
			return ErrConflict
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		var result *gorm.DB
		switch kind {
		case recordCanvas:
			result = tx.Model(&legacyCanvasProject{}).
				Where("user_id = ? AND id = ? AND deleted_at = '' AND created_at = ? AND updated_at = ? AND project_data = ?", a.workspaceID, id, createdAt, updatedAt, currentData).
				Updates(map[string]any{"updated_at": now, "deleted_at": now})
		case recordAsset:
			result = tx.Model(&legacyWorkspaceAsset{}).
				Where("workspace_id = ? AND id = ? AND deleted_at = '' AND created_at = ? AND updated_at = ? AND asset_data = ?", a.workspaceID, id, createdAt, updatedAt, currentData).
				Updates(map[string]any{"updated_at": now, "deleted_at": now})
		}
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrConflict
		}
		nextRevision := revision + 1
		if err := a.writeRevision(tx, kind, id, revision, nextRevision); err != nil {
			return err
		}
		saved = DeleteResult{WorkspaceID: a.workspaceID, ID: id, Revision: nextRevision, OperationID: request.OperationID, Deleted: true}
		encoded, err := json.Marshal(saved)
		if err != nil {
			return err
		}
		return tx.Create(&WorkspaceOperation{WorkspaceID: a.workspaceID, OperationID: request.OperationID, Digest: digest, ResultJSON: string(encoded)}).Error
	})
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return DeleteResult{}, ErrConflict
	}
	if err != nil {
		return DeleteResult{}, err
	}
	return saved, nil
}

func (a *App) currentRecord(tx *gorm.DB, kind, id string) (int64, string, string, string, bool, error) {
	switch kind {
	case recordCanvas:
		var row legacyCanvasProject
		err := tx.Where("user_id = ? AND id = ?", a.workspaceID, id).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, "", "", "", false, nil
		}
		if err != nil {
			return 0, "", "", "", false, err
		}
		if row.DeletedAt != "" {
			return 0, "", "", "", false, ErrConflict
		}
		revision, err := revisionIn(tx, a.workspaceID, kind, id)
		return revision, row.ProjectData, row.CreatedAt, row.UpdatedAt, true, err
	case recordAsset:
		var row legacyWorkspaceAsset
		err := tx.Where("workspace_id = ? AND id = ?", a.workspaceID, id).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, "", "", "", false, nil
		}
		if err != nil {
			return 0, "", "", "", false, err
		}
		if row.DeletedAt != "" {
			return 0, "", "", "", false, ErrConflict
		}
		revision, err := revisionIn(tx, a.workspaceID, kind, id)
		return revision, row.AssetData, row.CreatedAt, row.UpdatedAt, true, err
	default:
		return 0, "", "", "", false, ErrInvalidRequest
	}
}

func (a *App) saveRecord(tx *gorm.DB, kind, id, data, oldData, createdAt, updatedAt string, exists bool) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if !exists {
		switch kind {
		case recordCanvas:
			return tx.Create(&legacyCanvasProject{UserID: a.workspaceID, ID: id, ProjectData: data, CreatedAt: now, UpdatedAt: now}).Error
		case recordAsset:
			return tx.Create(&legacyWorkspaceAsset{WorkspaceID: a.workspaceID, ID: id, AssetData: data, CreatedAt: now, UpdatedAt: now}).Error
		}
	}
	if createdAt == "" || updatedAt == "" {
		return errors.New("现有工作区记录缺少并发校验字段，拒绝覆盖")
	}
	var result *gorm.DB
	switch kind {
	case recordCanvas:
		result = tx.Model(&legacyCanvasProject{}).
			Where("user_id = ? AND id = ? AND deleted_at = '' AND created_at = ? AND updated_at = ? AND project_data = ?", a.workspaceID, id, createdAt, updatedAt, oldData).
			Updates(map[string]any{"project_data": data, "updated_at": now})
	case recordAsset:
		result = tx.Model(&legacyWorkspaceAsset{}).
			Where("workspace_id = ? AND id = ? AND deleted_at = '' AND created_at = ? AND updated_at = ? AND asset_data = ?", a.workspaceID, id, createdAt, updatedAt, oldData).
			Updates(map[string]any{"asset_data": data, "updated_at": now})
	}
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrConflict
	}
	return nil
}

func (a *App) writeRevision(tx *gorm.DB, kind, id string, previous, next int64) error {
	var current WorkspaceRevision
	err := tx.Where("workspace_id = ? AND record_type = ? AND record_id = ?", a.workspaceID, kind, id).Take(&current).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if previous == 0 {
			return tx.Create(&WorkspaceRevision{WorkspaceID: a.workspaceID, RecordType: kind, RecordID: id, Revision: next}).Error
		}
		if previous != 1 {
			return ErrConflict
		}
		return tx.Create(&WorkspaceRevision{WorkspaceID: a.workspaceID, RecordType: kind, RecordID: id, Revision: next}).Error
	}
	if err != nil {
		return err
	}
	if current.Revision != previous {
		return ErrConflict
	}
	result := tx.Model(&WorkspaceRevision{}).
		Where("workspace_id = ? AND record_type = ? AND record_id = ? AND revision = ?", a.workspaceID, kind, id, previous).
		Update("revision", next)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrConflict
	}
	return nil
}

func revisionIn(db *gorm.DB, workspaceID, kind, id string) (int64, error) {
	var row WorkspaceRevision
	err := db.Where("workspace_id = ? AND record_type = ? AND record_id = ?", workspaceID, kind, id).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 1, nil
	}
	return row.Revision, err
}

func (a *App) validateFileReferences(data []byte) error {
	var value any
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return ErrInvalidRequest
	}
	if err := validateStableMediaReferences(value, ""); err != nil {
		return err
	}
	ids := map[string]struct{}{}
	collectFileIDs(value, "", ids)
	for id := range ids {
		var file WorkspaceFile
		err := a.db.Where("workspace_id = ? AND id = ? AND state = ?", a.workspaceID, id, "ready").Take(&file).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("%w: fileId %q 不存在或未就绪", ErrInvalidRequest, id)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func validateStableMediaReferences(value any, key string) error {
	switch typed := value.(type) {
	case map[string]any:
		for childKey, child := range typed {
			if err := validateStableMediaReferences(child, childKey); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := validateStableMediaReferences(child, key); err != nil {
				return err
			}
		}
	case string:
		isInlineMedia := strings.HasPrefix(typed, "data:image/") || strings.HasPrefix(typed, "data:audio/") || strings.HasPrefix(typed, "data:video/") || strings.HasPrefix(typed, "data:application/")
		if strings.HasPrefix(typed, "blob:") || ((key == "dataUrl" || key == "content" || key == "url" || key == "coverUrl" || key == "audioUrl" || key == "src") && isInlineMedia) {
			return fmt.Errorf("%w: 持久化媒体必须使用工作区 fileId", ErrInvalidRequest)
		}
		if (key == "storageKey" || key == "references" || key == "audioStorageKey") && (strings.HasPrefix(typed, "image:") || strings.HasPrefix(typed, "video:") || strings.HasPrefix(typed, "audio:") || strings.HasPrefix(typed, "video-reference:") || strings.HasPrefix(typed, "audio-reference:")) {
			return fmt.Errorf("%w: 不接受浏览器本地媒体 storageKey", ErrInvalidRequest)
		}
	}
	return nil
}

func collectFileIDs(value any, key string, ids map[string]struct{}) {
	switch typed := value.(type) {
	case map[string]any:
		for childKey, child := range typed {
			collectFileIDs(child, childKey, ids)
		}
	case []any:
		for _, child := range typed {
			collectFileIDs(child, key, ids)
		}
	case string:
		if key == "fileId" || key == "fileIds" {
			if typed != "" {
				ids[typed] = struct{}{}
			}
		}
		if key == "storageKey" || key == "references" {
			if strings.HasPrefix(typed, "file:") {
				if len(typed) == len("file:") {
					ids[""] = struct{}{}
				} else {
					ids[strings.TrimPrefix(typed, "file:")] = struct{}{}
				}
			}
		}
	}
}
