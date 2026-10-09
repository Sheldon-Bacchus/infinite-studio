package works

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// WorkAuditReport 作品一致性审计报告
type WorkAuditReport struct {
	WorkID            string   `json:"workId"`
	Title             string   `json:"title"`
	Revision          int64    `json:"revision"`
	CurrentCommitID   string   `json:"currentCommitId"`
	Healthy           bool     `json:"healthy"`
	CommitCount       int      `json:"commitCount"`
	ActiveRecordCount int      `json:"activeRecordCount"`
	ActiveMediaCount  int      `json:"activeMediaCount"`
	OrphanRecordIDs   []string `json:"orphanRecordIds"`
	OrphanMediaFiles  []string `json:"orphanMediaFiles"`
	StagingFiles      []string `json:"stagingFiles"`
	IndexState        string   `json:"indexState"`
	Issues            []string `json:"issues"`
}

// InboxFileItem 收件箱文件项
type InboxFileItem struct {
	Filename       string `json:"filename"`
	SHA256         string `json:"sha256"`
	Bytes          int64  `json:"bytes"`
	MIMEType       string `json:"mimeType"`
	Kind           string `json:"kind"`
	Status         string `json:"status"` // "new" | "duplicate"
	ExistingFileID string `json:"existingFileId,omitempty"`
}

// InboxScanResult 收件箱扫描结果
type InboxScanResult struct {
	WorkID    string          `json:"workId"`
	Files     []InboxFileItem `json:"files"`
	ScannedAt string          `json:"scannedAt"`
}

// AdoptInboxFileParam 采用单个收件箱文件参数
type AdoptInboxFileParam struct {
	Filename       string `json:"filename"`
	ExpectedSHA256 string `json:"expectedSha256"`
}

// AdoptInboxRequest 采用收件箱文件请求模型
type AdoptInboxRequest struct {
	BaseRevision int64                 `json:"baseRevision"`
	OperationID  string                `json:"operationId"`
	Files        []AdoptInboxFileParam `json:"files"`
}

func computeInboxRequestDigest(workID string, req AdoptInboxRequest) (string, error) {
	payload, err := json.Marshal(struct {
		WorkID       string                 `json:"workId"`
		BaseRevision int64                  `json:"baseRevision"`
		OperationID  string                 `json:"operationId"`
		Files        []AdoptInboxFileParam  `json:"files"`
	}{WorkID: workID, BaseRevision: req.BaseRevision, OperationID: req.OperationID, Files: req.Files})
	if err != nil {
		return "", fmt.Errorf("序列化收件箱采用请求摘要失败: %w", err)
	}
	hash := sha256.Sum256(payload)
	return hex.EncodeToString(hash[:]), nil
}

func (s *Store) findInboxOperationDigest(workID string, commit *Commit) (string, error) {
	for objectID, revisionID := range commit.RecordRefs {
		record, err := s.getRecord(workID, revisionID)
		if err != nil {
			return "", fmt.Errorf("%w: 读取收件箱操作回执记录 %s 失败: %v", ErrCorruptData, objectID, err)
		}
		if record.Type != RecordTypeArchive {
			continue
		}
		var receipt ArchiveData
		if err := decodeStrictJSONBytes(record.Data, &receipt); err != nil {
			return "", fmt.Errorf("%w: 收件箱操作回执 %s 损坏: %v", ErrCorruptData, objectID, err)
		}
		if receipt.Status == "inbox_adopted" && receipt.OperationID == commit.OperationID {
			return receipt.RequestDigest, nil
		}
	}
	return "", nil
}

// VerifyAndAuditWork 在维护锁/作品锁下核对权威 work.json 与完整提交链、记录与物理原件。
// 规则：
// 1. 核对完整提交链历史连贯性；
// 2. 核对当前有效记录与物理文件 SHA-256 摘要；
// 3. 统计并报告 orphan/staging/未登记原件，但不直接清理文件；
// 4. 不将孤立提交推断为已生效，不替换未知/损坏 head。
func (s *Store) VerifyAndAuditWork(workID string) (*WorkAuditReport, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}

	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	work, err := s.getWork(workID)
	if err != nil {
		return nil, err
	}

	issues := make([]string, 0)

	// 1. 验证提交链连贯性并收集全量有效提交与记录，增加环检测防范恶意循环
	commitCount := 0
	allCommittedRecords := make(map[string]bool)
	allCommittedMedia := make(map[string]bool)

	currCommitID := work.CurrentCommitID
	currRev := work.Revision
	visitedCommits := make(map[string]bool)

	for currCommitID != "" {
		if visitedCommits[currCommitID] {
			issues = append(issues, fmt.Sprintf("提交历史中检测到循环引用: %s", currCommitID))
			break
		}
		visitedCommits[currCommitID] = true

		commit, err := s.getCommit(workID, currCommitID)
		if err != nil {
			issues = append(issues, fmt.Sprintf("提交清单 %s 损坏或不可读: %v", currCommitID, err))
			break
		}
		commitCount++
		if commit.Revision != currRev {
			issues = append(issues, fmt.Sprintf("提交 %s 修订号 (%d) 与预期修订号 (%d) 不匹配", currCommitID, commit.Revision, currRev))
		}

		for _, recRevID := range commit.RecordRefs {
			allCommittedRecords[recRevID] = true
		}

		if commit.Revision == 1 || commit.PreviousCommitID == "" {
			break
		}
		currCommitID = commit.PreviousCommitID
		currRev--
	}

	// 2. 检查全量历史提交链可达记录及其实际引用的全量物理原件
	currentCommit, err := s.getCommit(workID, work.CurrentCommitID)
	activeRecordCount := 0
	activeMediaCount := 0
	headRecordsByRevID := make(map[string]bool)

	if err == nil {
		activeRecordCount = len(currentCommit.RecordRefs)
		for _, recRevID := range currentCommit.RecordRefs {
			headRecordsByRevID[recRevID] = true
		}
	} else {
		issues = append(issues, fmt.Sprintf("读取 Head 提交清单 %s 失败: %v", work.CurrentCommitID, err))
	}

	for recRevID := range allCommittedRecords {
		recPath, pErr := s.locator.RecordPath(workID, recRevID)
		if pErr != nil {
			issues = append(issues, fmt.Sprintf("记录 %s 路径非法: %v", recRevID, pErr))
			continue
		}
		fBytes, rErr := os.ReadFile(recPath)
		if rErr != nil {
			issues = append(issues, fmt.Sprintf("记录文件 %s 缺失或不可读: %v", recRevID, rErr))
			continue
		}

		var rec Record
		if dErr := decodeStrictJSONBytes(fBytes, &rec); dErr != nil {
			issues = append(issues, fmt.Sprintf("记录文件 %s JSON 格式损坏: %v", recRevID, dErr))
			continue
		}
		computedHash, hashErr := computeRecordDigest(rec.WorkID, rec.ID, rec.Type, rec.Data)
		if hashErr != nil || computedHash != recRevID || rec.RevisionID != recRevID || rec.WorkID != workID {
			issues = append(issues, fmt.Sprintf("记录 %s 的规范 SHA-256 或身份与实际内容不一致 (实际: %s)", recRevID, computedHash))
		}

		if rec.Type == RecordTypeMedia {
			if headRecordsByRevID[recRevID] {
				activeMediaCount++
			}
			var desc MediaDescriptor
			if mErr := decodeStrictJSONBytes(rec.Data, &desc); mErr != nil {
				issues = append(issues, fmt.Sprintf("媒体记录 %s 描述符损坏: %v", recRevID, mErr))
				continue
			}
			allCommittedMedia[desc.SHA256+desc.Extension] = true

			mediaPath, mpErr := s.locator.MediaPath(workID, desc.SHA256, desc.Extension)
			if mpErr != nil {
				issues = append(issues, fmt.Sprintf("媒体文件路径非法: %v", mpErr))
				continue
			}
			st, sErr := os.Stat(mediaPath)
			if sErr != nil {
				issues = append(issues, fmt.Sprintf("媒体物理原件 %s 缺失: %v", mediaPath, sErr))
			} else if st.Size() != desc.Bytes {
				issues = append(issues, fmt.Sprintf("媒体物理原件 %s 大小不匹配 (实际: %d, 记录: %d)", mediaPath, st.Size(), desc.Bytes))
			} else {
				actualHash, hErr := hashFileStream(mediaPath)
				if hErr != nil {
					issues = append(issues, fmt.Sprintf("计算媒体物理原件 %s 哈希失败: %v", mediaPath, hErr))
				} else if actualHash != desc.SHA256 {
					issues = append(issues, fmt.Sprintf("媒体物理原件 %s 内容哈希与描述符不匹配 (实际: %s, 记录: %s)", mediaPath, actualHash, desc.SHA256))
				}
			}
		}
	}

	// 3. 扫描磁盘 records/ 目录排查孤立记录文件
	orphanRecordIDs := make([]string, 0)
	recordsDir, err := s.locator.RecordsDir(workID)
	if err == nil {
		if entries, rErr := os.ReadDir(recordsDir); rErr == nil {
			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
					continue
				}
				revID := strings.TrimSuffix(entry.Name(), ".json")
				if !allCommittedRecords[revID] {
					orphanRecordIDs = append(orphanRecordIDs, revID)
				}
			}
		}
	}

	// 4. 扫描磁盘 media/ 目录排查未引用物理原件
	orphanMediaFiles := make([]string, 0)
	mediaDir, err := s.locator.MediaDir(workID)
	if err == nil {
		if entries, mErr := os.ReadDir(mediaDir); mErr == nil {
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				if !allCommittedMedia[entry.Name()] {
					orphanMediaFiles = append(orphanMediaFiles, entry.Name())
				}
			}
		}
	}

	// 5. 扫描磁盘 staging/ 目录排查残留暂存文件（覆盖作品内 staging 与根目录全局 staging/import 暂存目录，只报告不删除）
	stagingFiles := make([]string, 0)
	stagingDir, err := s.locator.StagingDir(workID)
	if err == nil {
		if entries, sErr := os.ReadDir(stagingDir); sErr == nil {
			for _, entry := range entries {
				if !entry.IsDir() {
					stagingFiles = append(stagingFiles, filepath.Join("work-staging", entry.Name()))
				}
			}
		}
	}
	rootStagingDir, err := s.locator.RootStagingDir()
	if err == nil {
		if entries, rsErr := os.ReadDir(rootStagingDir); rsErr == nil {
			for _, entry := range entries {
				stagingFiles = append(stagingFiles, filepath.Join("root-staging", entry.Name()))
			}
		}
	}

	healthy := len(issues) == 0

	indexState := IndexStateUpToDate
	if s.indexer != nil {
		indexed, idxErr := s.indexer.IsWorkIndexed(workID, work.Revision)
		if idxErr != nil || !indexed {
			indexState = IndexStatePendingRebuild
		}
	}

	return &WorkAuditReport{
		WorkID:            workID,
		Title:             work.Title,
		Revision:          work.Revision,
		CurrentCommitID:   work.CurrentCommitID,
		Healthy:           healthy,
		CommitCount:       commitCount,
		ActiveRecordCount: activeRecordCount,
		ActiveMediaCount:  activeMediaCount,
		OrphanRecordIDs:   orphanRecordIDs,
		OrphanMediaFiles:  orphanMediaFiles,
		StagingFiles:      stagingFiles,
		IndexState:        indexState,
		Issues:            issues,
	}, nil
}

// ScanInbox 扫描作品收件箱目录 (workspaces/{workId}/inbox) 下的普通文件。
// 规则：
// 1. 仅扫描该作品 locator 内的普通文件，拒绝软链接与越界；
// 2. 计算文件的 SHA-256、大小与推断 MIME 类型；
// 3. 与当前版本已登记媒体记录比较，标注是新素材 (new) 还是已登记复用 (duplicate)；
// 4. 不进行自动合并或修改剧本文本，仅做只读扫描对比。
func (s *Store) ScanInbox(workID string) (*InboxScanResult, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}

	inboxDir, err := s.locator.InboxDir(workID)
	if err != nil {
		return nil, err
	}

	if err := checkNoReparsePoint(inboxDir); err != nil {
		return nil, err
	}

	// 收集当前作品已登记媒体哈希映射
	registeredHashes := make(map[string]string) // sha256 -> fileId
	currentRecords, err := s.getCurrentRecords(workID)
	if err == nil {
		for _, rec := range currentRecords {
			if rec.Type == RecordTypeMedia {
				var desc MediaDescriptor
				if err := decodeStrictJSONBytes(rec.Data, &desc); err == nil {
					registeredHashes[desc.SHA256] = desc.FileID
				}
			}
		}
	}

	entries, err := os.ReadDir(inboxDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &InboxScanResult{
				WorkID:    workID,
				Files:     []InboxFileItem{},
				ScannedAt: time.Now().UTC().Format(time.RFC3339Nano),
			}, nil
		}
		return nil, fmt.Errorf("读取收件箱目录失败: %w", err)
	}

	files := make([]InboxFileItem, 0, len(entries))

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}
		// 拒绝软链接及非常规文件
		if info.Mode()&os.ModeType != 0 {
			continue
		}

		filename := entry.Name()
		if err := validateSafeFilename(filename); err != nil {
			continue
		}

		filePath := filepath.Join(inboxDir, filename)
		if err := checkNoReparsePoint(filePath); err != nil {
			continue
		}

		f, err := os.Open(filePath)
		if err != nil {
			continue
		}

		hasher := sha256.New()
		bytesCount, err := io.Copy(hasher, f)
		_ = f.Close()
		if err != nil || bytesCount <= 0 {
			continue
		}

		sha256Hex := hex.EncodeToString(hasher.Sum(nil))

		// 推断 MIME 类型与 Kind
		ext := strings.ToLower(filepath.Ext(filename))
		fmtInfo, hasFmt := ExtToFormatMap[ext]
		mimeType := "application/octet-stream"
		kind := MediaKindImage
		if hasFmt {
			kind = fmtInfo.Kind
			// 反查安全 MIME
			for m, f := range mimeToFormatMap {
				if f.Extension == ext {
					mimeType = m
					break
				}
			}
		}

		status := "new"
		existingFileID := ""
		if fid, exists := registeredHashes[sha256Hex]; exists {
			status = "duplicate"
			existingFileID = fid
		}

		files = append(files, InboxFileItem{
			Filename:       filename,
			SHA256:         sha256Hex,
			Bytes:          bytesCount,
			MIMEType:       mimeType,
			Kind:           kind,
			Status:         status,
			ExistingFileID: existingFileID,
		})
	}

	return &InboxScanResult{
		WorkID:    workID,
		Files:     files,
		ScannedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

// AdoptInboxFiles 将收件箱中核验通过的文件正式采纳为作品资产。
// 规则：
// 1. 基准版本 CAS 校验；
// 2. 重新核验文件实际 SHA-256 与 ExpectedSHA256；若被篡改则报错拒绝并要求重新扫描；
// 3. 复用 registerMediaLocked 进行物理去重与原件注册；
// 4. 生成 RecordTypeMedia 与 RecordTypeAsset 变更；
// 5. 采纳成功后从 inbox 安全移除原文件；
// 6. 沿用 commitLocked 提交内核。
func (s *Store) AdoptInboxFiles(workID string, req AdoptInboxRequest) (*CommitResult, error) {
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
	if len(req.Files) == 0 {
		return nil, fmt.Errorf("%w: 待采纳文件列表不能为空", ErrInvalidRequest)
	}
	requestDigest, err := computeInboxRequestDigest(workID, req)
	if err != nil {
		return nil, err
	}
	seenFilenames := make(map[string]bool, len(req.Files))
	for _, item := range req.Files {
		if seenFilenames[item.Filename] {
			return nil, fmt.Errorf("%w: 收件箱采纳请求包含重复文件名: %s", ErrInvalidRequest, item.Filename)
		}
		seenFilenames[item.Filename] = true
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

	// 沿提交链回溯检查 operationId，并比对独立保存的完整输入载荷摘要。
	curr := currentCommit
	visitedCommits := make(map[string]bool)
	for curr != nil {
		if visitedCommits[curr.ID] {
			return nil, fmt.Errorf("%w: 提交历史中检测到循环引用: %s", ErrCorruptData, curr.ID)
		}
		visitedCommits[curr.ID] = true
		if curr.OperationID == req.OperationID {
			historicalDigest, err := s.findInboxOperationDigest(workID, curr)
			if err != nil {
				return nil, err
			}
			if curr.BaseRevision != req.BaseRevision || historicalDigest == "" || historicalDigest != requestDigest {
				return nil, fmt.Errorf("%w: operationId %s 已被使用但收件箱请求内容不匹配", ErrConflict, req.OperationID)
			}
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
			}, nil
		}
		if curr.PreviousCommitID == "" {
			break
		}
		parent, err := s.getCommit(workID, curr.PreviousCommitID)
		if err != nil {
			return nil, fmt.Errorf("%w: 读取父提交 %s 失败: %v", ErrCorruptData, curr.PreviousCommitID, err)
		}
		if parent.Revision != curr.BaseRevision {
			return nil, fmt.Errorf("%w: 父提交修订号与基准修订号不一致", ErrCorruptData)
		}
		curr = parent
	}

	if req.BaseRevision != work.Revision {
		return nil, fmt.Errorf("%w: baseRevision %d 与当前作品修订版本 %d 不一致", ErrConflict, req.BaseRevision, work.Revision)
	}

	inboxDir, err := s.locator.InboxDir(workID)
	if err != nil {
		return nil, err
	}

	changes := make([]RecordChange, 0, len(req.Files)*2+1)
	filesToRemove := make([]string, 0, len(req.Files))
	seenHashes := make(map[string]string, len(req.Files))
	assetRefs := make([]string, 0, len(req.Files))

	for _, item := range req.Files {
		if err := validateSafeFilename(item.Filename); err != nil {
			return nil, err
		}
		if err := ValidateHashID(item.ExpectedSHA256); err != nil {
			return nil, fmt.Errorf("预期文件哈希非法: %w", err)
		}

		filePath := filepath.Join(inboxDir, item.Filename)
		if err := checkNoReparsePoint(filePath); err != nil {
			return nil, err
		}

		f, err := os.Open(filePath)
		if err != nil {
			return nil, fmt.Errorf("打开收件箱文件 %s 失败: %w", item.Filename, err)
		}

		// 重新核算 SHA-256 防范时间窗口篡改
		hasher := sha256.New()
		if _, err := io.Copy(hasher, f); err != nil {
			_ = f.Close()
			return nil, fmt.Errorf("核算文件 %s 摘要失败: %w", item.Filename, err)
		}
		actualHash := hex.EncodeToString(hasher.Sum(nil))
		if actualHash != item.ExpectedSHA256 {
			_ = f.Close()
			return nil, fmt.Errorf("%w: 收件箱文件 %s 在扫描后已被修改，请重新扫描", ErrConflict, item.Filename)
		}
		filesToRemove = append(filesToRemove, filePath)

		ext := strings.ToLower(filepath.Ext(item.Filename))
		format, hasFormat := ExtToFormatMap[ext]
		if !hasFormat {
			_ = f.Close()
			return nil, fmt.Errorf("%w: 收件箱文件扩展名没有受支持的媒体类型: %s", ErrInvalidRequest, ext)
		}
		mimeType := ""
		for candidate, candidateFormat := range mimeToFormatMap {
			if candidateFormat.Extension == ext && candidateFormat.Kind == format.Kind {
				mimeType = candidate
				break
			}
		}
		if mimeType == "" {
			_ = f.Close()
			return nil, fmt.Errorf("%w: 收件箱文件扩展名缺少规范 MIME 类型: %s", ErrInvalidRequest, ext)
		}
		if priorFormat, exists := seenHashes[actualHash]; exists {
			_ = f.Close()
			if priorFormat != mimeType {
				return nil, fmt.Errorf("%w: 相同摘要的收件箱文件声明了不同媒体类型", ErrConflict)
			}
			continue
		}
		seenHashes[actualHash] = mimeType

		// 重置流读取指针并执行流式注册
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			_ = f.Close()
			return nil, fmt.Errorf("重置文件指针失败: %w", err)
		}

		desc, err := s.registerMediaLocked(workID, f, item.Filename, mimeType)
		_ = f.Close()
		if err != nil {
			return nil, fmt.Errorf("登记收件箱媒体 %s 失败: %w", item.Filename, err)
		}

		// 1. 生成媒体不可变记录 (RecordTypeMedia)，使用基于请求与哈希的稳定 ID
		desc.FileID = fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("inbox_media:%s:%s:%s", workID, req.OperationID, item.ExpectedSHA256))))[:32]
		descBytes, err := json.Marshal(desc)
		if err != nil {
			return nil, fmt.Errorf("序列化媒体描述符失败: %w", err)
		}
		changes = append(changes, RecordChange{
			ID:   desc.FileID,
			Type: RecordTypeMedia,
			Data: descBytes,
		})

		// 2. 生成对应资产记录 (RecordTypeAsset)，使用基于请求与哈希的稳定 ID
		assetID := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("inbox_asset:%s:%s:%s", workID, req.OperationID, item.ExpectedSHA256))))[:32]
		asset := AssetData{
			ID:              assetID,
			WorkID:          workID,
			Domain:          desc.Kind,
			ParentID:        "",
			CurrentMediaIDs: []string{desc.FileID},
			Archived:        false,
		}
		assetBytes, err := json.Marshal(asset)
		if err != nil {
			return nil, fmt.Errorf("序列化资产记录失败: %w", err)
		}
		changes = append(changes, RecordChange{
			ID:   assetID,
			Type: RecordTypeAsset,
			Data: assetBytes,
		})
		assetRefs = append(assetRefs, assetID)
	}

	// 持久化原始请求摘要，让重试在原文件已删除且作品已继续编辑后仍可准确判定幂等。
	receiptID := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("inbox_receipt:%s:%s", workID, req.OperationID))))[:32]
	receiptBytes, err := json.Marshal(ArchiveData{
		ID: receiptID, WorkID: workID, EntityRefs: assetRefs,
		SourceRevision: fmt.Sprintf("r%d", req.BaseRevision), Status: "inbox_adopted",
		OperationID: req.OperationID, RequestDigest: requestDigest,
	})
	if err != nil {
		return nil, fmt.Errorf("序列化收件箱采用回执失败: %w", err)
	}
	changes = append(changes, RecordChange{ID: receiptID, Type: RecordTypeArchive, Data: receiptBytes})

	commitReq := CommitRequest{
		BaseRevision: req.BaseRevision,
		OperationID:  req.OperationID,
		Changes:      changes,
	}

	reqDigest, err := computeRequestDigest(workID, commitReq)
	if err != nil {
		return nil, err
	}

	res, err := s.commitLocked(workID, commitReq, reqDigest)
	if err != nil {
		return nil, err
	}

	// 提交成功后从收件箱移除已采纳原文件
	for _, p := range filesToRemove {
		_ = os.Remove(p)
	}

	return res, nil
}
