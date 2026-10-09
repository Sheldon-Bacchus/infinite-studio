package works

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

// Store 是管理本地作品仓库的核心实体，提供生命周期管理、独占锁控制和作品读取能力
type Store struct {
	root     string
	locator  *PathLocator
	rootLock *RootLock
	indexer  *Indexer

	maintenanceMu sync.RWMutex // 仓库级维护读写栅栏：写锁用于全量重建，读锁用于创建/提交/单作品重建
	createMu      sync.Mutex   // 串行化仓库级创建操作与身份幂等检查

	mu        sync.Mutex
	workLocks map[string]*sync.Mutex

	stateMu   sync.Mutex
	closed    bool
	closeDone chan struct{}
	closeErr  error
	activeOps sync.WaitGroup
}

// InitializeStore 显式创建并初始化全新的作品仓库根目录与 root.json 标识清单。
// 规则：先预验路径与重解析点，若根目录不存在仅在此入口创建；先取得排他 root 锁后创建 root 清单与目录，直接持锁返回。
func InitializeStore(dataRoot string) (*Store, error) {
	locator, err := NewPathLocator(dataRoot)
	if err != nil {
		return nil, err
	}

	root := locator.Root()
	// 预先路径验证：确保根路径及其祖先无重解析点
	if err := checkNoReparsePoint(root); err != nil {
		return nil, err
	}

	// 若 root 目录不存在，仅在此显式入口进行创建
	if fi, err := os.Lstat(root); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if err := os.MkdirAll(root, 0700); err != nil {
				return nil, fmt.Errorf("创建存储根目录失败: %w", err)
			}
			if err := checkNoReparsePoint(root); err != nil {
				return nil, err
			}
		} else {
			return nil, fmt.Errorf("核验存储根目录失败: %w", err)
		}
	} else if !fi.IsDir() {
		return nil, fmt.Errorf("存储根路径不是普通目录: %s", root)
	}

	// 先获取排他 root 锁！避免两个 InitializeStore 同时并发写入
	lockPath, err := locator.LockFilePath()
	if err != nil {
		return nil, err
	}
	rootLock, err := acquireRootFileLock(lockPath)
	if err != nil {
		return nil, err
	}

	// 在持有排他锁的情况下，核验是否已存在 root.json
	manifestPath, err := locator.RootManifestPath()
	if err != nil {
		_ = rootLock.Release()
		return nil, err
	}
	if _, err := os.Lstat(manifestPath); err == nil {
		_ = rootLock.Release()
		return nil, fmt.Errorf("%w: %s", ErrStoreExists, manifestPath)
	} else if !errors.Is(err, os.ErrNotExist) {
		_ = rootLock.Release()
		return nil, fmt.Errorf("检查根标识清单状态失败: %w", err)
	}

	// 创建规范的 workspaces 目录
	workspacesDir, err := locator.WorkspacesDir()
	if err != nil {
		_ = rootLock.Release()
		return nil, err
	}
	if err := os.MkdirAll(workspacesDir, 0700); err != nil {
		_ = rootLock.Release()
		return nil, fmt.Errorf("创建作品集目录失败: %w", err)
	}
	if err := checkNoReparsePoint(workspacesDir); err != nil {
		_ = rootLock.Release()
		return nil, err
	}

	// 写入并通过 locator 检验的暂存路径发布 root.json
	now := time.Now().UTC().Format(time.RFC3339Nano)
	manifest := StoreManifest{
		SchemaVersion: SchemaVersion,
		Product:       ProductID,
		CreatedAt:     now,
	}

	stagingManifest, err := locator.RootStagingManifestPath()
	if err != nil {
		_ = rootLock.Release()
		return nil, err
	}
	if err := writeJSONToStaging(stagingManifest, manifest); err != nil {
		_ = rootLock.Release()
		return nil, err
	}
	if err := moveFileNoReplace(stagingManifest, manifestPath); err != nil {
		_ = os.Remove(stagingManifest)
		_ = rootLock.Release()
		return nil, fmt.Errorf("发布 root.json 失败: %w", err)
	}

	// 初始化 SQLite 索引管理器（可重建辅助索引）
	indexer, err := NewIndexer(locator)
	if err != nil {
		_ = rootLock.Release()
		return nil, fmt.Errorf("初始化索引数据库失败: %w", err)
	}

	// 直接持锁构造并返回 Store
	return &Store{
		root:      root,
		locator:   locator,
		rootLock:  rootLock,
		indexer:   indexer,
		workLocks: make(map[string]*sync.Mutex),
		closeDone: make(chan struct{}),
	}, nil
}

// OpenStore 打开并校验作品仓库根目录。
// 严格规则：不得 os.MkdirAll 未知 root；缺 root 或缺 workspaces/ 目录直接拒绝；校验 root.json 标识后加独占锁。
func OpenStore(dataRoot string) (*Store, error) {
	locator, err := NewPathLocator(dataRoot)
	if err != nil {
		return nil, err
	}

	root := locator.Root()
	fi, err := os.Lstat(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s（请先调用 InitializeStore）", ErrStoreNotFound, root)
		}
		return nil, fmt.Errorf("核验存储根目录失败: %w", err)
	}
	if !fi.IsDir() {
		return nil, fmt.Errorf("存储根路径不是目录: %s", root)
	}

	// 校验 root.json
	manifestPath, err := locator.RootManifestPath()
	if err != nil {
		return nil, err
	}

	manifestFile, err := os.Open(manifestPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s", ErrStoreNotInitialized, manifestPath)
		}
		return nil, fmt.Errorf("打开根标识清单失败: %w", err)
	}
	defer manifestFile.Close()

	var rootManifest StoreManifest
	if err := decodeStrictJSON(manifestFile, &rootManifest); err != nil {
		return nil, fmt.Errorf("%w: root.json 损坏或格式错误: %v", ErrCorruptData, err)
	}

	if rootManifest.SchemaVersion != SchemaVersion || rootManifest.Product != ProductID {
		return nil, fmt.Errorf("%w: root.json 版本 (%d) 或产品标识 (%s) 不受支持", ErrCorruptData, rootManifest.SchemaVersion, rootManifest.Product)
	}

	// 获取全局跨进程排他锁（共享模式 0 独占持有句柄）
	lockPath, err := locator.LockFilePath()
	if err != nil {
		return nil, err
	}
	rootLock, err := acquireRootFileLock(lockPath)
	if err != nil {
		return nil, err
	}

	// 严格核查 workspaces/ 规范目录必须已存在，绝不静默 MkdirAll；仅显式 InitializeStore 允许创建
	workspacesDir, err := locator.WorkspacesDir()
	if err != nil {
		_ = rootLock.Release()
		return nil, err
	}
	wsFi, err := os.Lstat(workspacesDir)
	if err != nil {
		_ = rootLock.Release()
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: 缺少规范 workspaces/ 目录 (%s)", ErrStoreNotInitialized, workspacesDir)
		}
		return nil, fmt.Errorf("核验 workspaces 目录失败: %w", err)
	}
	if !wsFi.IsDir() {
		_ = rootLock.Release()
		return nil, fmt.Errorf("%w: workspaces 路径不是目录: %s", ErrCorruptData, workspacesDir)
	}

	// 打开 SQLite 索引数据库（可重建辅助索引）
	indexer, err := NewIndexer(locator)
	if err != nil {
		_ = rootLock.Release()
		return nil, fmt.Errorf("打开索引数据库失败: %w", err)
	}

	return &Store{
		root:      root,
		locator:   locator,
		rootLock:  rootLock,
		indexer:   indexer,
		workLocks: make(map[string]*sync.Mutex),
		closeDone: make(chan struct{}),
	}, nil
}

// Close 在互斥锁保护下置 closed=true 阻止新操作，所有并发 Close 均通过 closeDone 通道等待实际完成与释放结果
func (s *Store) Close() error {
	s.stateMu.Lock()
	if s.closed {
		done := s.closeDone
		s.stateMu.Unlock()
		<-done
		return s.closeErr
	}
	s.closed = true
	done := s.closeDone
	s.stateMu.Unlock()

	// 等待所有进行中的活跃操作全部完成
	s.activeOps.Wait()

	// 关闭索引数据库连接
	if s.indexer != nil {
		if idxErr := s.indexer.Close(); idxErr != nil {
			s.closeErr = errors.Join(s.closeErr, idxErr)
		}
	}

	// 释放根目录独占锁，确保不覆盖 indexer.Close 错误
	if s.rootLock != nil {
		if lockErr := s.rootLock.Release(); lockErr != nil {
			s.closeErr = errors.Join(s.closeErr, lockErr)
		}
	}
	close(done)
	return s.closeErr
}

// beginOp 短暂加锁检查 closed 状态并递增 activeOps，然后立即释放互斥锁，杜绝递归读锁死锁
func (s *Store) beginOp() error {
	s.stateMu.Lock()
	if s.closed {
		s.stateMu.Unlock()
		return ErrStoreClosed
	}
	s.activeOps.Add(1)
	s.stateMu.Unlock()
	return nil
}

// endOp 递减活跃操作计数
func (s *Store) endOp() {
	s.activeOps.Done()
}

// getWorkLock 获取指定作品的进程内互斥锁，确保作品内写操作串行化
func (s *Store) getWorkLock(workID string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	lk, exists := s.workLocks[workID]
	if !exists {
		lk = &sync.Mutex{}
		s.workLocks[workID] = lk
	}
	return lk
}

// Locator 返回存储的路径定位器
func (s *Store) Locator() *PathLocator {
	return s.locator
}

// computeCreationDigest 使用结构化规范 JSON 序列化计算创建请求的 SHA-256 摘要，禁止将随机生成 ID 纳入摘要
func computeCreationDigest(operationID, reqID, title string) (string, error) {
	if strings.TrimSpace(operationID) == "" {
		return "", fmt.Errorf("%w: operationId 不能为空", ErrInvalidRequest)
	}
	normTitle := strings.TrimSpace(title)
	if normTitle == "" {
		normTitle = "未命名作品"
	}

	type canonicalCreationDigestInput struct {
		OperationID string `json:"operationId"`
		ID          string `json:"id"`
		Title       string `json:"title"`
	}

	payload, err := json.Marshal(canonicalCreationDigestInput{
		OperationID: operationID,
		ID:          reqID,
		Title:       normTitle,
	})
	if err != nil {
		return "", fmt.Errorf("序列化创建摘要失败: %w", err)
	}

	h := sha256.Sum256(payload)
	return hex.EncodeToString(h[:]), nil
}

// getInitialCommit 沿提交链回溯核查环与父子修订约束，提取该作品的初始根提交
func (s *Store) getInitialCommit(workID, currentCommitID string) (*Commit, error) {
	visited := make(map[string]bool)
	currID := currentCommitID
	for {
		if visited[currID] {
			return nil, fmt.Errorf("%w: 作品 %s 提交链中检测到循环引用: %s", ErrCorruptData, workID, currID)
		}
		visited[currID] = true

		c, err := s.getCommit(workID, currID)
		if err != nil {
			return nil, fmt.Errorf("读取提交 %s 失败: %w", currID, err)
		}

		if c.PreviousCommitID == "" {
			return c, nil
		}

		parent, err := s.getCommit(workID, c.PreviousCommitID)
		if err != nil {
			return nil, fmt.Errorf("%w: 读取父提交 %s 失败: %v", ErrCorruptData, c.PreviousCommitID, err)
		}
		if parent.Revision != c.BaseRevision {
			return nil, fmt.Errorf("%w: 父提交 %s 修订号 (%d) 与子提交基准修订号 (%d) 不匹配", ErrCorruptData, parent.ID, parent.Revision, c.BaseRevision)
		}

		currID = c.PreviousCommitID
	}
}

// findWorkByInitialOperationID 扫描已登记作品的合法初始提交寻找 matching operationId
func (s *Store) findWorkByInitialOperationID(operationID, reqDigest string) (*Work, error) {
	worksList, err := s.listWorks()
	if err != nil {
		return nil, err
	}
	for _, w := range worksList {
		initCommit, err := s.getInitialCommit(w.ID, w.CurrentCommitID)
		if err != nil {
			return nil, err
		}
		if initCommit.OperationID == operationID {
			if initCommit.RequestDigest == reqDigest {
				return w, nil
			}
			return nil, fmt.Errorf("%w: operationId %s 已被作品 %s 使用但创建参数不一致", ErrConflict, operationID, w.ID)
		}
	}
	return nil, nil
}

// createWorkLocked 在持有 maintenanceMu.RLock() 与 createMu.Lock() 下执行物理作品创建与发布
func (s *Store) createWorkLocked(workID, title, operationID, reqDigest string) (*CreateWorkResult, error) {
	workDir, err := s.locator.WorkDir(workID)
	if err != nil {
		return nil, err
	}

	// 检查作品目录是否已存在
	if _, err := os.Lstat(workDir); err == nil {
		return nil, fmt.Errorf("%w: 作品目录 %s 已存在，拒绝覆盖", ErrWorkExists, workID)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	// 创建作品子目录结构
	commitsDir, err := s.locator.CommitsDir(workID)
	if err != nil {
		return nil, err
	}
	recordsDir, err := s.locator.RecordsDir(workID)
	if err != nil {
		return nil, err
	}
	mediaDir, err := s.locator.MediaDir(workID)
	if err != nil {
		return nil, err
	}
	stagingDir, err := s.locator.StagingDir(workID)
	if err != nil {
		return nil, err
	}
	inboxDir, err := s.locator.InboxDir(workID)
	if err != nil {
		return nil, err
	}

	for _, dir := range []string{workDir, commitsDir, recordsDir, mediaDir, stagingDir, inboxDir} {
		if err := checkNoReparsePoint(dir); err != nil {
			return nil, err
		}
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, fmt.Errorf("创建作品目录 %s 失败: %w", dir, err)
		}
		if err := checkNoReparsePoint(dir); err != nil {
			return nil, err
		}
	}

	// 生成初始 Commit (ID 为 32 位 hex)
	commitID, err := GenerateStorageID()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)

	initReceipt := CommitReceipt{
		WorkID:      workID,
		Revision:    1,
		CommitID:    commitID,
		OperationID: operationID,
		Committed:   true,
	}

	initCommit := &Commit{
		SchemaVersion:    SchemaVersion,
		ID:               commitID,
		WorkID:           workID,
		Revision:         1,
		BaseRevision:     0,
		OperationID:      operationID,
		RequestDigest:    reqDigest,
		RecordRefs:       map[string]string{},
		PreviousCommitID: "",
		Receipt:          initReceipt,
		CreatedAt:        now,
	}

	// 将初始 Commit 写入暂存文件并以无覆盖原语发布
	stagingCommitPath, err := s.locator.CommitStagingManifestPath(workID, commitID)
	if err != nil {
		return nil, err
	}
	if err := writeJSONToStaging(stagingCommitPath, initCommit); err != nil {
		return nil, err
	}

	commitTargetDir, err := s.locator.CommitDir(workID, commitID)
	if err != nil {
		return nil, err
	}
	if err := checkNoReparsePoint(commitTargetDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(commitTargetDir, 0700); err != nil {
		return nil, fmt.Errorf("创建初始提交目录失败: %w", err)
	}
	if err := checkNoReparsePoint(commitTargetDir); err != nil {
		return nil, err
	}

	commitManifestPath, err := s.locator.CommitManifestPath(workID, commitID)
	if err != nil {
		return nil, err
	}
	if err := moveFileNoReplace(stagingCommitPath, commitManifestPath); err != nil {
		return nil, fmt.Errorf("发布初始提交清单失败: %w", err)
	}

	// 创建初始权威元数据 work.json
	work := &Work{
		SchemaVersion:   SchemaVersion,
		ID:              workID,
		Title:           title,
		CurrentCommitID: commitID,
		Revision:        1,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	stagingWorkPath, err := s.locator.WorkStagingManifestPath(workID)
	if err != nil {
		return nil, err
	}
	if err := writeJSONToStaging(stagingWorkPath, work); err != nil {
		return nil, err
	}

	workManifestPath, err := s.locator.WorkManifestPath(workID)
	if err != nil {
		return nil, err
	}

	publishErr := moveFileNoReplace(stagingWorkPath, workManifestPath)
	if publishErr != nil {
		// 发布 API 返回错误时回读判定：
		// 确认同一新 head 则按已创建继续，确认为不存在才返回未创建失败，其他读错或不同 head 返回 ErrCommitResultUndetermined
		recheckWork, readErr := s.readWorkManifest(workManifestPath)
		if readErr == nil && recheckWork.ID == workID && recheckWork.CurrentCommitID == commitID && recheckWork.Revision == 1 {
			// 实际已成功发布生效，按已创建继续
		} else if errors.Is(readErr, ErrWorkNotFound) {
			// 确认为不存在，返回未创建失败
			return nil, fmt.Errorf("发布初始 work.json 权威清单失败: %w", publishErr)
		} else {
			// 其他读错或不同 head
			return nil, fmt.Errorf("%w: 发布初始 work.json 结果状态未决 (发布错误: %v, 回读错误: %v)", ErrCommitResultUndetermined, publishErr, readErr)
		}
	}

	// 发布成功（或确认已生效）后，回读确认 ID、CurrentCommitID、Revision，对应创建设计提交线性化点
	confirmedWork, err := s.readWorkManifest(workManifestPath)
	if err != nil {
		return nil, fmt.Errorf("%w: 创建后回读确认 work.json 失败: %v", ErrCommitResultUndetermined, err)
	}
	if confirmedWork.ID != workID || confirmedWork.CurrentCommitID != commitID || confirmedWork.Revision != 1 {
		return nil, fmt.Errorf("%w: 创建后回读确认 work.json 不匹配 (id=%s, commit=%s, rev=%d)", ErrCommitResultUndetermined, confirmedWork.ID, confirmedWork.CurrentCommitID, confirmedWork.Revision)
	}

	indexState := IndexStateUpToDate
	if s.indexer != nil {
		if err := s.indexer.IndexWork(confirmedWork, initCommit, nil); err != nil {
			indexState = IndexStatePendingRebuild
		}
	} else {
		indexState = IndexStatePendingRebuild
	}

	return &CreateWorkResult{
		Work:       confirmedWork,
		Committed:  true,
		IndexState: indexState,
	}, nil
}

// CreateWork 仓库级幂等创建新作品。
// 规则：
// 1. 必填 operationId，可选原请求 id，title 规范化（空标题归一为“未命名作品”）。
// 2. 原请求 id 非空时直接 ValidateStorageID(req.ID)，不进行 TrimSpace，保持摘要和请求 ID 一致。
// 3. 摘要使用结构化 JSON {operationId, id(原请求可空), title(规范化后)}，禁止将随机生成 ID 纳入摘要。
// 4. 扫描已登记作品的合法初始提交，找到匹配 operationId 的初始提交：
//    若摘要一致，幂等返回已有作品及当前 indexState；若摘要不一致，返回 ErrConflict。
// 5. 若无匹配则确定 workID（指定 ID 校验合法性，未指定则生成），调用 createWorkLocked 创建发布。
func (s *Store) CreateWork(req CreateWorkRequest) (*CreateWorkResult, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	if strings.TrimSpace(req.OperationID) == "" {
		return nil, fmt.Errorf("%w: operationId 不能为空", ErrInvalidRequest)
	}

	if req.ID != "" {
		if err := ValidateStorageID(req.ID); err != nil {
			return nil, err
		}
	}

	normTitle := strings.TrimSpace(req.Title)
	if normTitle == "" {
		normTitle = "未命名作品"
	}

	reqDigest, err := computeCreationDigest(req.OperationID, req.ID, normTitle)
	if err != nil {
		return nil, err
	}

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	s.createMu.Lock()
	defer s.createMu.Unlock()

	// 扫描已登记作品检查 operationId 幂等
	existingWork, err := s.findWorkByInitialOperationID(req.OperationID, reqDigest)
	if err != nil {
		return nil, err
	}
	if existingWork != nil {
		indexState := IndexStateUpToDate
		if s.indexer != nil {
			isIndexed, idxErr := s.indexer.IsWorkIndexed(existingWork.ID, existingWork.Revision)
			if idxErr != nil || !isIndexed {
				indexState = IndexStatePendingRebuild
			}
		} else {
			indexState = IndexStatePendingRebuild
		}
		return &CreateWorkResult{
			Work:       existingWork,
			Committed:  true,
			IndexState: indexState,
		}, nil
	}

	// 确定目标作品 ID
	workID := req.ID
	if workID == "" {
		genID, err := GenerateStorageID()
		if err != nil {
			return nil, err
		}
		workID = genID
	}

	return s.createWorkLocked(workID, normTitle, req.OperationID, reqDigest)
}

// InitializeWork 显式新建作品的内部维护入口。
// 内部生成唯一 operationID 并使用统一 private 创建逻辑，杜绝嵌套 beginOp / RLock / 递归锁死锁。
func (s *Store) InitializeWork(workID, title string) (*Work, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}

	normTitle := strings.TrimSpace(title)
	if normTitle == "" {
		normTitle = "未命名作品"
	}

	opID, err := GenerateStorageID()
	if err != nil {
		return nil, err
	}
	operationID := "init_" + opID

	reqDigest, err := computeCreationDigest(operationID, workID, normTitle)
	if err != nil {
		return nil, err
	}

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	s.createMu.Lock()
	defer s.createMu.Unlock()

	res, err := s.createWorkLocked(workID, normTitle, operationID, reqDigest)
	if err != nil {
		return nil, err
	}
	return res.Work, nil
}

// Indexer 返回当前存储绑定的 SQLite 索引器
func (s *Store) Indexer() *Indexer {
	return s.indexer
}

// collectWorkRebuildPayload 采集单个作品的快照并回溯校验全部提交历史链
func (s *Store) collectWorkRebuildPayload(workID string) (*workRebuildPayload, error) {
	work, commit, records, err := s.getWorkSnapshot(workID)
	if err != nil {
		return nil, fmt.Errorf("读取作品 %s 快照失败: %w", workID, err)
	}

	visited := make(map[string]bool)
	var historyCommits []*Commit
	curr := commit
	for {
		if visited[curr.ID] {
			return nil, fmt.Errorf("%w: 作品 %s 提交历史中检测到循环引用: %s", ErrCorruptData, workID, curr.ID)
		}
		visited[curr.ID] = true
		historyCommits = append(historyCommits, curr)

		if curr.PreviousCommitID == "" {
			if curr.BaseRevision != 0 || curr.Revision != 1 {
				return nil, fmt.Errorf("%w: 初始根提交 %s 基准修订号必须为 0 且版本号必须为 1", ErrCorruptData, curr.ID)
			}
			break
		}

		parent, err := s.getCommit(workID, curr.PreviousCommitID)
		if err != nil {
			return nil, fmt.Errorf("%w: 读取作品 %s 父提交 %s 失败: %v", ErrCorruptData, workID, curr.PreviousCommitID, err)
		}
		if parent.Revision != curr.BaseRevision {
			return nil, fmt.Errorf("%w: 父提交 %s 修订号 (%d) 与子提交基准修订号 (%d) 不匹配", ErrCorruptData, parent.ID, parent.Revision, curr.BaseRevision)
		}
		curr = parent
	}

	return &workRebuildPayload{
		work:           work,
		historyCommits: historyCommits,
		records:        records,
	}, nil
}

// RebuildWork 对单个作品重新扫描并重建 SQLite 索引（包括全部历史提交与当前记录集合）。
// 纳入 beginOp 生命周期，获取 maintenanceMu.RLock() 与作品互斥锁，确保锁序 gate -> workLock -> idx.mu。
func (s *Store) RebuildWork(workID string) error {
	if err := s.beginOp(); err != nil {
		return err
	}
	defer s.endOp()

	if err := ValidateStorageID(workID); err != nil {
		return err
	}

	if s.indexer == nil {
		return errors.New("索引器未初始化")
	}

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	payload, err := s.collectWorkRebuildPayload(workID)
	if err != nil {
		return err
	}

	return s.indexer.rebuildWorkLocked(payload)
}

// RebuildIndex 对作品仓库全部已登记作品全量重建 SQLite 索引。
// 纳入 beginOp 生命周期，持有 maintenanceMu.Lock() 排他锁覆盖整个数据收集与全量索引事务。
func (s *Store) RebuildIndex() error {
	if err := s.beginOp(); err != nil {
		return err
	}
	defer s.endOp()

	if s.indexer == nil {
		return errors.New("索引器未初始化")
	}

	s.maintenanceMu.Lock()
	defer s.maintenanceMu.Unlock()

	worksList, err := s.listWorks()
	if err != nil {
		return fmt.Errorf("读取作品清单列表失败: %w", err)
	}

	payloads := make([]workRebuildPayload, 0, len(worksList))
	for _, w := range worksList {
		payload, err := func() (*workRebuildPayload, error) {
			workLock := s.getWorkLock(w.ID)
			workLock.Lock()
			defer workLock.Unlock()

			return s.collectWorkRebuildPayload(w.ID)
		}()
		if err != nil {
			return err
		}
		payloads = append(payloads, *payload)
	}

	return s.indexer.rebuildAllLocked(payloads)
}

// getWork 内部无 beginOp 读取辅助函数，供内部组合操作和公共 GetWork 调用
func (s *Store) getWork(workID string) (*Work, error) {
	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}

	manifestPath, err := s.locator.WorkManifestPath(workID)
	if err != nil {
		return nil, err
	}

	work, err := s.readWorkManifest(manifestPath)
	if err != nil {
		return nil, err
	}

	if work.ID != workID {
		return nil, fmt.Errorf("%w: 清单内作品 ID (%s) 与路径 ID (%s) 不一致", ErrCorruptData, work.ID, workID)
	}

	return work, nil
}

// GetWork 公共入口读取并校验指定作品的唯一权威元数据清单 (work.json)
func (s *Store) GetWork(workID string) (*Work, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	return s.getWork(workID)
}

// listWorks 内部无 beginOp 读取作品列表辅助函数
func (s *Store) listWorks() ([]*Work, error) {
	workspacesDir, err := s.locator.WorkspacesDir()
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(workspacesDir)
	if err != nil {
		return nil, fmt.Errorf("读取作品列表目录失败: %w", err)
	}

	var works []*Work
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		// 校验目录名必须为合法的 32 位 hex ID
		if err := ValidateStorageID(name); err != nil {
			continue
		}

		manifestPath, err := s.locator.WorkManifestPath(name)
		if err != nil {
			return nil, fmt.Errorf("定位作品 %s 清单失败: %w", name, err)
		}

		stat, statErr := os.Lstat(manifestPath)
		if statErr != nil {
			if errors.Is(statErr, os.ErrNotExist) {
				// 仅且仅忽略确实未初始化的普通目录
				continue
			}
			// 访问受限、IO 故障等错误绝不可静默跳过！
			return nil, fmt.Errorf("核验作品 %s 清单状态失败: %w", name, statErr)
		}
		if stat.IsDir() {
			return nil, fmt.Errorf("%w: 作品 %s 的 work.json 是目录而非普通文件", ErrCorruptData, name)
		}

		// 包含 work.json 的已登记作品必须读取成功；若损坏必须报错，不得静默跳过
		w, err := s.getWork(name)
		if err != nil {
			return nil, fmt.Errorf("读取已登记作品 %s 权威清单损坏: %w", name, err)
		}

		works = append(works, w)
	}

	return works, nil
}

// ListWorks 列出 workspaces/ 目录下已显式登记的作品摘要；仅忽略真正不存在清单的未初始化目录，不吞没任何访问或 IO 错误
func (s *Store) ListWorks() ([]*Work, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	return s.listWorks()
}

// getCommit 内部无 beginOp 读取辅助函数，严格校验 Receipt.OperationID 与 base/parent/digest 形态、RecordRefs 格式及根提交约束
func (s *Store) getCommit(workID, commitID string) (*Commit, error) {
	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}
	if err := ValidateStorageID(commitID); err != nil {
		return nil, err
	}

	manifestPath, err := s.locator.CommitManifestPath(workID, commitID)
	if err != nil {
		return nil, err
	}

	file, err := os.Open(manifestPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: 提交清单不存在 (%s)", ErrWorkNotFound, commitID)
		}
		return nil, fmt.Errorf("打开提交清单失败: %w", err)
	}
	defer file.Close()

	var commit Commit
	if err := decodeStrictJSON(file, &commit); err != nil {
		return nil, fmt.Errorf("%w: 提交清单解析失败: %v", ErrCorruptData, err)
	}

	if commit.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("%w: 提交清单版本不受支持 (%d)", ErrCorruptData, commit.SchemaVersion)
	}
	if commit.ID != commitID || commit.WorkID != workID {
		return nil, fmt.Errorf("%w: 提交清单内容身份不一致", ErrCorruptData)
	}
	if commit.Revision < 1 {
		return nil, fmt.Errorf("%w: 提交清单 revision 非法: %d", ErrCorruptData, commit.Revision)
	}
	if commit.OperationID == "" {
		return nil, fmt.Errorf("%w: 提交清单 operationId 不能为空", ErrCorruptData)
	}

	// 校验 Receipt 完整身份、修订、committed 标志及 operationId 强一致性
	if commit.Receipt.WorkID != workID || commit.Receipt.CommitID != commitID ||
		commit.Receipt.Revision != commit.Revision || !commit.Receipt.Committed ||
		commit.Receipt.OperationID != commit.OperationID {
		return nil, fmt.Errorf("%w: 提交清单操作回执不匹配或未提交", ErrCorruptData)
	}

	// 校验 RecordRefs 必须 non-nil 且键与值格式合法
	if commit.RecordRefs == nil {
		return nil, fmt.Errorf("%w: 提交清单 recordRefs 不能为空 (必须为 map)", ErrCorruptData)
	}
	for objID, revID := range commit.RecordRefs {
		if err := validateSafeFilename(objID); err != nil {
			return nil, fmt.Errorf("%w: recordRefs 包含非法对象 ID (%s): %v", ErrCorruptData, objID, err)
		}
		if err := ValidateHashID(revID); err != nil {
			return nil, fmt.Errorf("%w: recordRefs 对象 %s 修订哈希非法 (%s): %v", ErrCorruptData, objID, revID, err)
		}
	}

	// 校验基础形态与根提交约束
	if commit.PreviousCommitID == "" {
		// 初始根提交规则：
		// BaseRevision == 0, Revision == 1, len(RecordRefs) == 0
		// OperationID 必须有效非空 (已在前面检验 commit.OperationID == "")
		// RequestDigest 必须为有效 64 位十六进制 SHA-256 哈希
		if commit.BaseRevision != 0 || commit.Revision != 1 || len(commit.RecordRefs) != 0 {
			return nil, fmt.Errorf("%w: 初始根提交不符合规范约束 (base=%d, rev=%d, refs=%d)",
				ErrCorruptData, commit.BaseRevision, commit.Revision, len(commit.RecordRefs))
		}
		if err := ValidateHashID(commit.RequestDigest); err != nil {
			return nil, fmt.Errorf("%w: 初始根提交 requestDigest 非法: %v", ErrCorruptData, err)
		}
	} else {
		// 后续非初始提交规则
		if err := ValidateStorageID(commit.PreviousCommitID); err != nil {
			return nil, fmt.Errorf("%w: previousCommitId 格式非法: %v", ErrCorruptData, err)
		}
		if commit.BaseRevision < 1 {
			return nil, fmt.Errorf("%w: 非初始提交 baseRevision 必须大于等于 1", ErrCorruptData)
		}
		if commit.Revision != commit.BaseRevision+1 {
			return nil, fmt.Errorf("%w: 提交 revision (%d) 必须恰好为 baseRevision (%d) + 1", ErrCorruptData, commit.Revision, commit.BaseRevision)
		}
		if err := ValidateHashID(commit.RequestDigest); err != nil {
			return nil, fmt.Errorf("%w: 提交 requestDigest 格式非法: %v", ErrCorruptData, err)
		}
	}

	return &commit, nil
}

// GetCommit 公共入口读取指定的不可变提交清单 (commits/{commitId}/manifest.json)
func (s *Store) GetCommit(workID, commitID string) (*Commit, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	return s.getCommit(workID, commitID)
}

// getCurrentCommit 内部无 beginOp 读取辅助函数，校验 commit.Revision == work.Revision
func (s *Store) getCurrentCommit(workID string) (*Commit, *Work, error) {
	work, err := s.getWork(workID)
	if err != nil {
		return nil, nil, err
	}

	commit, err := s.getCommit(workID, work.CurrentCommitID)
	if err != nil {
		return nil, nil, err
	}

	if commit.Revision != work.Revision {
		return nil, nil, fmt.Errorf("%w: 提交清单修订号 (%d) 与权威清单修订号 (%d) 不一致", ErrCorruptData, commit.Revision, work.Revision)
	}

	return commit, work, nil
}

// GetCurrentCommit 公共入口读取作品当前的权威提交清单及对应的 Work 元数据
func (s *Store) GetCurrentCommit(workID string) (*Commit, *Work, error) {
	if err := s.beginOp(); err != nil {
		return nil, nil, err
	}
	defer s.endOp()

	return s.getCurrentCommit(workID)
}

// getRecord 内部无 beginOp 读取辅助函数，校验记录 ID/类型枚举，重算哈希验证无篡改
func (s *Store) getRecord(workID, revisionID string) (*Record, error) {
	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}
	if err := ValidateHashID(revisionID); err != nil {
		return nil, err
	}

	recordPath, err := s.locator.RecordPath(workID, revisionID)
	if err != nil {
		return nil, err
	}

	file, err := os.Open(recordPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: 记录文件不存在 (%s)", ErrWorkNotFound, revisionID)
		}
		return nil, fmt.Errorf("打开记录文件失败: %w", err)
	}
	defer file.Close()

	var record Record
	if err := decodeStrictJSON(file, &record); err != nil {
		return nil, fmt.Errorf("%w: 记录解析失败: %v", ErrCorruptData, err)
	}

	if record.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("%w: 记录版本不受支持 (%d)", ErrCorruptData, record.SchemaVersion)
	}
	if record.RevisionID != revisionID || record.WorkID != workID {
		return nil, fmt.Errorf("%w: 记录内容身份不一致", ErrCorruptData)
	}
	if record.ID == "" {
		return nil, fmt.Errorf("%w: 记录 ID 不能为空", ErrCorruptData)
	}
	if record.Type == RecordTypeMedia {
		if err := ValidateStorageID(record.ID); err != nil {
			return nil, fmt.Errorf("%w: 媒体记录 ID 非法: %v", ErrCorruptData, err)
		}
	} else if err := validateSafeFilename(record.ID); err != nil {
		return nil, fmt.Errorf("%w: 记录 ID 包含非法字符: %v", ErrCorruptData, err)
	}
	// 即使对于旧记录，类型也必须符合已知枚举
	if _, ok := ValidRecordTypes[record.Type]; !ok {
		return nil, fmt.Errorf("%w: 记录 %s 包含未知或不受支持的类型 %s", ErrCorruptData, record.ID, record.Type)
	}

	// 重新计算记录内容摘要，确保记录未被篡改
	expectedHash, err := computeRecordDigest(workID, record.ID, record.Type, record.Data)
	if err != nil {
		return nil, err
	}
	if expectedHash != revisionID {
		return nil, fmt.Errorf("%w: 记录 %s 内容重算摘要 (%s) 与声明修订 ID (%s) 不符", ErrCorruptData, record.ID, expectedHash, revisionID)
	}

	return &record, nil
}

// GetRecord 公共入口读取指定的单条不可变版本记录 (records/{revisionId}.json)，并重算哈希验证无篡改
func (s *Store) GetRecord(workID, revisionID string) (*Record, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	return s.getRecord(workID, revisionID)
}

// getCurrentRecords 内部无 beginOp 读取辅助函数
func (s *Store) getCurrentRecords(workID string) (map[string]*Record, error) {
	commit, _, err := s.getCurrentCommit(workID)
	if err != nil {
		return nil, err
	}

	records := make(map[string]*Record, len(commit.RecordRefs))
	for objID, revID := range commit.RecordRefs {
		rec, err := s.getRecord(workID, revID)
		if err != nil {
			return nil, fmt.Errorf("读取当前版本所引用的记录 %s (%s) 失败: %w", objID, revID, err)
		}
		if rec.ID != objID {
			return nil, fmt.Errorf("%w: recordRefs 键 %s 与不可变记录内部 ID %s 不一致", ErrCorruptData, objID, rec.ID)
		}
		records[rec.ID] = rec
	}

	return records, nil
}

// GetCurrentRecords 公共入口读取当前提交中引用的全部不可变记录集合，以整个公共操作覆盖生命周期
func (s *Store) GetCurrentRecords(workID string) (map[string]*Record, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	return s.getCurrentRecords(workID)
}

// getWorkSnapshot 内部读取指定作品的 head 快照：由 work.json 确定 commitID，再由该 commit 的 recordRefs 读取完整不可变记录集合
func (s *Store) getWorkSnapshot(workID string) (*Work, *Commit, map[string]*Record, error) {
	work, err := s.getWork(workID)
	if err != nil {
		return nil, nil, nil, err
	}

	commit, err := s.getCommit(workID, work.CurrentCommitID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("读取快照当前提交清单失败: %w", err)
	}

	if commit.Revision != work.Revision {
		return nil, nil, nil, fmt.Errorf("%w: 提交清单修订号 (%d) 与权威清单修订号 (%d) 不一致", ErrCorruptData, commit.Revision, work.Revision)
	}

	records := make(map[string]*Record, len(commit.RecordRefs))
	for objID, revID := range commit.RecordRefs {
		rec, err := s.getRecord(workID, revID)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("读取快照引用的记录 %s (%s) 失败: %w", objID, revID, err)
		}
		if rec.ID != objID {
			return nil, nil, nil, fmt.Errorf("%w: recordRefs 键 %s 与不可变记录内部 ID %s 不一致", ErrCorruptData, objID, rec.ID)
		}
		records[rec.ID] = rec
	}

	return work, commit, records, nil
}

// GetWorkSnapshot 公共入口以单个原子操作生命周期读取作品权威清单、当前提交及当前引用记录的快照
func (s *Store) GetWorkSnapshot(workID string) (*Work, *Commit, map[string]*Record, error) {
	if err := s.beginOp(); err != nil {
		return nil, nil, nil, err
	}
	defer s.endOp()

	return s.getWorkSnapshot(workID)
}

// readWorkManifest 读取并核验 work.json 权威文件，要求严格 EOF 无尾随多余数据
func (s *Store) readWorkManifest(path string) (*Work, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrWorkNotFound
		}
		return nil, fmt.Errorf("打开作品权威清单失败: %w", err)
	}
	defer file.Close()

	var work Work
	if err := decodeStrictJSON(file, &work); err != nil {
		return nil, fmt.Errorf("%w: 作品权威清单损坏或格式未知: %v", ErrCorruptData, err)
	}

	if work.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("%w: 作品清单版本不受支持 (%d)", ErrCorruptData, work.SchemaVersion)
	}
	if err := ValidateStorageID(work.CurrentCommitID); err != nil {
		return nil, fmt.Errorf("%w: 作品清单中的 currentCommitId 非法: %v", ErrCorruptData, err)
	}
	if work.Revision < 1 {
		return nil, fmt.Errorf("%w: 作品清单 revision 非法 (%d)", ErrCorruptData, work.Revision)
	}

	return &work, nil
}

// writeJSONToStaging 将任意数据序列化为 JSON 写入暂存文件，并强制审计重解析点、使用排他创建 (O_CREATE|O_EXCL) 与刷盘
func writeJSONToStaging(stagingPath string, v any) error {
	if err := checkNoReparsePoint(stagingPath); err != nil {
		return err
	}

	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化数据失败: %w", err)
	}

	// 必须使用 O_CREATE|O_EXCL，防止静默截断已存在的暂存文件
	f, err := os.OpenFile(stagingPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("排他创建暂存文件失败: %w", err)
	}

	if _, err := f.Write(data); err != nil {
		f.Close()
		_ = os.Remove(stagingPath)
		return fmt.Errorf("写入暂存文件失败: %w", err)
	}

	if err := f.Sync(); err != nil {
		f.Close()
		_ = os.Remove(stagingPath)
		return fmt.Errorf("刷盘暂存文件失败: %w", err)
	}

	if err := f.Close(); err != nil {
		_ = os.Remove(stagingPath)
		return fmt.Errorf("关闭暂存文件失败: %w", err)
	}

	// 再次审计新写入的暂存文件最终组件非重解析点
	if err := checkNoReparsePoint(stagingPath); err != nil {
		_ = os.Remove(stagingPath)
		return err
	}

	return nil
}

// decodeStrictJSON 严格解码 JSON 数据并确认 EOF，拒绝任何尾随多余数据
func decodeStrictJSON(r io.Reader, v any) error {
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(v); err != nil {
		return err
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("JSON 包含未期望的尾随数据")
	}
	return nil
}

// decodeStrictJSONBytes 严格解码字节切片为指定数据结构，要求 DisallowUnknownFields 与 EOF 强校验
func decodeStrictJSONBytes(b []byte, v any) error {
	return decodeStrictJSON(bytes.NewReader(b), v)
}

// computeRecordDigest 使用结构化规范 JSON 序列化计算记录的规范 SHA-256 摘要，禁止冒号拼接防碰撞
func computeRecordDigest(workID, id, recordType string, data json.RawMessage) (string, error) {
	var compactData bytes.Buffer
	if err := json.Compact(&compactData, data); err != nil {
		return "", fmt.Errorf("规范化记录数据失败: %w", err)
	}

	type canonicalRecordDigestInput struct {
		WorkID string          `json:"workId"`
		ID     string          `json:"id"`
		Type   string          `json:"type"`
		Data   json.RawMessage `json:"data"`
	}

	payload, err := json.Marshal(canonicalRecordDigestInput{
		WorkID: workID,
		ID:     id,
		Type:   recordType,
		Data:   compactData.Bytes(),
	})
	if err != nil {
		return "", fmt.Errorf("序列化记录摘要输入失败: %w", err)
	}

	h := sha256.Sum256(payload)
	return hex.EncodeToString(h[:]), nil
}
