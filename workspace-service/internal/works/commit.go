package works

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"
)

// Commit 执行工作区原子提交。
// 核心逻辑保证：
// 1. 基准版本校验 (CAS)：对比 baseRevision 与 work.json 权威 revision，不一致直接拒绝并返回 ErrConflict。
// 2. 幂等与持久回执：沿提交历史（previousCommitId）使用 visited 集合检测环，校验父子修订强约束（parent.Revision == curr.BaseRevision 且 curr.Revision == curr.BaseRevision + 1）；任何读取错误均返回拒绝，不忽略损坏历史。
// 3. 完整最终记录集合与引用严格校验：通过 validateFinalRecords 校验每种类型的必填 ID/WorkID 匹配、关联对象归属（Episode.shots, Episode.script, Shot.currentRevision 必填, revision/prompt 必须同一 shot，generation 三者一致）、拒绝新老未知类型、拒绝原有类型变更、统一全量媒体物理原件存在与 SHA-256 摘要核验。
// 4. 同卷暂存与不可变发布：记录摘要使用 canonical JSON 计算，暂存文件强制排他创建 (O_CREATE|O_EXCL)，不可变发布严格采用 moveFileNoReplace 杜绝覆盖。
// 5. 权威单次原子替换：使用 replaceFileOnly 单次替换 work.json，失败时重新核查 head 区分旧 head 保留与状态未决，绝不盲目回退覆盖。
func (s *Store) Commit(workID string, req CommitRequest) (*CommitResult, error) {
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

	// 1. 严格校验变更项基本合法性与重复性
	seenChanges := make(map[string]bool, len(req.Changes))
	for _, change := range req.Changes {
		if change.ID == "" || change.Type == "" {
			return nil, fmt.Errorf("%w: 变更项 ID 与 Type 不能为空", ErrInvalidRequest)
		}
		if seenChanges[change.ID] {
			return nil, fmt.Errorf("%w: 提交载荷包含重复的变更 ID: %s", ErrInvalidRequest, change.ID)
		}
		seenChanges[change.ID] = true

		if change.Delete {
			return nil, fmt.Errorf("%w: 直接删除变更暂不支持，请使用归档功能 (ID: %s)", ErrInvalidRequest, change.ID)
		}

		if _, ok := ValidRecordTypes[change.Type]; !ok {
			return nil, fmt.Errorf("%w: 未知的记录类型枚举: %s (ID: %s)", ErrInvalidRequest, change.Type, change.ID)
		}

		if len(change.Data) == 0 || !json.Valid(change.Data) {
			return nil, fmt.Errorf("%w: 变更项 %s 包含无效或为空的 JSON 数据", ErrInvalidRequest, change.ID)
		}
	}

	// 2. 计算请求摘要 (Digest)
	reqDigest, err := computeRequestDigest(workID, req)
	if err != nil {
		return nil, err
	}

	// 3. 获取作品互斥锁，确保同一作品的写提交严格串行化
	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	return s.commitLocked(workID, req, reqDigest)
}

// commitLocked 在持有 workLock 且已完成前置参数校验及 reqDigest 计算的前提下执行权威提交发布内核。
func (s *Store) commitLocked(workID string, req CommitRequest, reqDigest string) (*CommitResult, error) {
	// 4. 读取当前权威作品元数据及提交清单（使用 private 无 beginOp 辅助函数）
	work, err := s.getWork(workID)
	if err != nil {
		return nil, err
	}

	currentCommit, err := s.getCommit(workID, work.CurrentCommitID)
	if err != nil {
		return nil, fmt.Errorf("读取当前提交清单失败: %w", err)
	}

	if currentCommit.Revision != work.Revision {
		return nil, fmt.Errorf("%w: 当前提交清单修订号 (%d) 与权威清单修订号 (%d) 不一致", ErrCorruptData, currentCommit.Revision, work.Revision)
	}

	// 5. 沿提交链回溯检查 operationId 幂等性（包含环检测与严格递减核查）
	if hitResult, isIdempotent, err := s.checkOperationIdempotency(workID, currentCommit, req.OperationID, reqDigest); err != nil {
		return nil, err
	} else if isIdempotent {
		return hitResult, nil
	}

	// 6. 基准修订 CAS 校验
	if req.BaseRevision != work.Revision {
		return nil, fmt.Errorf("%w: baseRevision %d 与当前作品修订版本 %d 不一致", ErrConflict, req.BaseRevision, work.Revision)
	}

	// 7. 读取当前记录集合并执行最终记录全量一致性与归属引用校验
	currentRecords, err := s.getCurrentRecords(workID)
	if err != nil {
		return nil, fmt.Errorf("读取当前记录集合失败: %w", err)
	}

	finalRecords, err := validateFinalRecords(s.locator, workID, currentRecords, req.Changes)
	if err != nil {
		return nil, err
	}

	// 8. 处理变更并暂存/发布不可变记录
	nextRevision := work.Revision + 1
	nextRecordRefs := make(map[string]string, len(finalRecords))
	for k, v := range currentCommit.RecordRefs {
		nextRecordRefs[k] = v
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, change := range req.Changes {
		// 计算不可变记录的规范 SHA-256 摘要（使用结构化 JSON 序列化，禁止冒号拼接）
		revisionID, err := computeRecordDigest(workID, change.ID, change.Type, change.Data)
		if err != nil {
			return nil, err
		}

		recTarget, err := s.locator.RecordPath(workID, revisionID)
		if err != nil {
			return nil, err
		}

		// 检查不可变记录是否已存在
		if _, err := os.Lstat(recTarget); err == nil {
			// 已存在：读取并比对内容是否完全一致（按规范摘要比较而非易受 MarshalIndent 影响的 raw bytes）
			existingRec, err := s.getRecord(workID, revisionID)
			if err != nil {
				return nil, fmt.Errorf("读取已存在不可变记录 %s 失败: %w", revisionID, err)
			}
			existingDigest, err := computeRecordDigest(workID, existingRec.ID, existingRec.Type, existingRec.Data)
			if err != nil {
				return nil, fmt.Errorf("计算已存在记录摘要失败: %w", err)
			}
			if existingRec.ID == change.ID && existingRec.Type == change.Type && existingDigest == revisionID {
				// 规范摘要完全一致，安全复用已有不可变记录，并在 finalRecords 中投影完整记录
				nextRecordRefs[change.ID] = existingRec.RevisionID
				finalRecords[change.ID] = existingRec
				continue
			}
			// 内容不同，不可变目标冲突
			return nil, fmt.Errorf("%w: 不可变记录 %s 目标已存在但内容不一致", ErrConflict, revisionID)
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("核验不可变记录目标状态失败: %w", err)
		}

		// 目标不存在，创建记录并写入暂存（强制排他创建）
		record := &Record{
			SchemaVersion: SchemaVersion,
			ID:            change.ID,
			Type:          change.Type,
			RevisionID:    revisionID,
			WorkID:        workID,
			Data:          change.Data,
			CreatedAt:     now,
		}

		stagingRecPath, err := s.locator.RecordStagingPath(workID, revisionID)
		if err != nil {
			return nil, err
		}
		if err := writeJSONToStaging(stagingRecPath, record); err != nil {
			return nil, err
		}

		// 使用无覆盖原语发布记录至 records/ 目录
		if err := moveFileNoReplace(stagingRecPath, recTarget); err != nil {
			_ = os.Remove(stagingRecPath)
			return nil, fmt.Errorf("发布不可变记录 %s 失败: %w", revisionID, err)
		}

		nextRecordRefs[change.ID] = revisionID
		finalRecords[change.ID] = record
	}

	// 9. 准备新提交元数据
	newCommitID, err := GenerateStorageID()
	if err != nil {
		return nil, err
	}

	receipt := CommitReceipt{
		WorkID:      workID,
		Revision:    nextRevision,
		CommitID:    newCommitID,
		OperationID: req.OperationID,
		Committed:   true,
	}

	newCommit := &Commit{
		SchemaVersion:    SchemaVersion,
		ID:               newCommitID,
		WorkID:           workID,
		Revision:         nextRevision,
		BaseRevision:     req.BaseRevision,
		OperationID:      req.OperationID,
		RequestDigest:    reqDigest,
		RecordRefs:       nextRecordRefs,
		PreviousCommitID: work.CurrentCommitID,
		Receipt:          receipt,
		CreatedAt:        now,
	}

	stagingCommitPath, err := s.locator.CommitStagingManifestPath(workID, newCommitID)
	if err != nil {
		return nil, err
	}
	if err := writeJSONToStaging(stagingCommitPath, newCommit); err != nil {
		return nil, err
	}

	newCommitDir, err := s.locator.CommitDir(workID, newCommitID)
	if err != nil {
		return nil, err
	}
	if err := checkNoReparsePoint(newCommitDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(newCommitDir, 0700); err != nil {
		return nil, fmt.Errorf("创建提交目录 %s 失败: %w", newCommitID, err)
	}
	if err := checkNoReparsePoint(newCommitDir); err != nil {
		return nil, err
	}

	targetManifestPath, err := s.locator.CommitManifestPath(workID, newCommitID)
	if err != nil {
		return nil, err
	}

	if _, err := os.Lstat(targetManifestPath); err == nil {
		existingCommit, err := s.getCommit(workID, newCommitID)
		if err != nil {
			return nil, fmt.Errorf("读取已存在提交清单失败: %w", err)
		}
		if existingCommit.RequestDigest != reqDigest {
			return nil, fmt.Errorf("%w: 提交清单 %s 已存在但摘要不符", ErrConflict, newCommitID)
		}
	} else if errors.Is(err, os.ErrNotExist) {
		if err := moveFileNoReplace(stagingCommitPath, targetManifestPath); err != nil {
			_ = os.Remove(stagingCommitPath)
			return nil, fmt.Errorf("发布提交清单失败: %w", err)
		}
	} else {
		return nil, fmt.Errorf("核验提交清单路径失败: %w", err)
	}

	// 10. 单次切换 work.json 权威头指针（严格使用 replaceFileOnly，不盲目覆盖）
	updatedWork := &Work{
		SchemaVersion:   SchemaVersion,
		ID:              workID,
		Title:           work.Title,
		CurrentCommitID: newCommitID,
		Revision:        nextRevision,
		CreatedAt:       work.CreatedAt,
		UpdatedAt:       now,
	}

	stagingWorkPath, err := s.locator.WorkStagingManifestPath(workID)
	if err != nil {
		return nil, err
	}
	if err := writeJSONToStaging(stagingWorkPath, updatedWork); err != nil {
		return nil, err
	}

	workManifestPath, err := s.locator.WorkManifestPath(workID)
	if err != nil {
		return nil, err
	}

	switchErr := replaceFileOnly(stagingWorkPath, workManifestPath)
	if switchErr != nil {
		// 单次替换失败：核查权威当前状态，区分是旧 head 保留还是状态未决，绝不执行额外原语覆盖
		recheckWork, readErr := s.readWorkManifest(workManifestPath)
		if readErr == nil && recheckWork.CurrentCommitID == newCommitID {
			// 实际已成功写入并生效
			switchErr = nil
		} else if readErr == nil && recheckWork.CurrentCommitID == work.CurrentCommitID {
			// 旧 head 严格保留未被破坏
			return nil, fmt.Errorf("%w: 切换权威指针失败，旧版本已安全保留: %v", ErrCommitFailed, switchErr)
		} else {
			// 状态未决，报告明确待确认错误
			return nil, fmt.Errorf("%w: 切换权威指针出现不可确定的错误 (替换错误: %v, 回读错误: %v)", ErrCommitResultUndetermined, switchErr, readErr)
		}
	}

	// 11. 回读确认提交结果
	confirmedWork, err := s.readWorkManifest(workManifestPath)
	if err != nil || confirmedWork.CurrentCommitID != newCommitID {
		return nil, fmt.Errorf("%w: 提交后回读权威清单不匹配", ErrCommitResultUndetermined)
	}

	// 12. 更新可重建索引（权威指针已落盘并回读确认）
	// 核心约束：已提交但索引失败时绝不得误报未提交！
	indexState := IndexStateUpToDate
	if s.indexer != nil {
		if idxErr := s.indexer.IndexWork(confirmedWork, newCommit, finalRecords); idxErr != nil {
			indexState = IndexStatePendingRebuild
		}
	}

	return &CommitResult{
		WorkID:      workID,
		Revision:    nextRevision,
		CommitID:    newCommitID,
		OperationID: req.OperationID,
		Committed:   true,
		IndexState:  indexState,
	}, nil
}

// computeRequestDigest 计算提交请求的 SHA-256 唯一摘要
func computeRequestDigest(workID string, req CommitRequest) (string, error) {
	payload, err := json.Marshal(struct {
		WorkID       string         `json:"workId"`
		BaseRevision int64          `json:"baseRevision"`
		OperationID  string         `json:"operationId"`
		Changes      []RecordChange `json:"changes"`
	}{
		WorkID:       workID,
		BaseRevision: req.BaseRevision,
		OperationID:  req.OperationID,
		Changes:      req.Changes,
	})
	if err != nil {
		return "", fmt.Errorf("%w: 序列化提交请求摘要输入失败: %v", ErrInvalidRequest, err)
	}

	h := sha256.Sum256(payload)
	return hex.EncodeToString(h[:]), nil
}

// checkOperationIdempotency 沿不可变提交历史回溯寻找相同的 operationId，使用 visited 集合检测环，核验 parent.Revision 恰好等于 curr.BaseRevision 且 curr.Revision = curr.BaseRevision + 1
func (s *Store) checkOperationIdempotency(workID string, startCommit *Commit, operationID, reqDigest string) (*CommitResult, bool, error) {
	visited := make(map[string]bool)
	curr := startCommit

	for {
		if visited[curr.ID] {
			return nil, false, fmt.Errorf("%w: 提交历史中检测到循环引用: %s", ErrCorruptData, curr.ID)
		}
		visited[curr.ID] = true

		// 校验当前提交修订号与其基准修订号关系
		if curr.Revision != curr.BaseRevision+1 {
			return nil, false, fmt.Errorf("%w: 提交 %s 修订号 (%d) 不等于基准修订号 (%d) + 1", ErrCorruptData, curr.ID, curr.Revision, curr.BaseRevision)
		}

		if curr.OperationID == operationID {
			if curr.RequestDigest != reqDigest {
				return nil, false, fmt.Errorf("%w: operationId %s 已被使用但请求内容摘要不匹配 (历史: %s, 当前: %s)", ErrConflict, operationID, curr.RequestDigest, reqDigest)
			}
			// 摘要完全一致，命中幂等回执
			indexState := IndexStateUpToDate
			if s.indexer != nil {
				indexed, err := s.indexer.IsWorkIndexed(workID, curr.Receipt.Revision)
				if err != nil || !indexed {
					indexState = IndexStatePendingRebuild
				}
			}
			return &CommitResult{
				WorkID:      curr.Receipt.WorkID,
				Revision:    curr.Receipt.Revision,
				CommitID:    curr.Receipt.CommitID,
				OperationID: curr.Receipt.OperationID,
				Committed:   curr.Receipt.Committed,
				IndexState:  indexState,
			}, true, nil
		}

		if curr.PreviousCommitID == "" {
			if curr.BaseRevision != 0 || curr.Revision != 1 || curr.OperationID == "" || ValidateHashID(curr.RequestDigest) != nil {
				return nil, false, fmt.Errorf("%w: 初始根提交 %s 不符合规范约束 (base=%d, rev=%d, op=%s, digest=%s)", ErrCorruptData, curr.ID, curr.BaseRevision, curr.Revision, curr.OperationID, curr.RequestDigest)
			}
			break
		}

		// 读取父提交；若读取失败（损坏或丢失）必须直接报错拒绝，绝不可 break 忽略损坏历史
		parent, err := s.getCommit(workID, curr.PreviousCommitID)
		if err != nil {
			return nil, false, fmt.Errorf("%w: 读取父提交 %s 失败: %v", ErrCorruptData, curr.PreviousCommitID, err)
		}

		// 检查父提交 revision 必须恰好为当前提交的 baseRevision
		if parent.Revision != curr.BaseRevision {
			return nil, false, fmt.Errorf("%w: 父提交 %s 修订号 (%d) 与子提交基准修订号 (%d) 不匹配", ErrCorruptData, parent.ID, parent.Revision, curr.BaseRevision)
		}

		curr = parent
	}

	return nil, false, nil
}

// validateFinalRecords 构建最终记录集合，并严格执行单类型身份与全量归属引用校验
func validateFinalRecords(locator *PathLocator, workID string, currentRecords map[string]*Record, changes []RecordChange) (map[string]*Record, error) {
	finalRecords := make(map[string]*Record, len(currentRecords)+len(changes))
	for k, v := range currentRecords {
		if v == nil {
			return nil, fmt.Errorf("%w: 当前记录集合包含 nil 记录 (%s)", ErrCorruptData, k)
		}
		finalRecords[k] = v
	}

	// 1. 叠加变更并校验拒绝已有类型改变
	for _, change := range changes {
		if existing, exists := finalRecords[change.ID]; exists {
			if existing.Type != change.Type {
				return nil, fmt.Errorf("%w: 拒绝变更对象 %s 的记录类型从 %s 变为 %s", ErrInvalidRequest, change.ID, existing.Type, change.Type)
			}
		}

		finalRecords[change.ID] = &Record{
			SchemaVersion: SchemaVersion,
			ID:            change.ID,
			Type:          change.Type,
			WorkID:        workID,
			Data:          change.Data,
		}
	}

	// 2. 遍历全量最终记录执行强类型与跨实体归属核查（即使旧记录出现未知类型也必须拒绝）
	canvasBindingCount := 0
	for id, rec := range finalRecords {
		if rec == nil {
			return nil, fmt.Errorf("%w: 最终记录集合包含 nil 记录 (%s)", ErrCorruptData, id)
		}
		if _, ok := ValidRecordTypes[rec.Type]; !ok {
			return nil, fmt.Errorf("%w: 最终记录集合包含未知类型: %s (ID: %s)", ErrCorruptData, rec.Type, id)
		}
		if rec.WorkID != workID {
			return nil, fmt.Errorf("%w: 记录 %s 的 workId (%s) 与当前作品 (%s) 不一致", ErrInvalidRequest, id, rec.WorkID, workID)
		}
		if rec.ID != id {
			return nil, fmt.Errorf("%w: 记录键 %s 与内部 ID %s 不一致", ErrInvalidRequest, id, rec.ID)
		}

		// 分类严格反序列化与按类型身份归属校验
		switch rec.Type {
		case RecordTypeEpisode:
			var ep EpisodeData
			if err := decodeStrictJSONBytes(rec.Data, &ep); err != nil {
				return nil, fmt.Errorf("%w: 解析剧集数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if ep.ID == "" || ep.ID != id {
				return nil, fmt.Errorf("%w: 剧集 %s 声明 ID (%s) 缺失或不匹配", ErrInvalidRequest, id, ep.ID)
			}
			if ep.WorkID == "" || ep.WorkID != workID {
				return nil, fmt.Errorf("%w: 剧集 %s 声明 WorkID (%s) 缺失或不匹配", ErrInvalidRequest, id, ep.WorkID)
			}
			for _, shotID := range ep.CurrentShotIDs {
				target, exists := finalRecords[shotID]
				if !exists || target.Type != RecordTypeShot {
					return nil, fmt.Errorf("%w: 剧集 %s 关联的镜头 %s 不存在或类型不是 shot", ErrInvalidRequest, id, shotID)
				}
				var shotData ShotData
				if err := decodeStrictJSONBytes(target.Data, &shotData); err != nil {
					return nil, fmt.Errorf("%w: 解析关联镜头数据失败: %v", ErrInvalidRequest, err)
				}
				if shotData.EpisodeID != id {
					return nil, fmt.Errorf("%w: 剧集 %s 包含的镜头 %s 归属 episodeId (%s) 不一致", ErrInvalidRequest, id, shotID, shotData.EpisodeID)
				}
			}
			if ep.CurrentScriptRevision != "" {
				target, exists := finalRecords[ep.CurrentScriptRevision]
				if !exists || target.Type != RecordTypeScript {
					return nil, fmt.Errorf("%w: 剧集 %s 关联的剧本修订 %s 不存在或类型不是 script", ErrInvalidRequest, id, ep.CurrentScriptRevision)
				}
				var scriptData ScriptData
				if err := decodeStrictJSONBytes(target.Data, &scriptData); err != nil {
					return nil, fmt.Errorf("%w: 解析关联剧本数据失败: %v", ErrInvalidRequest, err)
				}
				if scriptData.EpisodeID != id {
					return nil, fmt.Errorf("%w: 剧集 %s 关联的剧本 %s 归属 episodeId (%s) 不一致", ErrInvalidRequest, id, ep.CurrentScriptRevision, scriptData.EpisodeID)
				}
			}

		case RecordTypeShot:
			var shot ShotData
			if err := decodeStrictJSONBytes(rec.Data, &shot); err != nil {
				return nil, fmt.Errorf("%w: 解析镜头数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if shot.ID == "" || shot.ID != id {
				return nil, fmt.Errorf("%w: 镜头 %s 声明 ID (%s) 缺失或不匹配", ErrInvalidRequest, id, shot.ID)
			}
			if shot.WorkID == "" || shot.WorkID != workID {
				return nil, fmt.Errorf("%w: 镜头 %s 声明 WorkID (%s) 缺失或不匹配", ErrInvalidRequest, id, shot.WorkID)
			}
			// Shot.CurrentRevision 属于模型强必填字段
			if shot.CurrentRevision == "" {
				return nil, fmt.Errorf("%w: 镜头 %s 的 currentRevision 必须存在", ErrInvalidRequest, id)
			}
			revTarget, exists := finalRecords[shot.CurrentRevision]
			if !exists || revTarget.Type != RecordTypeShotRevision {
				return nil, fmt.Errorf("%w: 镜头 %s 关联的修订版本 %s 不存在或类型不是 shot_revision", ErrInvalidRequest, id, shot.CurrentRevision)
			}
			var revData ShotRevisionData
			if err := decodeStrictJSONBytes(revTarget.Data, &revData); err != nil {
				return nil, fmt.Errorf("%w: 解析关联镜头修订数据失败: %v", ErrInvalidRequest, err)
			}
			if revData.ShotID != id {
				return nil, fmt.Errorf("%w: 镜头 %s 声明的修订 %s 其 shotId (%s) 不匹配", ErrInvalidRequest, id, shot.CurrentRevision, revData.ShotID)
			}

			// EpisodeID 为作品级草稿镜头的可选字段；若存在则检查其有效性与作品归属
			if shot.EpisodeID != "" {
				target, exists := finalRecords[shot.EpisodeID]
				if !exists || target.Type != RecordTypeEpisode {
					return nil, fmt.Errorf("%w: 镜头 %s 关联的剧集 %s 不存在或类型不是 episode", ErrInvalidRequest, id, shot.EpisodeID)
				}
				var epData EpisodeData
				if err := decodeStrictJSONBytes(target.Data, &epData); err != nil {
					return nil, fmt.Errorf("%w: 解析镜头所属剧集数据失败: %v", ErrInvalidRequest, err)
				}
				if epData.WorkID != workID {
					return nil, fmt.Errorf("%w: 镜头 %s 关联的剧集 %s 属于其他作品 (%s)", ErrInvalidRequest, id, shot.EpisodeID, epData.WorkID)
				}
			}
			for _, outID := range shot.SelectedOutputIDs {
				target, exists := finalRecords[outID]
				if !exists || target.Type != RecordTypeMedia {
					return nil, fmt.Errorf("%w: 镜头 %s 选用的输出媒体 %s 不存在或类型不是 media", ErrInvalidRequest, id, outID)
				}
				var mediaData MediaDescriptor
				if err := decodeStrictJSONBytes(target.Data, &mediaData); err != nil {
					return nil, fmt.Errorf("%w: 解析镜头输出媒体数据失败: %v", ErrInvalidRequest, err)
				}
				if mediaData.WorkID != workID {
					return nil, fmt.Errorf("%w: 镜头 %s 输出媒体 %s 属于其他作品 (%s)", ErrInvalidRequest, id, outID, mediaData.WorkID)
				}
			}

		case RecordTypeShotRevision:
			var sr ShotRevisionData
			if err := decodeStrictJSONBytes(rec.Data, &sr); err != nil {
				return nil, fmt.Errorf("%w: 解析镜头修订数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if sr.ID == "" || sr.ID != id {
				return nil, fmt.Errorf("%w: 镜头修订 %s 声明 ID (%s) 缺失或不匹配", ErrInvalidRequest, id, sr.ID)
			}
			if sr.ShotID == "" {
				return nil, fmt.Errorf("%w: 镜头修订 %s 必需关联的 shotId 为空", ErrInvalidRequest, id)
			}
			target, exists := finalRecords[sr.ShotID]
			if !exists || target.Type != RecordTypeShot {
				return nil, fmt.Errorf("%w: 镜头修订 %s 关联的镜头 %s 不存在或类型不是 shot", ErrInvalidRequest, id, sr.ShotID)
			}
			var shotData ShotData
			if err := decodeStrictJSONBytes(target.Data, &shotData); err != nil {
				return nil, fmt.Errorf("%w: 解析关联镜头数据失败: %v", ErrInvalidRequest, err)
			}
			if shotData.WorkID != workID {
				return nil, fmt.Errorf("%w: 镜头修订 %s 所属镜头 %s 属于其他作品 (%s)", ErrInvalidRequest, id, sr.ShotID, shotData.WorkID)
			}
			for _, assetID := range sr.ReferenceAssetIDs {
				t, exists := finalRecords[assetID]
				if !exists || t.Type != RecordTypeAsset {
					return nil, fmt.Errorf("%w: 镜头修订 %s 关联的资产 %s 不存在或类型不是 asset", ErrInvalidRequest, id, assetID)
				}
				var assetData AssetData
				if err := decodeStrictJSONBytes(t.Data, &assetData); err != nil {
					return nil, fmt.Errorf("%w: 解析关联资产数据失败: %v", ErrInvalidRequest, err)
				}
				if assetData.WorkID != workID {
					return nil, fmt.Errorf("%w: 镜头修订 %s 关联资产 %s 属于其他作品 (%s)", ErrInvalidRequest, id, assetID, assetData.WorkID)
				}
			}
			for _, prID := range sr.PromptRevisionIDs {
				t, exists := finalRecords[prID]
				if !exists || t.Type != RecordTypePromptRevision {
					return nil, fmt.Errorf("%w: 镜头修订 %s 关联的提示词修订 %s 不存在或类型不是 prompt_revision", ErrInvalidRequest, id, prID)
				}
				var prData PromptRevisionData
				if err := decodeStrictJSONBytes(t.Data, &prData); err != nil {
					return nil, fmt.Errorf("%w: 解析提示词修订数据失败: %v", ErrInvalidRequest, err)
				}
				if prData.ShotID != sr.ShotID {
					return nil, fmt.Errorf("%w: 镜头修订 %s 与关联提示词 %s 的 shotId (%s vs %s) 不一致", ErrInvalidRequest, id, prID, sr.ShotID, prData.ShotID)
				}
			}

		case RecordTypeAsset:
			var asset AssetData
			if err := decodeStrictJSONBytes(rec.Data, &asset); err != nil {
				return nil, fmt.Errorf("%w: 解析资产数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if asset.ID == "" || asset.ID != id {
				return nil, fmt.Errorf("%w: 资产 %s 声明 ID (%s) 缺失或不匹配", ErrInvalidRequest, id, asset.ID)
			}
			if asset.WorkID == "" || asset.WorkID != workID {
				return nil, fmt.Errorf("%w: 资产 %s 声明 WorkID (%s) 缺失或不匹配", ErrInvalidRequest, id, asset.WorkID)
			}
			if asset.ParentID != "" {
				t, exists := finalRecords[asset.ParentID]
				if !exists || t.Type != RecordTypeAsset {
					return nil, fmt.Errorf("%w: 资产 %s 父级资产 %s 不存在或类型不是 asset", ErrInvalidRequest, id, asset.ParentID)
				}
				var parentAsset AssetData
				if err := decodeStrictJSONBytes(t.Data, &parentAsset); err != nil {
					return nil, fmt.Errorf("%w: 解析父级资产数据失败: %v", ErrInvalidRequest, err)
				}
				if parentAsset.WorkID != workID {
					return nil, fmt.Errorf("%w: 资产 %s 父级资产 %s 属于其他作品 (%s)", ErrInvalidRequest, id, asset.ParentID, parentAsset.WorkID)
				}
			}
			for _, mediaID := range asset.CurrentMediaIDs {
				t, exists := finalRecords[mediaID]
				if !exists || t.Type != RecordTypeMedia {
					return nil, fmt.Errorf("%w: 资产 %s 引用的媒体 %s 不存在或类型不是 media", ErrInvalidRequest, id, mediaID)
				}
				var mediaDesc MediaDescriptor
				if err := decodeStrictJSONBytes(t.Data, &mediaDesc); err != nil {
					return nil, fmt.Errorf("%w: 解析资产媒体数据失败: %v", ErrInvalidRequest, err)
				}
				if mediaDesc.WorkID != workID {
					return nil, fmt.Errorf("%w: 资产 %s 引用的媒体 %s 属于其他作品 (%s)", ErrInvalidRequest, id, mediaID, mediaDesc.WorkID)
				}
			}

		case RecordTypePromptRevision:
			var pr PromptRevisionData
			if err := decodeStrictJSONBytes(rec.Data, &pr); err != nil {
				return nil, fmt.Errorf("%w: 解析提示词修订数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if pr.ID == "" || pr.ID != id {
				return nil, fmt.Errorf("%w: 提示词修订 %s 声明 ID (%s) 缺失或不匹配", ErrInvalidRequest, id, pr.ID)
			}
			if pr.ShotID == "" {
				return nil, fmt.Errorf("%w: 提示词修订 %s 必需关联的 shotId 为空", ErrInvalidRequest, id)
			}
			t, exists := finalRecords[pr.ShotID]
			if !exists || t.Type != RecordTypeShot {
				return nil, fmt.Errorf("%w: 提示词修订 %s 关联的镜头 %s 不存在或类型不是 shot", ErrInvalidRequest, id, pr.ShotID)
			}
			var shotData ShotData
			if err := decodeStrictJSONBytes(t.Data, &shotData); err != nil {
				return nil, fmt.Errorf("%w: 解析关联镜头数据失败: %v", ErrInvalidRequest, err)
			}
			if shotData.WorkID != workID {
				return nil, fmt.Errorf("%w: 提示词修订 %s 所属镜头 %s 属于其他作品 (%s)", ErrInvalidRequest, id, pr.ShotID, shotData.WorkID)
			}
			if pr.SourceRevision != "" {
				t, exists := finalRecords[pr.SourceRevision]
				if !exists || t.Type != RecordTypeShotRevision {
					return nil, fmt.Errorf("%w: 提示词修订 %s 来源修订 %s 不存在或类型不是 shot_revision", ErrInvalidRequest, id, pr.SourceRevision)
				}
				var srData ShotRevisionData
				if err := decodeStrictJSONBytes(t.Data, &srData); err != nil {
					return nil, fmt.Errorf("%w: 解析来源镜头修订数据失败: %v", ErrInvalidRequest, err)
				}
				if srData.ShotID != pr.ShotID {
					return nil, fmt.Errorf("%w: 提示词修订 %s 与来源修订 %s 的 shotId (%s vs %s) 不一致", ErrInvalidRequest, id, pr.SourceRevision, pr.ShotID, srData.ShotID)
				}
			}

		case RecordTypeGeneration:
			var gen GenerationData
			if err := decodeStrictJSONBytes(rec.Data, &gen); err != nil {
				return nil, fmt.Errorf("%w: 解析生成历史数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if gen.ID == "" || gen.ID != id {
				return nil, fmt.Errorf("%w: 生成任务 %s 声明 ID (%s) 缺失或不匹配", ErrInvalidRequest, id, gen.ID)
			}
			if gen.WorkID == "" || gen.WorkID != workID {
				return nil, fmt.Errorf("%w: 生成任务 %s 声明 WorkID (%s) 缺失或不匹配", ErrInvalidRequest, id, gen.WorkID)
			}
			var resolvedShotEpisodeID string
			if gen.ShotID != "" {
				t, exists := finalRecords[gen.ShotID]
				if !exists || t.Type != RecordTypeShot {
					return nil, fmt.Errorf("%w: 生成任务 %s 引用的镜头 %s 不存在或类型不是 shot", ErrInvalidRequest, id, gen.ShotID)
				}
				var shotData ShotData
				if err := decodeStrictJSONBytes(t.Data, &shotData); err != nil {
					return nil, fmt.Errorf("%w: 解析生成关联镜头失败: %v", ErrInvalidRequest, err)
				}
				if shotData.WorkID != workID {
					return nil, fmt.Errorf("%w: 生成任务 %s 关联镜头 %s 属于其他作品 (%s)", ErrInvalidRequest, id, gen.ShotID, shotData.WorkID)
				}
				resolvedShotEpisodeID = shotData.EpisodeID
				if gen.EpisodeID != "" && shotData.EpisodeID != "" && gen.EpisodeID != shotData.EpisodeID {
					return nil, fmt.Errorf("%w: 生成任务 %s episodeId (%s) 与镜头所属 episodeId (%s) 冲突", ErrInvalidRequest, id, gen.EpisodeID, shotData.EpisodeID)
				}
			}
			if gen.SourceRevision != "" {
				t, exists := finalRecords[gen.SourceRevision]
				if !exists || t.Type != RecordTypeShotRevision {
					return nil, fmt.Errorf("%w: 生成任务 %s 来源修订 %s 不存在或类型不是 shot_revision", ErrInvalidRequest, id, gen.SourceRevision)
				}
				var srData ShotRevisionData
				if err := decodeStrictJSONBytes(t.Data, &srData); err != nil {
					return nil, fmt.Errorf("%w: 解析生成来源修订失败: %v", ErrInvalidRequest, err)
				}
				if gen.ShotID != "" && srData.ShotID != gen.ShotID {
					return nil, fmt.Errorf("%w: 生成任务 %s 镜头 (%s) 与来源修订镜头 (%s) 冲突", ErrInvalidRequest, id, gen.ShotID, srData.ShotID)
				}
				if gen.ShotID == "" {
					st, exists := finalRecords[srData.ShotID]
					if !exists || st.Type != RecordTypeShot {
						return nil, fmt.Errorf("%w: 生成任务 %s 来源修订所属镜头 %s 不存在", ErrInvalidRequest, id, srData.ShotID)
					}
					var sData ShotData
					if err := decodeStrictJSONBytes(st.Data, &sData); err != nil {
						return nil, fmt.Errorf("%w: 解析来源修订所属镜头失败: %v", ErrInvalidRequest, err)
					}
					if sData.WorkID != workID {
						return nil, fmt.Errorf("%w: 生成任务 %s 来源修订所属镜头属于其他作品", ErrInvalidRequest, id)
					}
					resolvedShotEpisodeID = sData.EpisodeID
					if gen.EpisodeID != "" && sData.EpisodeID != "" && gen.EpisodeID != sData.EpisodeID {
						return nil, fmt.Errorf("%w: 生成任务 %s episodeId (%s) 与来源修订镜头所属 episodeId (%s) 冲突", ErrInvalidRequest, id, gen.EpisodeID, sData.EpisodeID)
					}
				}
			}
			if gen.EpisodeID != "" {
				t, exists := finalRecords[gen.EpisodeID]
				if !exists || t.Type != RecordTypeEpisode {
					return nil, fmt.Errorf("%w: 生成任务 %s 引用的剧集 %s 不存在或类型不是 episode", ErrInvalidRequest, id, gen.EpisodeID)
				}
				var epData EpisodeData
				if err := decodeStrictJSONBytes(t.Data, &epData); err != nil {
					return nil, fmt.Errorf("%w: 解析生成关联剧集数据失败: %v", ErrInvalidRequest, err)
				}
				if epData.WorkID != workID {
					return nil, fmt.Errorf("%w: 生成任务 %s 关联剧集 %s 属于其他作品 (%s)", ErrInvalidRequest, id, gen.EpisodeID, epData.WorkID)
				}
				if resolvedShotEpisodeID != "" && resolvedShotEpisodeID != gen.EpisodeID {
					return nil, fmt.Errorf("%w: 生成任务 %s 声明剧集 %s 与镜头所属剧集 %s 冲突", ErrInvalidRequest, id, gen.EpisodeID, resolvedShotEpisodeID)
				}
			}
			for _, outID := range gen.OutputFileIDs {
				t, exists := finalRecords[outID]
				if !exists || t.Type != RecordTypeMedia {
					return nil, fmt.Errorf("%w: 生成任务 %s 输出媒体 %s 不存在或类型不是 media", ErrInvalidRequest, id, outID)
				}
				var mediaDesc MediaDescriptor
				if err := decodeStrictJSONBytes(t.Data, &mediaDesc); err != nil {
					return nil, fmt.Errorf("%w: 解析生成输出媒体数据失败: %v", ErrInvalidRequest, err)
				}
				if mediaDesc.WorkID != workID {
					return nil, fmt.Errorf("%w: 生成任务 %s 输出媒体 %s 属于其他作品 (%s)", ErrInvalidRequest, id, outID, mediaDesc.WorkID)
				}
			}

		case RecordTypeScript:
			var script ScriptData
			if err := decodeStrictJSONBytes(rec.Data, &script); err != nil {
				return nil, fmt.Errorf("%w: 解析剧本数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if script.ID == "" || script.ID != id {
				return nil, fmt.Errorf("%w: 剧本 %s 声明 ID (%s) 缺失或不匹配", ErrInvalidRequest, id, script.ID)
			}
			if script.WorkID == "" || script.WorkID != workID {
				return nil, fmt.Errorf("%w: 剧本 %s 声明 WorkID (%s) 缺失或不匹配", ErrInvalidRequest, id, script.WorkID)
			}
			if script.EpisodeID != "" {
				t, exists := finalRecords[script.EpisodeID]
				if !exists || t.Type != RecordTypeEpisode {
					return nil, fmt.Errorf("%w: 剧本 %s 引用的剧集 %s 不存在或类型不是 episode", ErrInvalidRequest, id, script.EpisodeID)
				}
				var epData EpisodeData
				if err := decodeStrictJSONBytes(t.Data, &epData); err != nil {
					return nil, fmt.Errorf("%w: 解析剧本所属剧集数据失败: %v", ErrInvalidRequest, err)
				}
				if epData.WorkID != workID {
					return nil, fmt.Errorf("%w: 剧本 %s 所属剧集 %s 属于其他作品 (%s)", ErrInvalidRequest, id, script.EpisodeID, epData.WorkID)
				}
			}

		case RecordTypeCanvasBinding:
			canvasBindingCount++
			if canvasBindingCount > 1 {
				return nil, fmt.Errorf("%w: 首期一个作品仅允许一条画布绑定记录 (canvas_binding)，当前包含多条", ErrInvalidRequest)
			}
			var binding CanvasBindingData
			if err := decodeStrictJSONBytes(rec.Data, &binding); err != nil {
				return nil, fmt.Errorf("%w: 解析画布绑定数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if binding.WorkID == "" || binding.WorkID != workID {
				return nil, fmt.Errorf("%w: 画布绑定 %s WorkID (%s) 缺失或与当前作品不符", ErrInvalidRequest, id, binding.WorkID)
			}
			if binding.CanvasID == "" {
				return nil, fmt.Errorf("%w: 画布绑定 %s canvasId 不能为空", ErrInvalidRequest, id)
			}
			for nodeID, ref := range binding.NodeRefs {
				if nodeID == "" || ref.ObjectID == "" {
					return nil, fmt.Errorf("%w: 画布绑定节点引用非法 (nodeId: %s)", ErrInvalidRequest, nodeID)
				}
			}
			for _, cur := range currentRecords {
				if cur.Type == RecordTypeCanvasBinding {
					var curBinding CanvasBindingData
					if err := decodeStrictJSONBytes(cur.Data, &curBinding); err == nil {
						if curBinding.CanvasID != "" && curBinding.CanvasID != binding.CanvasID {
							return nil, fmt.Errorf("%w: 当前作品已绑定画布 %s，拒绝静默绑定至不同画布 %s", ErrConflict, curBinding.CanvasID, binding.CanvasID)
						}
					}
				}
			}

		case RecordTypeMigration:
			var mig MigrationData
			if err := decodeStrictJSONBytes(rec.Data, &mig); err != nil {
				return nil, fmt.Errorf("%w: 解析迁移数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}

		case RecordTypeArchive:
			var arch ArchiveData
			if err := decodeStrictJSONBytes(rec.Data, &arch); err != nil {
				return nil, fmt.Errorf("%w: 解析归档数据失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if arch.ID == "" || arch.ID != id {
				return nil, fmt.Errorf("%w: 归档项 %s 声明 ID (%s) 缺失或不匹配", ErrInvalidRequest, id, arch.ID)
			}
			if arch.WorkID == "" || arch.WorkID != workID {
				return nil, fmt.Errorf("%w: 归档项 %s 声明 WorkID (%s) 缺失或不匹配", ErrInvalidRequest, id, arch.WorkID)
			}

		case RecordTypeMedia:
			var desc MediaDescriptor
			if err := decodeStrictJSONBytes(rec.Data, &desc); err != nil {
				return nil, fmt.Errorf("%w: 解析媒体描述符失败 (%s): %v", ErrInvalidRequest, id, err)
			}
			if desc.FileID == "" {
				return nil, fmt.Errorf("%w: 媒体 fileId 不能为空", ErrInvalidRequest)
			}
			if err := ValidateStorageID(desc.FileID); err != nil {
				return nil, fmt.Errorf("%w: 媒体 fileId 非法: %v", ErrInvalidRequest, err)
			}
			if desc.FileID != id {
				return nil, fmt.Errorf("%w: 媒体 fileId (%s) 与记录 ID (%s) 不一致", ErrInvalidRequest, desc.FileID, id)
			}
			if desc.WorkID == "" || desc.WorkID != workID {
				return nil, fmt.Errorf("%w: 媒体 workId (%s) 缺失或与当前作品不一致", ErrInvalidRequest, desc.WorkID)
			}
			if err := ValidateHashID(desc.SHA256); err != nil {
				return nil, fmt.Errorf("%w: 媒体哈希非法: %v", ErrInvalidRequest, err)
			}
			if desc.Bytes <= 0 {
				return nil, fmt.Errorf("%w: 媒体大小必须大于 0", ErrInvalidRequest)
			}

			// 校验 MIME 与 Kind、Extension 一致性
			expectedExt, expectedKind, err := NormalizeMediaExtension(desc.MIMEType)
			if err != nil || desc.Kind != expectedKind || desc.Extension != expectedExt {
				return nil, fmt.Errorf("%w: 媒体记录 %s 的 MIME (%s) 与声明的扩展名 (%s) 或类型 (%s) 不符", ErrInvalidRequest, id, desc.MIMEType, desc.Extension, desc.Kind)
			}

			// 收敛的统一物理原件存在与 SHA-256 校验（覆盖全量最终集合中的全部媒体）
			if err := validatePhysicalMedia(locator, workID, &desc); err != nil {
				return nil, err
			}
		}
	}

	return finalRecords, nil
}

// validatePhysicalMedia 统一核验媒体物理原件是否存在、大小匹配且流式 SHA-256 内容摘要完全一致
func validatePhysicalMedia(locator *PathLocator, workID string, desc *MediaDescriptor) error {
	physPath, err := locator.MediaPath(workID, desc.SHA256, desc.Extension)
	if err != nil {
		return fmt.Errorf("核验媒体物理路径失败: %w", err)
	}

	fi, err := os.Lstat(physPath)
	if err != nil {
		return fmt.Errorf("%w: 媒体物理原件不存在或不可达 (%s): %v", ErrInvalidRequest, physPath, err)
	}
	if fi.Size() != desc.Bytes {
		return fmt.Errorf("%w: 物理原件大小 (%d) 与描述符声明大小 (%d) 不一致: %s", ErrInvalidRequest, fi.Size(), desc.Bytes, desc.FileID)
	}

	realHash, err := hashFileStream(physPath)
	if err != nil {
		return fmt.Errorf("核验物理原件摘要失败: %w", err)
	}
	if realHash != desc.SHA256 {
		return fmt.Errorf("%w: 物理原件内容摘要 (%s) 与描述符声明 (%s) 不符: %s", ErrInvalidRequest, realHash, desc.SHA256, desc.FileID)
	}

	return nil
}
