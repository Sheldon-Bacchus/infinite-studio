package works

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// ArchiveRequest 业务实体归档请求模型
type ArchiveRequest struct {
	BaseRevision int64    `json:"baseRevision"`
	OperationID  string   `json:"operationId"`
	EntityRefs   []string `json:"entityRefs"`
}

// RestoreRequest 业务实体恢复请求模型
type RestoreRequest struct {
	BaseRevision int64    `json:"baseRevision"`
	OperationID  string   `json:"operationId"`
	EntityRefs   []string `json:"entityRefs"`
}

// setProjectionArchived 同步更新 projection 内部的 archived 标记（若存在）
func setProjectionArchived(projRaw json.RawMessage, archived bool) json.RawMessage {
	if len(projRaw) == 0 {
		return projRaw
	}
	var proj map[string]any
	if err := json.Unmarshal(projRaw, &proj); err == nil {
		if orig, ok := proj["originalAsset"].(map[string]any); ok {
			orig["archived"] = archived
		}
		proj["archived"] = archived
		if updated, err := json.Marshal(proj); err == nil {
			return updated
		}
	}
	return projRaw
}

// applyArchiveStateToRecord 对单一记录应用归档/恢复状态变更并序列化为 RecordChange
func applyArchiveStateToRecord(rec *Record, entityID string, archived bool) (*RecordChange, error) {
	switch rec.Type {
	case RecordTypeAsset:
		var asset AssetData
		if err := decodeStrictJSONBytes(rec.Data, &asset); err != nil {
			return nil, fmt.Errorf("解析资产记录 %s 失败: %w", entityID, err)
		}
		asset.Archived = archived
		asset.Projection = setProjectionArchived(asset.Projection, archived)
		b, err := json.Marshal(asset)
		if err != nil {
			return nil, err
		}
		return &RecordChange{ID: entityID, Type: RecordTypeAsset, Data: b}, nil

	case RecordTypeEpisode:
		var ep EpisodeData
		if err := decodeStrictJSONBytes(rec.Data, &ep); err != nil {
			return nil, fmt.Errorf("解析剧集记录 %s 失败: %w", entityID, err)
		}
		ep.Archived = archived
		ep.Projection = setProjectionArchived(ep.Projection, archived)
		b, err := json.Marshal(ep)
		if err != nil {
			return nil, err
		}
		return &RecordChange{ID: entityID, Type: RecordTypeEpisode, Data: b}, nil

	case RecordTypeShot:
		var shot ShotData
		if err := decodeStrictJSONBytes(rec.Data, &shot); err != nil {
			return nil, fmt.Errorf("解析镜头记录 %s 失败: %w", entityID, err)
		}
		shot.Archived = archived
		shot.Projection = setProjectionArchived(shot.Projection, archived)
		b, err := json.Marshal(shot)
		if err != nil {
			return nil, err
		}
		return &RecordChange{ID: entityID, Type: RecordTypeShot, Data: b}, nil

	case RecordTypeShotRevision:
		var sr ShotRevisionData
		if err := decodeStrictJSONBytes(rec.Data, &sr); err != nil {
			return nil, fmt.Errorf("解析镜头修订记录 %s 失败: %w", entityID, err)
		}
		sr.Archived = archived
		sr.Projection = setProjectionArchived(sr.Projection, archived)
		b, err := json.Marshal(sr)
		if err != nil {
			return nil, err
		}
		return &RecordChange{ID: entityID, Type: RecordTypeShotRevision, Data: b}, nil

	case RecordTypeScript:
		var sc ScriptData
		if err := decodeStrictJSONBytes(rec.Data, &sc); err != nil {
			return nil, fmt.Errorf("解析剧本记录 %s 失败: %w", entityID, err)
		}
		sc.Archived = archived
		sc.Projection = setProjectionArchived(sc.Projection, archived)
		b, err := json.Marshal(sc)
		if err != nil {
			return nil, err
		}
		return &RecordChange{ID: entityID, Type: RecordTypeScript, Data: b}, nil

	case RecordTypePromptRevision:
		var pr PromptRevisionData
		if err := decodeStrictJSONBytes(rec.Data, &pr); err != nil {
			return nil, fmt.Errorf("解析提示词修订记录 %s 失败: %w", entityID, err)
		}
		pr.Archived = archived
		b, err := json.Marshal(pr)
		if err != nil {
			return nil, err
		}
		return &RecordChange{ID: entityID, Type: RecordTypePromptRevision, Data: b}, nil

	case RecordTypeGeneration:
		var gen GenerationData
		if err := decodeStrictJSONBytes(rec.Data, &gen); err != nil {
			return nil, fmt.Errorf("解析生成记录 %s 失败: %w", entityID, err)
		}
		gen.Archived = archived
		b, err := json.Marshal(gen)
		if err != nil {
			return nil, err
		}
		return &RecordChange{ID: entityID, Type: RecordTypeGeneration, Data: b}, nil

	default:
		return nil, fmt.Errorf("%w: 不支持归档或恢复该记录类型 (%s, ID: %s)", ErrInvalidRequest, rec.Type, entityID)
	}
}

// recordsAtRevision 从 head 沿不可变提交链读取指定基准修订的记录集合。
// 未决重试必须按原始 baseRevision 重建请求，即使实体后来已被编辑。
func (s *Store) recordsAtRevision(workID string, head *Commit, revision int64) (*Commit, map[string]*Record, error) {
	if revision < 1 || revision > head.Revision {
		return nil, nil, fmt.Errorf("%w: 基准修订号 %d 不在作品提交历史中", ErrConflict, revision)
	}
	visited := make(map[string]bool)
	base := head
	for base.Revision > revision {
		if base == nil || visited[base.ID] {
			return nil, nil, fmt.Errorf("%w: 提交历史损坏或存在循环引用", ErrCorruptData)
		}
		visited[base.ID] = true
		if base.PreviousCommitID == "" {
			return nil, nil, fmt.Errorf("%w: 找不到基准修订号 %d 对应的提交", ErrCorruptData, revision)
		}
		parent, err := s.getCommit(workID, base.PreviousCommitID)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: 读取基准提交父级失败: %v", ErrCorruptData, err)
		}
		if parent.Revision != base.BaseRevision {
			return nil, nil, fmt.Errorf("%w: 提交 %s 的父修订号与基准修订号不一致", ErrCorruptData, base.ID)
		}
		base = parent
	}
	if base.Revision != revision {
		return nil, nil, fmt.Errorf("%w: 找不到基准修订号 %d 对应的提交", ErrCorruptData, revision)
	}

	records := make(map[string]*Record, len(base.RecordRefs))
	for objectID, revisionID := range base.RecordRefs {
		record, err := s.getRecord(workID, revisionID)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: 读取基准记录 %s 失败: %v", ErrCorruptData, objectID, err)
		}
		if record.ID != objectID {
			return nil, nil, fmt.Errorf("%w: 基准 recordRefs 与记录身份不一致 (%s)", ErrCorruptData, objectID)
		}
		records[objectID] = record
	}
	return base, records, nil
}

// ArchiveEntities 执行业务实体安全归档。
// 规则：
// 1. 基准版本 CAS 校验，防止并发写入踩踏；
// 2. 将指定实体（包含 asset/episode/shot/script/prompt_revision/generation 等）置为 archived: true，并写入不可变 archive 归档记录；
// 3. 所有历史记录与原件均妥善保留，绝对不执行永久物理删除；
// 4. 沿用已有 commitLocked 提交内核与 checkOperationIdempotency 机制，通过操作回执和完整请求载荷摘要保证重试幂等。
func (s *Store) ArchiveEntities(workID string, req ArchiveRequest) (*CommitResult, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}
	if req.OperationID == "" {
		return nil, fmt.Errorf("%w: operationId 不能为空", ErrInvalidRequest)
	}
	if req.BaseRevision < 1 {
		return nil, fmt.Errorf("%w: baseRevision 必须大于等于 1", ErrInvalidRequest)
	}
	if len(req.EntityRefs) == 0 {
		return nil, fmt.Errorf("%w: 待归档实体引用列表不能为空", ErrInvalidRequest)
	}

	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	work, err := s.getWork(workID)
	if err != nil {
		return nil, err
	}

	currentCommit, err := s.getCommit(workID, work.CurrentCommitID)
	if err != nil {
		return nil, fmt.Errorf("读取当前提交清单失败: %w", err)
	}

	_, baseRecords, err := s.recordsAtRevision(workID, currentCommit, req.BaseRevision)
	if err != nil {
		return nil, err
	}

	changes := make([]RecordChange, 0, len(req.EntityRefs)+1)

	for _, entityID := range req.EntityRefs {
		rec, exists := baseRecords[entityID]
		if !exists {
			return nil, fmt.Errorf("%w: 待归档实体 %s 不存在于当前版本记录中", ErrInvalidRequest, entityID)
		}

		change, aErr := applyArchiveStateToRecord(rec, entityID, true)
		if aErr != nil {
			return nil, aErr
		}
		changes = append(changes, *change)
	}

	// 登记独立不可变归档记录 (RecordTypeArchive)，使用基于请求的稳定 ID 保证重试幂等
	archiveHash := sha256.Sum256([]byte(fmt.Sprintf("archive:%s:%s", workID, req.OperationID)))
	archiveID := hex.EncodeToString(archiveHash[:])[:32]
	archRecord := ArchiveData{
		ID:             archiveID,
		WorkID:         workID,
		EntityRefs:     req.EntityRefs,
		SourceRevision: fmt.Sprintf("r%d", req.BaseRevision),
		Status:         "archived",
	}
	archBytes, err := json.Marshal(archRecord)
	if err != nil {
		return nil, fmt.Errorf("序列化归档记录失败: %w", err)
	}

	changes = append(changes, RecordChange{
		ID:   archiveID,
		Type: RecordTypeArchive,
		Data: archBytes,
	})

	commitReq := CommitRequest{
		BaseRevision: req.BaseRevision,
		OperationID:  req.OperationID,
		Changes:      changes,
	}

	reqDigest, err := computeRequestDigest(workID, commitReq)
	if err != nil {
		return nil, err
	}

	// 回溯检查 operationId 幂等性：严格核验历史提交的完整请求摘要与载荷，禁止仅比较 BaseRevision
	if hitResult, isIdempotent, err := s.checkOperationIdempotency(workID, currentCommit, req.OperationID, reqDigest); err != nil {
		return nil, err
	} else if isIdempotent {
		return hitResult, nil
	}

	if req.BaseRevision != work.Revision {
		return nil, fmt.Errorf("%w: baseRevision %d 与当前作品修订版本 %d 不一致", ErrConflict, req.BaseRevision, work.Revision)
	}

	return s.commitLocked(workID, commitReq, reqDigest)
}

// RestoreEntities 执行已归档业务实体恢复。
// 规则：
// 1. 基准版本 CAS 校验；
// 2. 将指定已归档实体（包含 asset/episode/shot/script/prompt_revision/generation 等）置为 archived: false；
// 3. 记录独立不可变恢复记录 (status=restored)；
// 4. 不覆盖后来编辑，恢复后生成新版本不可变记录；
// 5. 沿用已有 commitLocked 提交内核与 checkOperationIdempotency 机制，验证完整请求摘要与载荷。
func (s *Store) RestoreEntities(workID string, req RestoreRequest) (*CommitResult, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}
	if req.OperationID == "" {
		return nil, fmt.Errorf("%w: operationId 不能为空", ErrInvalidRequest)
	}
	if req.BaseRevision < 1 {
		return nil, fmt.Errorf("%w: baseRevision 必须大于等于 1", ErrInvalidRequest)
	}
	if len(req.EntityRefs) == 0 {
		return nil, fmt.Errorf("%w: 待恢复实体引用列表不能为空", ErrInvalidRequest)
	}

	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	work, err := s.getWork(workID)
	if err != nil {
		return nil, err
	}

	currentCommit, err := s.getCommit(workID, work.CurrentCommitID)
	if err != nil {
		return nil, fmt.Errorf("读取当前提交清单失败: %w", err)
	}

	_, baseRecords, err := s.recordsAtRevision(workID, currentCommit, req.BaseRevision)
	if err != nil {
		return nil, err
	}

	changes := make([]RecordChange, 0, len(req.EntityRefs)+1)

	for _, entityID := range req.EntityRefs {
		rec, exists := baseRecords[entityID]
		if !exists {
			return nil, fmt.Errorf("%w: 待恢复实体 %s 不存在于当前版本记录中", ErrInvalidRequest, entityID)
		}

		change, rErr := applyArchiveStateToRecord(rec, entityID, false)
		if rErr != nil {
			return nil, rErr
		}
		changes = append(changes, *change)
	}

	// 登记独立不可变恢复记录 (RecordTypeArchive，status: "restored")
	restoreHash := sha256.Sum256([]byte(fmt.Sprintf("restore:%s:%s", workID, req.OperationID)))
	restoreID := hex.EncodeToString(restoreHash[:])[:32]
	archRecord := ArchiveData{
		ID:             restoreID,
		WorkID:         workID,
		EntityRefs:     req.EntityRefs,
		SourceRevision: fmt.Sprintf("r%d", req.BaseRevision),
		Status:         "restored",
	}
	archBytes, err := json.Marshal(archRecord)
	if err != nil {
		return nil, fmt.Errorf("序列化恢复记录失败: %w", err)
	}

	changes = append(changes, RecordChange{
		ID:   restoreID,
		Type: RecordTypeArchive,
		Data: archBytes,
	})

	commitReq := CommitRequest{
		BaseRevision: req.BaseRevision,
		OperationID:  req.OperationID,
		Changes:      changes,
	}

	reqDigest, err := computeRequestDigest(workID, commitReq)
	if err != nil {
		return nil, err
	}

	// 回溯检查 operationId 幂等性：严格核验历史提交的完整请求摘要与载荷，禁止仅比较 BaseRevision
	if hitResult, isIdempotent, err := s.checkOperationIdempotency(workID, currentCommit, req.OperationID, reqDigest); err != nil {
		return nil, err
	} else if isIdempotent {
		return hitResult, nil
	}

	if req.BaseRevision != work.Revision {
		return nil, fmt.Errorf("%w: baseRevision %d 与当前作品修订版本 %d 不一致", ErrConflict, req.BaseRevision, work.Revision)
	}

	return s.commitLocked(workID, commitReq, reqDigest)
}
