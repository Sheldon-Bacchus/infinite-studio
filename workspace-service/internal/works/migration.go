package works

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// validateZipSecurity 严格检查 ZIP 包内所有条目的路径安全性，杜绝大小写重复、符号链接、反斜杠、路径穿越、绝对路径、Windows 设备名及非法字符
func validateZipSecurity(zr *zip.Reader) error {
	seenLower := make(map[string]bool, len(zr.File))
	for _, f := range zr.File {
		// 1. 拒绝大小写重复条目
		lowerName := strings.ToLower(f.Name)
		if seenLower[lowerName] {
			return fmt.Errorf("%w: ZIP 包包含大小写重复条目: %s", ErrInvalidRequest, f.Name)
		}
		seenLower[lowerName] = true

		// 2. 拒绝符号链接等非普通文件
		if f.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("%w: ZIP 包包含符号链接条目: %s", ErrInvalidRequest, f.Name)
		}

		// 3. 拒绝反斜杠路径
		if strings.Contains(f.Name, "\\") {
			return fmt.Errorf("%w: ZIP 包包含反斜杠路径条目: %s", ErrInvalidRequest, f.Name)
		}

		// 4. 拒绝绝对路径
		cleanName := filepath.Clean(f.Name)
		if cleanName == "." || cleanName == "" {
			continue
		}
		if filepath.IsAbs(cleanName) || strings.HasPrefix(f.Name, "/") {
			return fmt.Errorf("%w: ZIP 包包含绝对路径条目: %s", ErrInvalidRequest, f.Name)
		}

		// 5. 拒绝路径穿越及 .. 段
		if cleanName == ".." || strings.HasPrefix(cleanName, "../") || strings.Contains(cleanName, "/../") || strings.HasSuffix(cleanName, "/..") {
			return fmt.Errorf("%w: ZIP 包包含路径穿越条目: %s", ErrPathOutOfBounds, f.Name)
		}

		// 6. 校验各路径段无冒号、控制字符及 Windows 保留设备名称
		parts := strings.Split(f.Name, "/")
		for _, part := range parts {
			if part == ".." {
				return fmt.Errorf("%w: ZIP 条目包含上级路径段 (..): %s", ErrPathOutOfBounds, f.Name)
			}
			if strings.ContainsAny(part, `:*"<>|?`) {
				return fmt.Errorf("%w: ZIP 条目包含非法字符: %s", ErrInvalidRequest, f.Name)
			}
			if isDOSDeviceName(part) {
				return fmt.Errorf("%w: ZIP 条目包含 Windows 保留设备名: %s", ErrInvalidRequest, f.Name)
			}
		}
	}
	return nil
}

// computeMigrationSubstantiveDigest 计算迁移清单的实质内容 SHA-256 摘要（前后端共同以固定字段顺序的标准 JSON 数组 [sourceId,sourceType,sourceSnapshotDigest,sortedEntityHashes,sortedFileHashes] 计算，服务用 SetEscapeHTML(false) 编码去末尾换行）
func computeMigrationSubstantiveDigest(manifest *MigrationManifest, sourceSnapshotDigest string) (string, error) {
	if manifest == nil {
		return "", fmt.Errorf("%w: 清单不能为空", ErrInvalidRequest)
	}

	entityHashes := make([]string, 0, len(manifest.Entities))
	for _, ent := range manifest.Entities {
		var normBuf bytes.Buffer
		if len(ent.Data) > 0 {
			if err := json.Compact(&normBuf, ent.Data); err != nil {
				return "", fmt.Errorf("规范化实体数据失败: %w", err)
			}
		}
		h := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s", ent.TargetID, ent.Type, normBuf.String())))
		entityHashes = append(entityHashes, hex.EncodeToString(h[:]))
	}
	sort.Strings(entityHashes)

	fileHashes := make([]string, 0, len(manifest.Files))
	for _, file := range manifest.Files {
		fileHashes = append(fileHashes, file.SHA256)
	}
	sort.Strings(fileHashes)

	arr := []any{
		manifest.SourceID,
		manifest.SourceType,
		sourceSnapshotDigest,
		entityHashes,
		fileHashes,
	}

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(arr); err != nil {
		return "", fmt.Errorf("编码实质摘要数组失败: %w", err)
	}
	payload := bytes.TrimRight(buf.Bytes(), "\r\n")
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

// PreviewMigration 预览待导入的迁移来源包。
// 规则：只读验证缺件、哈希、冲突与映射，生成预期操作概要，不发布业务数据，不修改权威状态。
func (s *Store) PreviewMigration(workID string, zipBytes []byte) (*MigrationPreviewResult, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}
	if len(zipBytes) == 0 {
		return nil, fmt.Errorf("%w: 备份数据包不能为空", ErrInvalidRequest)
	}

	// 1. 确认目标作品存在
	work, err := s.getWork(workID)
	if err != nil {
		return nil, err
	}
	_ = work

	// 2. 解构与安全校验 ZIP
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("%w: 读取 ZIP 备份包失败: %v", ErrCorruptData, err)
	}
	if err := validateZipSecurity(zr); err != nil {
		return nil, err
	}

	// 建立文件索引表
	zipFileMap := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		cleanPath := filepath.ToSlash(f.Name)
		zipFileMap[cleanPath] = f
	}

	// 3. 读取 manifest.json 与 source.json
	manifestEntry, ok := zipFileMap["manifest.json"]
	if !ok {
		return nil, fmt.Errorf("%w: 备份包缺少根目录 manifest.json", ErrCorruptData)
	}
	sourceEntry, ok := zipFileMap["source.json"]
	if !ok {
		return nil, fmt.Errorf("%w: 备份包缺少原始业务快照 source.json", ErrCorruptData)
	}

	sf, err := sourceEntry.Open()
	if err != nil {
		return nil, fmt.Errorf("打开 source.json 失败: %w", err)
	}
	sourceBytes, err := io.ReadAll(sf)
	sf.Close()
	if err != nil {
		return nil, fmt.Errorf("读取 source.json 失败: %w", err)
	}
	sourceSnapHash := sha256.Sum256(sourceBytes)
	sourceSnapshotDigest := hex.EncodeToString(sourceSnapHash[:])

	mf, err := manifestEntry.Open()
	if err != nil {
		return nil, fmt.Errorf("打开 manifest.json 失败: %w", err)
	}
	defer mf.Close()

	var manifest MigrationManifest
	if err := decodeStrictJSON(mf, &manifest); err != nil {
		return nil, fmt.Errorf("%w: 解析 manifest.json 失败: %v", ErrCorruptData, err)
	}

	if manifest.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("%w: 不受支持的迁移清单版本 (%d)", ErrCorruptData, manifest.SchemaVersion)
	}
	if manifest.SourceID == "" {
		return nil, fmt.Errorf("%w: 迁移清单 sourceId 不能为空", ErrCorruptData)
	}
	if err := ValidateHashID(manifest.SourceDigest); err != nil {
		return nil, fmt.Errorf("%w: 迁移清单 sourceDigest 非法: %v", ErrCorruptData, err)
	}

	conflicts := make([]ConflictInfo, 0)

	// 校验 sourceSnapshotDigest (Point 3)
	if manifest.SourceSnapshotDigest != "" && manifest.SourceSnapshotDigest != sourceSnapshotDigest {
		conflicts = append(conflicts, ConflictInfo{
			Type:    "source_snapshot_mismatch",
			Message: fmt.Sprintf("原始快照内容哈希不符 (清单声明: %s, 实际计算: %s)", manifest.SourceSnapshotDigest, sourceSnapshotDigest),
		})
	}

	// 重新计算并比对实质内容摘要 (Point 3)
	calcDigest, err := computeMigrationSubstantiveDigest(&manifest, sourceSnapshotDigest)
	if err != nil {
		return nil, fmt.Errorf("计算迁移实质摘要失败: %w", err)
	}
	if manifest.SourceDigest != calcDigest {
		conflicts = append(conflicts, ConflictInfo{
			Type:    "source_digest_mismatch",
			Message: fmt.Sprintf("迁移实质内容摘要不匹配 (清单声明: %s, 实际计算: %s)", manifest.SourceDigest, calcDigest),
		})
	}

	// 4. 校验包内媒体原件并收集缺失文件列表 (Point 4 & Point 8)
	missingFiles := make([]MissingFileInfo, 0)
	missingFiles = append(missingFiles, manifest.MissingFiles...)

	for _, fileInfo := range manifest.Files {
		cleanFilePath := filepath.ToSlash(fileInfo.Path)

		// 规范化 MIME 并核对标准路径格式: files/<hash><safeExt>
		safeExt, _, err := NormalizeMediaExtension(fileInfo.MIMEType)
		if err != nil {
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   fileInfo.Path,
				Reason: fmt.Sprintf("不支持或非法的媒体 MIME 类型: %s", fileInfo.MIMEType),
				SHA256: fileInfo.SHA256,
			})
			continue
		}
		expectedPath := fmt.Sprintf("files/%s%s", fileInfo.SHA256, safeExt)
		if cleanFilePath != expectedPath {
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   fileInfo.Path,
				Reason: fmt.Sprintf("文件路径不符合规范 files/<hash><规范扩展名> (预期 %s, 实际 %s)", expectedPath, fileInfo.Path),
				SHA256: fileInfo.SHA256,
			})
			continue
		}

		zf, exists := zipFileMap[cleanFilePath]
		if !exists {
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   fileInfo.Path,
				Reason: "ZIP 备份包中缺少声明的媒体原件",
				SHA256: fileInfo.SHA256,
			})
			continue
		}

		if int64(zf.UncompressedSize64) != fileInfo.Bytes {
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   fileInfo.Path,
				Reason: fmt.Sprintf("文件大小不匹配 (声明 %d, 实际 %d)", fileInfo.Bytes, zf.UncompressedSize64),
				SHA256: fileInfo.SHA256,
			})
			continue
		}

		// 流式读取并核验 SHA-256
		rc, err := zf.Open()
		if err != nil {
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   fileInfo.Path,
				Reason: fmt.Sprintf("打开 ZIP 内文件失败: %v", err),
				SHA256: fileInfo.SHA256,
			})
			continue
		}
		hasher := sha256.New()
		if _, err := io.Copy(hasher, rc); err != nil {
			rc.Close()
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   fileInfo.Path,
				Reason: fmt.Sprintf("校验文件哈希读取失败: %v", err),
				SHA256: fileInfo.SHA256,
			})
			continue
		}
		rc.Close()

		calcHash := hex.EncodeToString(hasher.Sum(nil))
		if calcHash != fileInfo.SHA256 {
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   fileInfo.Path,
				Reason: fmt.Sprintf("文件内容哈希不匹配 (声明 %s, 实际 %s)", fileInfo.SHA256, calcHash),
				SHA256: fileInfo.SHA256,
			})
		}
	}

	// 5. 核对当前作品冲突与覆盖情况 (Point 2, 4)
	currentRecords, err := s.getCurrentRecords(workID)
	if err != nil {
		return nil, fmt.Errorf("读取作品当前记录集合失败: %w", err)
	}

	alreadyMigratedSame := false
	hasDifferentDigestConflict := false

	for _, rec := range currentRecords {
		if rec.Type == RecordTypeMigration {
			var mig MigrationData
			if err := decodeStrictJSONBytes(rec.Data, &mig); err != nil {
				// 已有 migration 数据解码失败必须返回错误，不能静默忽略 (Point 2)
				return nil, fmt.Errorf("%w: 解码已有迁移记录 %s 失败: %v", ErrCorruptData, rec.ID, err)
			}
			if mig.SourceID == manifest.SourceID {
				if mig.SourceDigest == manifest.SourceDigest {
					alreadyMigratedSame = true
					conflicts = append(conflicts, ConflictInfo{
						Type:    "already_migrated",
						Message: "当前作品已包含完全一致的来源版本（提交将执行幂等复用）",
					})
				} else {
					hasDifferentDigestConflict = true
					conflicts = append(conflicts, ConflictInfo{
						Type:    "source_digest_conflict",
						Message: fmt.Sprintf("同一来源曾以不同内容摘要迁移过 (现有: %s, 待导入: %s)，请核实版本", mig.SourceDigest, manifest.SourceDigest),
					})
				}
			}
		}
	}

	// 校验清单实体关系及已有实体覆盖冲突 (Point 4)
	manifestEntityMap := make(map[string]MigrationEntityItem, len(manifest.Entities))
	for _, ent := range manifest.Entities {
		if ent.TargetID == "" {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "invalid_entity",
				Message: fmt.Sprintf("实体缺少 TargetID (sourceId=%s)", ent.SourceID),
			})
			continue
		}
		if err := ValidateStorageID(ent.TargetID); err != nil {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "invalid_entity",
				Message: fmt.Sprintf("实体 TargetID 非法 (%s): %v", ent.TargetID, err),
			})
			continue
		}
		if _, exists := manifestEntityMap[ent.TargetID]; exists {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "duplicate_entity_id",
				Message: fmt.Sprintf("迁移清单中包含重复 TargetID: %s", ent.TargetID),
			})
			continue
		}
		if _, ok := ValidRecordTypes[ent.Type]; !ok {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "unknown_entity_type",
				Message: fmt.Sprintf("迁移清单包含未知记录类型: %s (TargetID: %s)", ent.Type, ent.TargetID),
			})
			continue
		}
		manifestEntityMap[ent.TargetID] = ent

		if _, exists := currentRecords[ent.TargetID]; exists && !alreadyMigratedSame {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "entity_conflict",
				Message: fmt.Sprintf("目标实体 %s (%s) 已存在于当前作品中，可能发生覆盖冲突", ent.TargetID, ent.Type),
			})
		}
	}

	// 校验内部实体关键关联引用及 Schema 解码合规 (Point 4)
	checkRefExists := func(targetID string, expectedType string, desc string, fromID string) {
		if targetID == "" {
			return
		}
		if ent, exists := manifestEntityMap[targetID]; exists {
			if expectedType != "" && ent.Type != expectedType {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "broken_relationship",
					Message: fmt.Sprintf("实体 %s 引用的 %s (%s) 类型不匹配 (预期 %s, 实际 %s)", fromID, desc, targetID, expectedType, ent.Type),
				})
			}
			return
		}
		if rec, exists := currentRecords[targetID]; exists {
			if expectedType != "" && rec.Type != expectedType {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "broken_relationship",
					Message: fmt.Sprintf("实体 %s 引用的已有记录 %s (%s) 类型不匹配 (预期 %s, 实际 %s)", fromID, desc, targetID, expectedType, rec.Type),
				})
			}
			return
		}
		conflicts = append(conflicts, ConflictInfo{
			Type:    "broken_relationship",
			Message: fmt.Sprintf("实体 %s 关联的 %s %s 不存在", fromID, desc, targetID),
		})
	}

	for _, ent := range manifest.Entities {
		switch ent.Type {
		case RecordTypeEpisode:
			var ep EpisodeData
			if err := decodeStrictJSONBytes(ent.Data, &ep); err != nil {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "schema_decode_error",
					Message: fmt.Sprintf("解码剧集实体 %s 失败: %v", ent.TargetID, err),
				})
				continue
			}
			for _, shotID := range ep.CurrentShotIDs {
				checkRefExists(shotID, RecordTypeShot, "分集镜头", ent.TargetID)
			}
			if ep.CurrentScriptRevision != "" {
				checkRefExists(ep.CurrentScriptRevision, RecordTypeScript, "分集剧本", ent.TargetID)
			}
		case RecordTypeScript:
			var sc ScriptData
			if err := decodeStrictJSONBytes(ent.Data, &sc); err != nil {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "schema_decode_error",
					Message: fmt.Sprintf("解码剧本实体 %s 失败: %v", ent.TargetID, err),
				})
				continue
			}
			if sc.EpisodeID != "" {
				checkRefExists(sc.EpisodeID, RecordTypeEpisode, "剧本所属分集", ent.TargetID)
			}
		case RecordTypeShot:
			var shot ShotData
			if err := decodeStrictJSONBytes(ent.Data, &shot); err != nil {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "schema_decode_error",
					Message: fmt.Sprintf("解码镜头实体 %s 失败: %v", ent.TargetID, err),
				})
				continue
			}
			if shot.CurrentRevision == "" {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "broken_relationship",
					Message: fmt.Sprintf("镜头 %s 缺少必须的 currentRevision", ent.TargetID),
				})
			} else {
				checkRefExists(shot.CurrentRevision, RecordTypeShotRevision, "镜头当前修订", ent.TargetID)
			}
			if shot.EpisodeID != "" {
				checkRefExists(shot.EpisodeID, RecordTypeEpisode, "镜头所属分集", ent.TargetID)
			}
			for _, outID := range shot.SelectedOutputIDs {
				checkRefExists(outID, RecordTypeMedia, "镜头输出媒体", ent.TargetID)
			}
		case RecordTypeShotRevision:
			var sr ShotRevisionData
			if err := decodeStrictJSONBytes(ent.Data, &sr); err != nil {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "schema_decode_error",
					Message: fmt.Sprintf("解码镜头修订实体 %s 失败: %v", ent.TargetID, err),
				})
				continue
			}
			if sr.ShotID == "" {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "broken_relationship",
					Message: fmt.Sprintf("镜头修订 %s 缺少必需关联的 shotId", ent.TargetID),
				})
			} else {
				checkRefExists(sr.ShotID, RecordTypeShot, "所属镜头", ent.TargetID)
			}
			for _, refID := range sr.ReferenceAssetIDs {
				checkRefExists(refID, RecordTypeAsset, "关联资产", ent.TargetID)
			}
			for _, prID := range sr.PromptRevisionIDs {
				checkRefExists(prID, RecordTypePromptRevision, "关联提示词修订", ent.TargetID)
			}
		case RecordTypeAsset:
			var asset AssetData
			if err := decodeStrictJSONBytes(ent.Data, &asset); err != nil {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "schema_decode_error",
					Message: fmt.Sprintf("解码资产实体 %s 失败: %v", ent.TargetID, err),
				})
				continue
			}
			if asset.ParentID != "" {
				checkRefExists(asset.ParentID, RecordTypeAsset, "父级资产", ent.TargetID)
			}
			for _, mediaID := range asset.CurrentMediaIDs {
				checkRefExists(mediaID, RecordTypeMedia, "资产关联媒体", ent.TargetID)
			}
		case RecordTypePromptRevision:
			var pr PromptRevisionData
			if err := decodeStrictJSONBytes(ent.Data, &pr); err != nil {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "schema_decode_error",
					Message: fmt.Sprintf("解码提示词修订实体 %s 失败: %v", ent.TargetID, err),
				})
				continue
			}
			if pr.ShotID == "" {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "broken_relationship",
					Message: fmt.Sprintf("提示词修订 %s 必需关联的 shotId 为空", ent.TargetID),
				})
			} else {
				checkRefExists(pr.ShotID, RecordTypeShot, "所属镜头", ent.TargetID)
			}
			if pr.SourceRevision != "" {
				checkRefExists(pr.SourceRevision, RecordTypeShotRevision, "来源镜头修订", ent.TargetID)
			}
		case RecordTypeMedia:
			var md MediaDescriptor
			if err := decodeStrictJSONBytes(ent.Data, &md); err != nil {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "schema_decode_error",
					Message: fmt.Sprintf("解码媒体描述符 %s 失败: %v", ent.TargetID, err),
				})
				continue
			}
		}
	}

	// 6. 生成操作概要统计
	operations := make([]OperationInfo, 0)
	entityCounts := make(map[string]int)
	for _, ent := range manifest.Entities {
		entityCounts[ent.Type]++
	}
	for typ, count := range entityCounts {
		operations = append(operations, OperationInfo{
			Action:     fmt.Sprintf("create_%s", typ),
			TargetID:   "",
			TargetName: fmt.Sprintf("创建 %s 实体记录", typ),
			Details:    fmt.Sprintf("预计创建 %d 项 %s 记录", count, typ),
		})
	}
	if len(manifest.Files) > 0 {
		operations = append(operations, OperationInfo{
			Action:     "register_media",
			TargetID:   "",
			TargetName: "登记媒体物理原件",
			Details:    fmt.Sprintf("预计去重登记 %d 个物理媒体文件", len(manifest.Files)),
		})
	}

	// 检查是否存在阻断性冲突
	hasBlockingConflict := hasDifferentDigestConflict || manifest.SourceDigest != calcDigest
	for _, c := range conflicts {
		if c.Type != "already_migrated" {
			hasBlockingConflict = true
			break
		}
	}

	canCommit := len(missingFiles) == 0 && !hasBlockingConflict

	return &MigrationPreviewResult{
		SourceID:       manifest.SourceID,
		SourceDigest:   manifest.SourceDigest,
		SourceType:     manifest.SourceType,
		Title:          manifest.Title,
		EntityMappings: manifest.EntityMappings,
		FileMappings:   manifest.FileMappings,
		MissingFiles:   missingFiles,
		Conflicts:      conflicts,
		Operations:     operations,
		CanCommit:      canCommit,
	}, nil
}

// CommitMigration 显式提交迁移包并发布不可变版本。
// 规则：
// 1. 锁序：maintenanceMu.RLock() -> workLock -> idx.mu。
// 2. 重新核验摘要与缺件，缺失原件严禁静默发布。
// 3. 先将整个来源包和清单持久发布到 root/backups/<backupID>/，拒绝覆盖和重解析点。
// 4. 持有作品锁将媒体原件按哈希登记入 media/，将映射与转换后记录发布到 records/，原子切换 work.json 并更新索引。
// 5. 相同 sourceId+sourceDigest 幂等返回已有 commit 结果。
func (s *Store) CommitMigration(workID string, baseRevision int64, operationID string, zipBytes []byte) (*MigrationCommitResult, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}
	if operationID == "" {
		return nil, fmt.Errorf("%w: operationId 不能为空", ErrInvalidRequest)
	}
	if baseRevision < 1 {
		return nil, fmt.Errorf("%w: baseRevision 必须大于等于 1", ErrInvalidRequest)
	}
	if len(zipBytes) == 0 {
		return nil, fmt.Errorf("%w: 备份数据包不能为空", ErrInvalidRequest)
	}

	// 1. 读取并安全校验 ZIP
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("%w: 读取 ZIP 备份包失败: %v", ErrCorruptData, err)
	}
	if err := validateZipSecurity(zr); err != nil {
		return nil, err
	}

	zipFileMap := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		cleanPath := filepath.ToSlash(f.Name)
		zipFileMap[cleanPath] = f
	}

	manifestEntry, ok := zipFileMap["manifest.json"]
	if !ok {
		return nil, fmt.Errorf("%w: 备份包缺少根目录 manifest.json", ErrCorruptData)
	}
	sourceEntry, ok := zipFileMap["source.json"]
	if !ok {
		return nil, fmt.Errorf("%w: 备份包缺少原始业务快照 source.json", ErrCorruptData)
	}

	sf, err := sourceEntry.Open()
	if err != nil {
		return nil, fmt.Errorf("打开 source.json 失败: %w", err)
	}
	sourceBytes, err := io.ReadAll(sf)
	sf.Close()
	if err != nil {
		return nil, fmt.Errorf("读取 source.json 失败: %w", err)
	}
	sourceSnapHash := sha256.Sum256(sourceBytes)
	sourceSnapshotDigest := hex.EncodeToString(sourceSnapHash[:])

	mf, err := manifestEntry.Open()
	if err != nil {
		return nil, fmt.Errorf("打开 manifest.json 失败: %w", err)
	}
	defer mf.Close()

	var manifest MigrationManifest
	if err := decodeStrictJSON(mf, &manifest); err != nil {
		return nil, fmt.Errorf("%w: 解析 manifest.json 失败: %v", ErrCorruptData, err)
	}

	if manifest.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("%w: 不受支持的迁移清单版本 (%d)", ErrCorruptData, manifest.SchemaVersion)
	}
	if manifest.SourceID == "" {
		return nil, fmt.Errorf("%w: 迁移清单 sourceId 不能为空", ErrCorruptData)
	}
	if err := ValidateHashID(manifest.SourceDigest); err != nil {
		return nil, fmt.Errorf("%w: 迁移清单 sourceDigest 非法: %v", ErrCorruptData, err)
	}

	// 校验 sourceSnapshotDigest (Point 3)
	if manifest.SourceSnapshotDigest != "" && manifest.SourceSnapshotDigest != sourceSnapshotDigest {
		return nil, fmt.Errorf("%w: 备份包原始快照摘要与声明不符", ErrCorruptData)
	}

	// 重新计算并比对实质内容摘要 (Point 3)
	calcDigest, err := computeMigrationSubstantiveDigest(&manifest, sourceSnapshotDigest)
	if err != nil {
		return nil, fmt.Errorf("计算迁移实质内容摘要失败: %w", err)
	}
	if manifest.SourceDigest != calcDigest {
		return nil, fmt.Errorf("%w: 迁移实质内容摘要校验失败 (声明 %s, 实际计算 %s)", ErrCorruptData, manifest.SourceDigest, calcDigest)
	}

	// 2. 强校验：缺失原件或哈希不符时严禁静默发布 (Point 4)
	if len(manifest.MissingFiles) > 0 {
		return nil, fmt.Errorf("%w: 备份包存在已知缺失原件 (%d 项)，拒绝提交", ErrCorruptData, len(manifest.MissingFiles))
	}

	for _, fileInfo := range manifest.Files {
		cleanFilePath := filepath.ToSlash(fileInfo.Path)
		safeExt, _, err := NormalizeMediaExtension(fileInfo.MIMEType)
		if err != nil {
			return nil, fmt.Errorf("%w: 媒体文件 MIME 类型非法 (%s): %v", ErrCorruptData, fileInfo.MIMEType, err)
		}
		expectedPath := fmt.Sprintf("files/%s%s", fileInfo.SHA256, safeExt)
		if cleanFilePath != expectedPath {
			return nil, fmt.Errorf("%w: 媒体文件路径不符合规范格式 files/<hash><ext> (%s vs %s)", ErrCorruptData, fileInfo.Path, expectedPath)
		}

		zf, exists := zipFileMap[cleanFilePath]
		if !exists {
			return nil, fmt.Errorf("%w: 备份包缺少媒体原件: %s", ErrCorruptData, fileInfo.Path)
		}
		if int64(zf.UncompressedSize64) != fileInfo.Bytes {
			return nil, fmt.Errorf("%w: 媒体原件大小不符 (%s): 声明 %d, 实际 %d", ErrCorruptData, fileInfo.Path, fileInfo.Bytes, zf.UncompressedSize64)
		}
		rc, err := zf.Open()
		if err != nil {
			return nil, fmt.Errorf("打开媒体原件 %s 失败: %w", fileInfo.Path, err)
		}
		hasher := sha256.New()
		if _, err := io.Copy(hasher, rc); err != nil {
			rc.Close()
			return nil, fmt.Errorf("读取媒体原件 %s 校验摘要失败: %w", fileInfo.Path, err)
		}
		rc.Close()
		if hex.EncodeToString(hasher.Sum(nil)) != fileInfo.SHA256 {
			return nil, fmt.Errorf("%w: 媒体原件内容哈希与声明不符: %s", ErrCorruptData, fileInfo.Path)
		}
	}

	// 3. 获取作品互斥锁，统一在同一锁内完成 head 读取、幂等/重复来源检测、CAS、备份、媒体登记与提交 (Point 1, 6)
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

	if currentCommit.Revision != work.Revision {
		return nil, fmt.Errorf("%w: 当前提交清单修订号 (%d) 与权威清单修订号 (%d) 不一致", ErrCorruptData, currentCommit.Revision, work.Revision)
	}

	currentRecords, err := s.getCurrentRecords(workID)
	if err != nil {
		return nil, fmt.Errorf("读取当前记录集合失败: %w", err)
	}

	// 4. 重复来源判断在 CAS 之前完成，丢失回执重试不被旧 baseRevision 阻断 (Point 6)
	// (1) 检查历史提交中是否已存在当前 operationId
	var opMatchedCommit *Commit
	curr := currentCommit
	visited := make(map[string]bool)
	for {
		if visited[curr.ID] {
			return nil, fmt.Errorf("%w: 提交历史中检测到循环引用: %s", ErrCorruptData, curr.ID)
		}
		visited[curr.ID] = true
		if curr.Revision != curr.BaseRevision+1 {
			return nil, fmt.Errorf("%w: 提交 %s 修订号 (%d) 不等于基准修订号 (%d) + 1", ErrCorruptData, curr.ID, curr.Revision, curr.BaseRevision)
		}
		if curr.OperationID == operationID {
			opMatchedCommit = curr
			break
		}
		if curr.PreviousCommitID == "" {
			if curr.BaseRevision != 0 || curr.Revision != 1 || curr.OperationID == "" || ValidateHashID(curr.RequestDigest) != nil {
				return nil, fmt.Errorf("%w: 初始根提交 %s 不符合规范约束", ErrCorruptData, curr.ID)
			}
			break
		}
		prev, prevErr := s.getCommit(workID, curr.PreviousCommitID)
		if prevErr != nil {
			return nil, fmt.Errorf("%w: 沿提交历史回溯失败: %v", ErrCorruptData, prevErr)
		}
		if prev.Revision != curr.BaseRevision {
			return nil, fmt.Errorf("%w: 父提交 %s 修订号 (%d) 与当前提交 baseRevision (%d) 不一致", ErrCorruptData, prev.ID, prev.Revision, curr.BaseRevision)
		}
		curr = prev
	}

	// (2) 检查当前记录中是否已存在相同 sourceId 的迁移记录
	var existingSameMig *MigrationData
	var existingSameMigCommit *Commit
	for _, rec := range currentRecords {
		if rec.Type == RecordTypeMigration {
			var mig MigrationData
			if err := decodeStrictJSONBytes(rec.Data, &mig); err != nil {
				return nil, fmt.Errorf("%w: 解码已有迁移记录 %s 失败: %v", ErrCorruptData, rec.ID, err)
			}
			if mig.SourceID == manifest.SourceID {
				if mig.SourceDigest != manifest.SourceDigest {
					// 同源不同版本继续明确冲突，不隐式覆盖
					return nil, fmt.Errorf("%w: 检测到来源 %s 已存在不同版本的迁移记录 (现有: %s, 待导入: %s)", ErrConflict, manifest.SourceID, mig.SourceDigest, manifest.SourceDigest)
				}
				existingSameMig = &mig
				// 沿提交历史回溯定位生成该迁移记录的首次原提交（禁止 break 吞损坏，严格核验父子关系与环）
				c := currentCommit
				v2 := make(map[string]bool)
				for {
					if v2[c.ID] {
						return nil, fmt.Errorf("%w: 提交历史中检测到循环引用: %s", ErrCorruptData, c.ID)
					}
					v2[c.ID] = true
					if c.Revision != c.BaseRevision+1 {
						return nil, fmt.Errorf("%w: 提交 %s 修订号 (%d) 不等于基准修订号 (%d) + 1", ErrCorruptData, c.ID, c.Revision, c.BaseRevision)
					}

					if c.PreviousCommitID == "" {
						if c.RecordRefs[rec.ID] == rec.RevisionID {
							existingSameMigCommit = c
						}
						break
					}

					parent, pErr := s.getCommit(workID, c.PreviousCommitID)
					if pErr != nil {
						return nil, fmt.Errorf("%w: 读取父提交 %s 失败: %v", ErrCorruptData, c.PreviousCommitID, pErr)
					}
					if parent.Revision != c.BaseRevision {
						return nil, fmt.Errorf("%w: 父提交 %s 修订号 (%d) 与当前提交 baseRevision (%d) 不一致", ErrCorruptData, parent.ID, parent.Revision, c.BaseRevision)
					}

					// 若当前提交包含该版本，且父提交不包含（或版本不一致），则当前提交为首次引入该记录的原提交
					if c.RecordRefs[rec.ID] == rec.RevisionID && parent.RecordRefs[rec.ID] != rec.RevisionID {
						existingSameMigCommit = c
						break
					}

					c = parent
				}
				if existingSameMigCommit == nil {
					return nil, fmt.Errorf("%w: 无法沿提交历史定位迁移记录 %s (revision: %s) 首次引入的原提交", ErrCorruptData, rec.ID, rec.RevisionID)
				}
				break
			}
		}
	}

	// (3) 处理幂等/重复来源返回，返回原持久提交回执与真实 indexState，不伪造回执 fallback
	if opMatchedCommit != nil {
		if existingSameMig != nil && existingSameMigCommit != nil && existingSameMigCommit.ID == opMatchedCommit.ID {
			// 同一操作且同一迁移记录：安全返回原持久回执
			backupRef := ""
			if len(existingSameMig.BackupReferences) > 0 {
				backupRef = existingSameMig.BackupReferences[0]
			}
			indexState := IndexStateUpToDate
			if s.indexer != nil {
				indexed, err := s.indexer.IsWorkIndexed(workID, opMatchedCommit.Receipt.Revision)
				if err != nil || !indexed {
					indexState = IndexStatePendingRebuild
				}
			}
			return &MigrationCommitResult{
				WorkID:          workID,
				Revision:        opMatchedCommit.Receipt.Revision,
				CommitID:        opMatchedCommit.Receipt.CommitID,
				OperationID:     opMatchedCommit.Receipt.OperationID,
				Committed:       opMatchedCommit.Receipt.Committed,
				IndexState:      indexState,
				SourceID:        manifest.SourceID,
				SourceDigest:    manifest.SourceDigest,
				BackupID:        backupRef,
				EntityCount:     len(manifest.Entities),
				MediaCount:      len(manifest.Files),
				MigrationRecord: existingSameMig,
			}, nil
		}
		// 同 operationId 不同来源/摘要必须冲突
		return nil, fmt.Errorf("%w: operationId %s 已被用于其他提交或不同来源/摘要", ErrConflict, operationID)
	}

	if existingSameMig != nil {
		if existingSameMigCommit == nil {
			return nil, fmt.Errorf("%w: 无法定位已有迁移记录的原始提交", ErrCorruptData)
		}
		// 已存在同源同摘要迁移记录，返回原真实提交回执与核验后的 indexState，不伪造回执
		backupRef := ""
		if len(existingSameMig.BackupReferences) > 0 {
			backupRef = existingSameMig.BackupReferences[0]
		}
		indexState := IndexStateUpToDate
		if s.indexer != nil {
			indexed, err := s.indexer.IsWorkIndexed(workID, existingSameMigCommit.Receipt.Revision)
			if err != nil || !indexed {
				indexState = IndexStatePendingRebuild
			}
		}
		return &MigrationCommitResult{
			WorkID:          workID,
			Revision:        existingSameMigCommit.Receipt.Revision,
			CommitID:        existingSameMigCommit.Receipt.CommitID,
			OperationID:     existingSameMigCommit.Receipt.OperationID,
			Committed:       existingSameMigCommit.Receipt.Committed,
			IndexState:      indexState,
			SourceID:        manifest.SourceID,
			SourceDigest:    manifest.SourceDigest,
			BackupID:        backupRef,
			EntityCount:     len(manifest.Entities),
			MediaCount:      len(manifest.Files),
			MigrationRecord: existingSameMig,
		}, nil
	}

	// 5. 基准修订 CAS 校验（仅在非重复来源/重试时核验）
	if baseRevision != work.Revision {
		return nil, fmt.Errorf("%w: baseRevision %d 与作品当前版本 %d 不一致", ErrConflict, baseRevision, work.Revision)
	}

	// 6. 持久化备份包与清单至 root/backups/<backupID>/ (Point 5)
	backupID, err := GenerateStorageID()
	if err != nil {
		return nil, err
	}

	backupsDir, err := s.locator.BackupsDir()
	if err != nil {
		return nil, err
	}
	if err := checkNoReparsePoint(backupsDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(backupsDir, 0700); err != nil {
		return nil, fmt.Errorf("创建备份集根目录失败: %w", err)
	}
	if err := checkNoReparsePoint(backupsDir); err != nil {
		return nil, err
	}

	backupDir, err := s.locator.BackupDir(backupID)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(backupDir); err == nil {
		return nil, fmt.Errorf("%w: 备份目录 %s 已存在，拒绝覆盖", ErrConflict, backupID)
	}
	if err := os.MkdirAll(backupDir, 0700); err != nil {
		return nil, fmt.Errorf("创建备份目录失败: %w", err)
	}
	if err := checkNoReparsePoint(backupDir); err != nil {
		return nil, err
	}

	packageZipPath, err := s.locator.BackupPackagePath(backupID)
	if err != nil {
		return nil, err
	}
	if err := checkNoReparsePoint(packageZipPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	pf, err := os.OpenFile(packageZipPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, fmt.Errorf("%w: 备份包已存在: %s", ErrConflict, packageZipPath)
		}
		return nil, fmt.Errorf("创建备份包文件失败: %w", err)
	}
	if _, err := pf.Write(zipBytes); err != nil {
		pf.Close()
		return nil, fmt.Errorf("写入备份包失败: %w", err)
	}
	if err := pf.Sync(); err != nil {
		pf.Close()
		return nil, fmt.Errorf("刷盘备份包失败: %w", err)
	}
	if err := pf.Close(); err != nil {
		return nil, fmt.Errorf("关闭备份包失败: %w", err)
	}
	if err := checkNoReparsePoint(packageZipPath); err != nil {
		return nil, err
	}

	backupManifestPath, err := s.locator.BackupManifestPath(backupID)
	if err != nil {
		return nil, err
	}
	if err := checkNoReparsePoint(backupManifestPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("序列化备份清单失败: %w", err)
	}
	mfFile, err := os.OpenFile(backupManifestPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, fmt.Errorf("%w: 备份清单已存在: %s", ErrConflict, backupManifestPath)
		}
		return nil, fmt.Errorf("创建备份清单文件失败: %w", err)
	}
	if _, err := mfFile.Write(manifestBytes); err != nil {
		mfFile.Close()
		return nil, fmt.Errorf("写入备份清单失败: %w", err)
	}
	if err := mfFile.Sync(); err != nil {
		mfFile.Close()
		return nil, fmt.Errorf("刷盘备份清单失败: %w", err)
	}
	if err := mfFile.Close(); err != nil {
		return nil, fmt.Errorf("关闭备份清单失败: %w", err)
	}
	if err := checkNoReparsePoint(backupManifestPath); err != nil {
		return nil, err
	}

	// 7. 解包媒体原件并复用 registerMediaLocked 登记 (Point 1)
	actualFileMappings := make(map[string]string, len(manifest.Files))
	recordChanges := make([]RecordChange, 0, len(manifest.Entities)+len(manifest.Files)+1)

	for _, fileInfo := range manifest.Files {
		cleanFilePath := filepath.ToSlash(fileInfo.Path)
		zf := zipFileMap[cleanFilePath]
		rc, err := zf.Open()
		if err != nil {
			return nil, fmt.Errorf("打开媒体原件 %s 失败: %w", fileInfo.Path, err)
		}
		desc, err := s.registerMediaLocked(workID, rc, fileInfo.OriginalFilename, fileInfo.MIMEType)
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("登记媒体原件 %s 失败: %w", fileInfo.Path, err)
		}

		actualFileMappings[fileInfo.Path] = desc.FileID
		actualFileMappings[fileInfo.SHA256] = desc.FileID

		descData, err := json.Marshal(desc)
		if err != nil {
			return nil, fmt.Errorf("序列化媒体描述符失败: %w", err)
		}
		recordChanges = append(recordChanges, RecordChange{
			ID:   desc.FileID,
			Type: RecordTypeMedia,
			Data: descData,
		})
	}

	// 8. 转换实体项为 RecordChange (Point 2: 仅为模型具有 workId 的实体注入 workId)
	for _, ent := range manifest.Entities {
		if ent.TargetID == "" {
			return nil, fmt.Errorf("%w: 实体项 TargetID 不能为空", ErrInvalidRequest)
		}
		if err := ValidateStorageID(ent.TargetID); err != nil {
			return nil, fmt.Errorf("%w: 实体 TargetID 非法 (%s): %v", ErrInvalidRequest, ent.TargetID, err)
		}

		var rawMap map[string]any
		if err := json.Unmarshal(ent.Data, &rawMap); err != nil {
			return nil, fmt.Errorf("%w: 解析实体原始数据失败 (%s): %v", ErrInvalidRequest, ent.TargetID, err)
		}

		switch ent.Type {
		case RecordTypeEpisode, RecordTypeScript, RecordTypeShot, RecordTypeAsset, RecordTypeGeneration, RecordTypeCanvasBinding:
			rawMap["workId"] = workID
		case RecordTypeShotRevision, RecordTypePromptRevision:
			delete(rawMap, "workId")
		}

		if ent.Type == RecordTypeAsset {
			if curMedia, ok := rawMap["currentMediaIds"].([]any); ok {
				newMediaIDs := make([]string, 0, len(curMedia))
				for _, m := range curMedia {
					if mStr, ok := m.(string); ok {
						if mappedID, ok := actualFileMappings[mStr]; ok {
							newMediaIDs = append(newMediaIDs, mappedID)
						} else {
							newMediaIDs = append(newMediaIDs, mStr)
						}
					}
				}
				rawMap["currentMediaIds"] = newMediaIDs
			}
		}

		updatedData, err := json.Marshal(rawMap)
		if err != nil {
			return nil, fmt.Errorf("重新序列化实体数据失败 (%s): %w", ent.TargetID, err)
		}

		recordChanges = append(recordChanges, RecordChange{
			ID:   ent.TargetID,
			Type: ent.Type,
			Data: updatedData,
		})
	}

	// 9. 添加迁移元数据记录
	migrationRecordID, err := GenerateStorageID()
	if err != nil {
		return nil, err
	}
	migrationRecordData := MigrationData{
		SourceID:         manifest.SourceID,
		SourceDigest:     manifest.SourceDigest,
		EntityMappings:   manifest.EntityMappings,
		FileMappings:     actualFileMappings,
		Status:           "completed",
		BackupReferences: []string{backupID},
	}
	migDataBytes, err := json.Marshal(migrationRecordData)
	if err != nil {
		return nil, fmt.Errorf("序列化迁移记录失败: %w", err)
	}
	recordChanges = append(recordChanges, RecordChange{
		ID:   migrationRecordID,
		Type: RecordTypeMigration,
		Data: migDataBytes,
	})

	// 10. 计算提交请求摘要并复用 commitLocked 执行原子发布 (Point 1)
	req := CommitRequest{
		BaseRevision: baseRevision,
		OperationID:  operationID,
		Changes:      recordChanges,
	}
	reqDigest, err := computeRequestDigest(workID, req)
	if err != nil {
		return nil, err
	}

	commitResult, err := s.commitLocked(workID, req, reqDigest)
	if err != nil {
		return nil, err
	}

	return &MigrationCommitResult{
		WorkID:          workID,
		Revision:        commitResult.Revision,
		CommitID:        commitResult.CommitID,
		OperationID:     commitResult.OperationID,
		Committed:       commitResult.Committed,
		IndexState:      commitResult.IndexState,
		SourceID:        manifest.SourceID,
		SourceDigest:    manifest.SourceDigest,
		BackupID:        backupID,
		EntityCount:     len(manifest.Entities),
		MediaCount:      len(manifest.Files),
		MigrationRecord: &migrationRecordData,
	}, nil
}
