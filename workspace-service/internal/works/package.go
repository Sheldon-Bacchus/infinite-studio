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
	"strings"
	"time"
)

// WorkPackagePreviewResult 作品导入预览响应模型
type WorkPackagePreviewResult struct {
	WorkID        string            `json:"workId"`
	Title         string            `json:"title"`
	Revision      int64             `json:"revision"`
	CommitCount   int               `json:"commitCount"`
	RecordCount   int               `json:"recordCount"`
	MediaCount    int               `json:"mediaCount"`
	TotalBytes    int64             `json:"totalBytes"`
	Conflicts     []ConflictInfo    `json:"conflicts"`
	MissingFiles  []MissingFileInfo `json:"missingFiles"`
	CanCommit     bool              `json:"canCommit"`
	PackageDigest string            `json:"packageDigest"`
}

func writeZipFileFromPath(zw *zip.Writer, name, sourcePath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("打开 ZIP 输入文件 %s 失败: %w", sourcePath, err)
	}
	destination, err := zw.Create(name)
	if err != nil {
		_ = source.Close()
		return err
	}
	if _, err := io.Copy(destination, source); err != nil {
		_ = source.Close()
		return fmt.Errorf("写入 ZIP 条目 %s 失败: %w", name, err)
	}
	if err := source.Close(); err != nil {
		return fmt.Errorf("关闭 ZIP 输入文件 %s 失败: %w", name, err)
	}
	return nil
}

// validateMigrationBackupFiles 核验迁移记录引用的原始来源包及清单彼此一致。
func validateMigrationBackupFiles(packagePath, manifestPath string) error {
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("读取备份清单失败: %w", err)
	}
	packageBytes, err := os.ReadFile(packagePath)
	if err != nil {
		return fmt.Errorf("读取原始来源包失败: %w", err)
	}
	return validateMigrationBackupBytes(packageBytes, manifestBytes)
}

func validateMigrationBackupBytes(packageBytes, manifestBytes []byte) error {
	var manifest MigrationManifest
	if err := decodeStrictJSONBytes(manifestBytes, &manifest); err != nil {
		return fmt.Errorf("备份清单格式无效: %w", err)
	}
	if manifest.SchemaVersion != SchemaVersion || manifest.SourceID == "" {
		return fmt.Errorf("备份清单 schema 或 sourceId 无效")
	}
	if err := ValidateHashID(manifest.SourceDigest); err != nil {
		return fmt.Errorf("备份清单 sourceDigest 无效: %w", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(packageBytes), int64(len(packageBytes)))
	if err != nil {
		return fmt.Errorf("原始来源包 ZIP 无效: %w", err)
	}
	if err := validateZipSecurity(zr); err != nil {
		return err
	}
	entries := make(map[string]*zip.File, len(zr.File))
	for _, file := range zr.File {
		entries[filepath.ToSlash(file.Name)] = file
	}
	if _, ok := entries["manifest.json"]; !ok {
		return fmt.Errorf("原始来源包缺少 manifest.json")
	}
	embeddedManifestBytes, err := readZipEntryBytes(entries, "manifest.json")
	if err != nil {
		return fmt.Errorf("读取原始来源包清单失败: %w", err)
	}
	var embedded MigrationManifest
	if err := decodeStrictJSONBytes(embeddedManifestBytes, &embedded); err != nil {
		return fmt.Errorf("原始来源包内清单格式无效: %w", err)
	}
	externalCanonical, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	embeddedCanonical, err := json.Marshal(embedded)
	if err != nil {
		return err
	}
	if !bytes.Equal(embeddedCanonical, externalCanonical) {
		return fmt.Errorf("原始来源包内清单与外部备份清单不一致")
	}
	source, ok := entries["source.json"]
	if !ok {
		return fmt.Errorf("原始来源包缺少 source.json")
	}
	sourceFile, err := source.Open()
	if err != nil {
		return err
	}
	hasher := sha256.New()
	_, copyErr := io.Copy(hasher, sourceFile)
	closeErr := sourceFile.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	sourceDigest := hex.EncodeToString(hasher.Sum(nil))
	if manifest.SourceSnapshotDigest != "" && sourceDigest != manifest.SourceSnapshotDigest {
		return fmt.Errorf("source.json 摘要与备份清单不一致")
	}
	computedDigest, err := computeMigrationSubstantiveDigest(&manifest, sourceDigest)
	if err != nil || computedDigest != manifest.SourceDigest {
		return fmt.Errorf("迁移来源内容摘要与备份清单不一致")
	}

	expectedEntries := map[string]bool{"manifest.json": true, "source.json": true}
	for _, fileInfo := range manifest.Files {
		safeExt, _, err := NormalizeMediaExtension(fileInfo.MIMEType)
		if err != nil || fileInfo.Bytes <= 0 || ValidateHashID(fileInfo.SHA256) != nil {
			return fmt.Errorf("备份清单包含非法媒体描述")
		}
		expectedPath := fmt.Sprintf("files/%s%s", fileInfo.SHA256, safeExt)
		if filepath.ToSlash(fileInfo.Path) != expectedPath {
			return fmt.Errorf("备份清单媒体路径不符合摘要命名规则: %s", fileInfo.Path)
		}
		file, ok := entries[expectedPath]
		if !ok || file.UncompressedSize64 != uint64(fileInfo.Bytes) {
			return fmt.Errorf("备份来源包缺少媒体原件或大小不匹配: %s", expectedPath)
		}
		media, err := file.Open()
		if err != nil {
			return err
		}
		mediaHash := sha256.New()
		written, copyErr := io.Copy(mediaHash, media)
		closeErr := media.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if written != fileInfo.Bytes || hex.EncodeToString(mediaHash.Sum(nil)) != fileInfo.SHA256 {
			return fmt.Errorf("备份媒体原件摘要或大小不匹配: %s", expectedPath)
		}
		expectedEntries[expectedPath] = true
	}
	for name := range entries {
		if entries[name].FileInfo().IsDir() {
			continue
		}
		if !expectedEntries[name] {
			return fmt.Errorf("原始来源包包含清单未声明的条目: %s", name)
		}
	}
	return nil
}

func validateWorkPackageEntry(file *zip.File) error {
	name := file.Name
	if file.FileInfo().IsDir() {
		name = strings.TrimSuffix(name, "/")
	}
	parts := strings.Split(name, "/")
	if name == "work.json" {
		if file.FileInfo().IsDir() {
			return fmt.Errorf("work.json 不能是目录")
		}
		return nil
	}
	if len(parts) == 1 && (parts[0] == "commits" || parts[0] == "records" || parts[0] == "media" || parts[0] == "backups") && file.FileInfo().IsDir() {
		return nil
	}
	if parts[0] == "commits" && len(parts) == 2 && file.FileInfo().IsDir() {
		return ValidateStorageID(parts[1])
	}
	if parts[0] == "backups" && len(parts) == 2 && file.FileInfo().IsDir() {
		return ValidateStorageID(parts[1])
	}
	if file.FileInfo().IsDir() {
		return fmt.Errorf("作品包包含未知目录条目: %s", file.Name)
	}
	switch {
	case len(parts) == 3 && parts[0] == "commits" && parts[2] == "manifest.json":
		return ValidateStorageID(parts[1])
	case len(parts) == 2 && parts[0] == "records" && strings.HasSuffix(parts[1], ".json"):
		return ValidateHashID(strings.TrimSuffix(parts[1], ".json"))
	case len(parts) == 2 && parts[0] == "media":
		base := parts[1]
		ext := strings.ToLower(filepath.Ext(base))
		if _, ok := ExtToFormatMap[ext]; !ok {
			return fmt.Errorf("作品包媒体扩展名不受支持: %s", base)
		}
		return ValidateHashID(strings.TrimSuffix(base, filepath.Ext(base)))
	case len(parts) == 3 && parts[0] == "backups" && (parts[2] == "package.zip" || parts[2] == "manifest.json"):
		return ValidateStorageID(parts[1])
	default:
		return fmt.Errorf("作品包包含未知条目或 schema: %s", file.Name)
	}
}

func readZipEntryBytes(files map[string]*zip.File, name string) ([]byte, error) {
	file, ok := files[name]
	if !ok {
		return nil, os.ErrNotExist
	}
	r, err := file.Open()
	if err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(r)
	closeErr := r.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	return data, nil
}

func sameFileBytes(leftPath, rightPath string) (bool, error) {
	left, err := os.Open(leftPath)
	if err != nil {
		return false, err
	}
	defer left.Close()
	right, err := os.Open(rightPath)
	if err != nil {
		return false, err
	}
	defer right.Close()
	leftHash, rightHash := sha256.New(), sha256.New()
	leftSize, err := io.Copy(leftHash, left)
	if err != nil {
		return false, err
	}
	rightSize, err := io.Copy(rightHash, right)
	if err != nil {
		return false, err
	}
	return leftSize == rightSize && hex.EncodeToString(leftHash.Sum(nil)) == hex.EncodeToString(rightHash.Sum(nil)), nil
}

func (s *Store) publishPackageBackups(stagingBackupsDir string) error {
	entries, err := os.ReadDir(stagingBackupsDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("读取暂存来源备份失败: %w", err)
	}
	rootBackups, err := s.locator.BackupsDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(rootBackups, 0700); err != nil {
		return fmt.Errorf("创建作品来源备份目录失败: %w", err)
	}
	if err := checkNoReparsePoint(rootBackups); err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			return fmt.Errorf("暂存来源备份包含未知文件: %s", entry.Name())
		}
		backupID := entry.Name()
		if err := ValidateStorageID(backupID); err != nil {
			return fmt.Errorf("暂存来源备份 ID 非法: %w", err)
		}
		sourceDir := filepath.Join(stagingBackupsDir, backupID)
		sourcePackage := filepath.Join(sourceDir, "package.zip")
		sourceManifest := filepath.Join(sourceDir, "manifest.json")
		if err := validateMigrationBackupFiles(sourcePackage, sourceManifest); err != nil {
			return fmt.Errorf("暂存来源备份 %s 无效: %w", backupID, err)
		}
		destinationDir, err := s.locator.BackupDir(backupID)
		if err != nil {
			return err
		}
		if _, statErr := os.Lstat(destinationDir); statErr == nil {
			if err := checkNoReparsePoint(destinationDir); err != nil {
				return err
			}
			destinationEntries, err := os.ReadDir(destinationDir)
			if err != nil {
				return fmt.Errorf("读取已存在来源备份目录失败: %w", err)
			}
			if len(destinationEntries) != 2 {
				return fmt.Errorf("%w: 已存在来源备份 %s 包含未预期条目", ErrConflict, backupID)
			}
			for _, existing := range destinationEntries {
				if existing.IsDir() || (existing.Name() != "package.zip" && existing.Name() != "manifest.json") {
					return fmt.Errorf("%w: 已存在来源备份 %s 包含未预期条目 %s", ErrConflict, backupID, existing.Name())
				}
				if err := checkNoReparsePoint(filepath.Join(destinationDir, existing.Name())); err != nil {
					return err
				}
			}
			for _, name := range []string{"package.zip", "manifest.json"} {
				same, err := sameFileBytes(filepath.Join(sourceDir, name), filepath.Join(destinationDir, name))
				if err != nil || !same {
					return fmt.Errorf("%w: 已存在的来源备份 %s 内容与导入包不一致", ErrConflict, backupID)
				}
			}
			continue
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return fmt.Errorf("核验目标来源备份失败: %w", statErr)
		}
		if err := moveFileNoReplace(sourceDir, destinationDir); err != nil {
			return fmt.Errorf("原子发布来源备份 %s 失败: %w", backupID, err)
		}
	}
	return nil
}

// ExportWorkZip 导出指定已提交修订版本（或当前最新版本）的完整作品 ZIP 包。
// 规则：
// 1. 导出指定 revision 对应的权威 commit 清单、可达提交链、所有引用不可变记录及物理原件；
// 2. 使用真实的记录描述符与 SHA-256 原件哈希读取媒体；
// 3. 严格排除密钥、Token、SQLite/index、缓存、staging 及未提交草稿；
// 4. 沿用作品互斥锁保证导出时版本一致性。
func (s *Store) ExportWorkZip(workID string, revision int64, w io.Writer) error {
	if err := s.beginOp(); err != nil {
		return err
	}
	defer s.endOp()

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	if err := ValidateStorageID(workID); err != nil {
		return err
	}

	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	work, err := s.getWork(workID)
	if err != nil {
		return err
	}

	targetRev := revision
	if targetRev <= 0 {
		targetRev = work.Revision
	}
	if targetRev > work.Revision {
		return fmt.Errorf("%w: 指定修订版本 r%d 超过当前作品版本 r%d", ErrInvalidRequest, targetRev, work.Revision)
	}

	// 1. 沿提交链回溯定位目标 revision 的 Commit
	currCommit, err := s.getCommit(workID, work.CurrentCommitID)
	if err != nil {
		return fmt.Errorf("读取当前提交清单失败: %w", err)
	}

	visitedTargetCommits := make(map[string]bool)
	for currCommit.Revision > targetRev {
		if visitedTargetCommits[currCommit.ID] {
			return fmt.Errorf("提交链包含循环引用: %s", currCommit.ID)
		}
		visitedTargetCommits[currCommit.ID] = true
		if currCommit.PreviousCommitID == "" {
			return fmt.Errorf("%w: 未能找到版本 r%d 对应的历史提交", ErrInvalidRequest, targetRev)
		}
		prev, err := s.getCommit(workID, currCommit.PreviousCommitID)
		if err != nil {
			return fmt.Errorf("读取提交 %s 失败: %w", currCommit.PreviousCommitID, err)
		}
		currCommit = prev
	}
	if currCommit.Revision != targetRev {
		return fmt.Errorf("%w: 未能找到版本 r%d 对应的历史提交", ErrInvalidRequest, targetRev)
	}
	targetCommit := currCommit

	// 2. 收集从 targetCommit 回溯至初始提交 r1 的完整提交链
	commits := make([]*Commit, 0, targetRev)
	c := targetCommit
	visitedCommits := make(map[string]bool)
	for {
		if visitedCommits[c.ID] {
			return fmt.Errorf("提交链包含循环引用: %s", c.ID)
		}
		visitedCommits[c.ID] = true
		if c.WorkID != workID || c.Revision != targetRev-int64(len(commits)) || c.Revision != c.BaseRevision+1 {
			return fmt.Errorf("提交链包含无效作品归属或修订关系: %s", c.ID)
		}
		commits = append(commits, c)
		if c.Revision == 1 {
			if c.PreviousCommitID != "" || c.BaseRevision != 0 {
				return fmt.Errorf("根提交修订关系无效: %s", c.ID)
			}
			break
		}
		if c.PreviousCommitID == "" {
			return fmt.Errorf("提交链在 r%d 前意外结束", c.Revision)
		}
		prev, err := s.getCommit(workID, c.PreviousCommitID)
		if err != nil {
			return fmt.Errorf("读取提交 %s 失败: %w", c.PreviousCommitID, err)
		}
		if prev.Revision != c.BaseRevision {
			return fmt.Errorf("提交 %s 与父提交 %s 修订关系不一致", c.ID, prev.ID)
		}
		c = prev
	}

	// 3. 收集所有提交引用的不可变记录与媒体原件
	recordsToExport := make(map[string]*Record)
	mediaToExport := make(map[string]*MediaDescriptor)
	backupsToExport := make(map[string]bool)

	for _, cm := range commits {
		for _, revID := range cm.RecordRefs {
			if _, exists := recordsToExport[revID]; exists {
				continue
			}
			rec, err := s.getRecord(workID, revID)
			if err != nil {
				return fmt.Errorf("读取记录 %s 失败: %w", revID, err)
			}
			recordsToExport[revID] = rec

			if rec.Type == RecordTypeMedia {
				var desc MediaDescriptor
				if err := decodeStrictJSONBytes(rec.Data, &desc); err != nil {
					return fmt.Errorf("解析媒体描述符 %s 失败: %w", revID, err)
				}
				if desc.FileID != rec.ID || desc.WorkID != workID || desc.Bytes <= 0 || ValidateHashID(desc.SHA256) != nil {
					return fmt.Errorf("媒体描述符 %s 身份、大小或摘要无效", revID)
				}
				safeExt, kind, err := NormalizeMediaExtension(desc.MIMEType)
				if err != nil || safeExt != desc.Extension || kind != desc.Kind {
					return fmt.Errorf("媒体描述符 %s 类型或扩展名无效", revID)
				}
				key := desc.SHA256 + desc.Extension
				mediaToExport[key] = &desc
			} else if rec.Type == RecordTypeMigration {
				var mig MigrationData
				if err := decodeStrictJSONBytes(rec.Data, &mig); err != nil {
					return fmt.Errorf("解析迁移备份引用 %s 失败: %w", revID, err)
				}
				for _, bID := range mig.BackupReferences {
					if err := ValidateStorageID(bID); err != nil {
						return fmt.Errorf("迁移记录 %s 包含非法备份引用 %q: %w", revID, bID, err)
					}
					backupsToExport[bID] = true
				}
			}
		}
	}

	// 4. 打包输出 ZIP
	zw := zip.NewWriter(w)

	// 写入 work.json
	exportedWork := &Work{
		SchemaVersion:   SchemaVersion,
		ID:              workID,
		Title:           work.Title,
		CurrentCommitID: targetCommit.ID,
		Revision:        targetRev,
		CreatedAt:       work.CreatedAt,
		UpdatedAt:       targetCommit.CreatedAt,
	}
	workBytes, err := json.MarshalIndent(exportedWork, "", "  ")
	if err != nil {
		_ = zw.Close()
		return err
	}
	wf, err := zw.Create("work.json")
	if err != nil {
		_ = zw.Close()
		return err
	}
	if _, err := wf.Write(workBytes); err != nil {
		_ = zw.Close()
		return err
	}

	// 写入 commits/{commitId}/manifest.json
	for _, cm := range commits {
		cmBytes, err := json.MarshalIndent(cm, "", "  ")
		if err != nil {
			_ = zw.Close()
			return err
		}
		cf, err := zw.Create(fmt.Sprintf("commits/%s/manifest.json", cm.ID))
		if err != nil {
			_ = zw.Close()
			return err
		}
		if _, err := cf.Write(cmBytes); err != nil {
			_ = zw.Close()
			return err
		}
	}

	// 写入 records/{revisionId}.json
	for revID, rec := range recordsToExport {
		recBytes, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			_ = zw.Close()
			return err
		}
		rf, err := zw.Create(fmt.Sprintf("records/%s.json", revID))
		if err != nil {
			_ = zw.Close()
			return err
		}
		if _, err := rf.Write(recBytes); err != nil {
			_ = zw.Close()
			return err
		}
	}

	// 写入 media/{sha256}{ext}
	for filename, desc := range mediaToExport {
		mediaPath, err := s.locator.MediaPath(workID, desc.SHA256, desc.Extension)
		if err != nil {
			_ = zw.Close()
			return err
		}
		mf, err := os.Open(mediaPath)
		if err != nil {
			_ = zw.Close()
			return fmt.Errorf("打开媒体原件 %s 失败: %w", mediaPath, err)
		}
		zf, err := zw.Create(fmt.Sprintf("media/%s", filename))
		if err != nil {
			_ = mf.Close()
			_ = zw.Close()
			return err
		}
		hasher := sha256.New()
		written, copyErr := io.Copy(io.MultiWriter(zf, hasher), mf)
		closeErr := mf.Close()
		if copyErr != nil {
			_ = zw.Close()
			return fmt.Errorf("读取媒体原件 %s 失败: %w", filename, copyErr)
		}
		if closeErr != nil {
			_ = zw.Close()
			return fmt.Errorf("关闭媒体原件 %s 失败: %w", filename, closeErr)
		}
		if written != desc.Bytes || hex.EncodeToString(hasher.Sum(nil)) != desc.SHA256 {
			_ = zw.Close()
			return fmt.Errorf("媒体原件 %s 的真实大小或 SHA-256 与描述符不匹配", filename)
		}
	}

	// 写入关联引用的根 backups/{backupID}/
	for bID := range backupsToExport {
		pkgPath, err := s.locator.BackupPackagePath(bID)
		if err != nil {
			_ = zw.Close()
			return err
		}
		mfPath, err := s.locator.BackupManifestPath(bID)
		if err != nil {
			_ = zw.Close()
			return err
		}
		if err := validateMigrationBackupFiles(pkgPath, mfPath); err != nil {
			_ = zw.Close()
			return fmt.Errorf("校验来源备份 %s 失败: %w", bID, err)
		}
		if err := writeZipFileFromPath(zw, fmt.Sprintf("backups/%s/package.zip", bID), pkgPath); err != nil {
			_ = zw.Close()
			return err
		}
		if err := writeZipFileFromPath(zw, fmt.Sprintf("backups/%s/manifest.json", bID), mfPath); err != nil {
			_ = zw.Close()
			return err
		}
	}

	if err := zw.Close(); err != nil {
		return fmt.Errorf("关闭作品 ZIP 归档输出流失败: %w", err)
	}

	return nil
}

// PreviewWorkZip 深度校验并预览作品 ZIP 包。
// 规则：
// 1. 使用标准 archive/zip 解析；
// 2. 严格核验条目相对路径：拒绝反斜杠、绝对路径、冒号（ADS）、设备名、点段遍历 (..)；
// 3. 拒绝大小写重名冲突与非普通文件/软链接；
// 4. 严格校验 work.json、提交链连贯性、不可变记录 SHA-256 摘要与媒体文件匹配；
// 5. 检查本地作品 ID 冲突；
// 6. 计算包整体 SHA-256 摘要。
func (s *Store) PreviewWorkZip(r io.ReaderAt, size int64) (*WorkPackagePreviewResult, error) {
	if size <= 0 {
		return nil, fmt.Errorf("%w: 作品包大小非法", ErrInvalidRequest)
	}

	// 计算 ZIP 整体 SHA-256 摘要
	hasher := sha256.New()
	sr := io.NewSectionReader(r, 0, size)
	if _, err := io.Copy(hasher, sr); err != nil {
		return nil, fmt.Errorf("计算包摘要失败: %w", err)
	}
	packageDigest := hex.EncodeToString(hasher.Sum(nil))

	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, fmt.Errorf("%w: ZIP 包解析失败: %v", ErrInvalidRequest, err)
	}

	// 1. 扫描所有条目并做路径安全校验与大小写重名核验
	seenNames := make(map[string]bool, len(zr.File))
	zipFilesMap := make(map[string]*zip.File, len(zr.File))

	for _, f := range zr.File {
		name := f.Name
		if strings.Contains(name, `\`) {
			return nil, fmt.Errorf("%w: ZIP 条目路径包含非法反斜杠: %s", ErrInvalidRequest, name)
		}
		if strings.HasPrefix(name, "/") || filepath.IsAbs(name) {
			return nil, fmt.Errorf("%w: ZIP 条目不能为绝对路径: %s", ErrInvalidRequest, name)
		}
		if strings.ContainsAny(name, `:*<>|?`) {
			return nil, fmt.Errorf("%w: ZIP 条目包含非法字符或流指示符: %s", ErrInvalidRequest, name)
		}

		parts := strings.Split(name, "/")
		for _, part := range parts {
			if part == ".." || part == "." {
				return nil, fmt.Errorf("%w: ZIP 条目包含相对路径指示符: %s", ErrInvalidRequest, name)
			}
			if isDOSDeviceName(part) {
				return nil, fmt.Errorf("%w: ZIP 条目包含 Windows 保留设备名: %s", ErrInvalidRequest, name)
			}
		}

		lower := strings.ToLower(name)
		if seenNames[lower] {
			return nil, fmt.Errorf("%w: ZIP 条目包含大小写重名冲突: %s", ErrInvalidRequest, name)
		}
		seenNames[lower] = true
		zipFilesMap[name] = f

		// 拒绝符号链接与特殊设备文件
		if !f.FileInfo().IsDir() && f.Mode()&os.ModeType != 0 {
			return nil, fmt.Errorf("%w: ZIP 包含非普通文件或符号链接: %s", ErrInvalidRequest, name)
		}
		if err := validateWorkPackageEntry(f); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		}
	}

	// 2. 检查并解析 work.json
	workFile, ok := zipFilesMap["work.json"]
	if !ok {
		return nil, fmt.Errorf("%w: 作品包缺少权威元数据 work.json", ErrInvalidRequest)
	}

	rc, err := workFile.Open()
	if err != nil {
		return nil, fmt.Errorf("打开 work.json 失败: %w", err)
	}
	var work Work
	decErr := decodeStrictJSONReader(rc, &work)
	closeErr := rc.Close()
	if decErr != nil {
		return nil, fmt.Errorf("%w: 解析 work.json 失败: %v", ErrInvalidRequest, decErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("关闭 work.json 失败: %w", closeErr)
	}

	if err := ValidateStorageID(work.ID); err != nil {
		return nil, fmt.Errorf("%w: work.json 作品 ID 非法: %v", ErrInvalidRequest, err)
	}
	if work.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("%w: work.json schemaVersion 不受支持", ErrInvalidRequest)
	}
	if work.Revision < 1 || work.CurrentCommitID == "" {
		return nil, fmt.Errorf("%w: work.json 版本或提交 ID 非法", ErrInvalidRequest)
	}

	conflicts := make([]ConflictInfo, 0)
	missingFiles := make([]MissingFileInfo, 0)

	// 检查本地作品 ID 是否已存在
	workDir, err := s.locator.WorkDir(work.ID)
	if err == nil {
		if _, statErr := os.Lstat(workDir); statErr == nil {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "work_already_exists",
				Message: fmt.Sprintf("作品《%s》 (ID: %s) 在本地仓库中已存在，拒绝静默覆盖", work.Title, work.ID),
			})
		}
	}

	// 3. 统计包内条目数
	commitCount := 0
	recordCount := 0
	mediaCount := 0

	for name, f := range zipFilesMap {
		if strings.HasPrefix(name, "commits/") && strings.HasSuffix(name, "/manifest.json") {
			commitCount++
		} else if strings.HasPrefix(name, "records/") && strings.HasSuffix(name, ".json") {
			recordCount++
		} else if strings.HasPrefix(name, "media/") && !f.FileInfo().IsDir() {
			mediaCount++
		}
	}

	// 4. 沿提交历史回溯完整有序提交链并执行环检测与父子修订强约束校验
	visitedCommits := make(map[string]bool)
	commitsChain := make([]*Commit, 0)
	currCommitID := work.CurrentCommitID
	expectedRev := work.Revision
	var prevChildCommit *Commit

	for currCommitID != "" {
		if visitedCommits[currCommitID] {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "commit_cycle_detected",
				Message: fmt.Sprintf("提交链中检测到循环引用: %s", currCommitID),
			})
			break
		}
		visitedCommits[currCommitID] = true

		commitEntry := fmt.Sprintf("commits/%s/manifest.json", currCommitID)
		cf, ok := zipFilesMap[commitEntry]
		if !ok {
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   commitEntry,
				Reason: "missing_commit_manifest",
			})
			break
		}

		rcCommit, err := cf.Open()
		if err != nil {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "unreadable_commit_manifest",
				Message: fmt.Sprintf("打开提交清单 %s 失败: %v", commitEntry, err),
			})
			break
		}
		var commit Commit
		decErr := decodeStrictJSONReader(rcCommit, &commit)
		closeErr := rcCommit.Close()
		if decErr != nil {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "corrupted_commit_manifest",
				Message: fmt.Sprintf("提交清单 %s 数据格式损坏: %v", commitEntry, decErr),
			})
			break
		}
		if closeErr != nil {
			conflicts = append(conflicts, ConflictInfo{Type: "commit_manifest_close_error", Message: fmt.Sprintf("关闭提交清单 %s 失败: %v", commitEntry, closeErr)})
			break
		}

		if commit.ID != currCommitID {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "commit_id_mismatch",
				Message: fmt.Sprintf("提交清单路径声明 ID (%s) 与内容 ID (%s) 不符", currCommitID, commit.ID),
			})
		}
		if commit.SchemaVersion != SchemaVersion || ValidateHashID(commit.RequestDigest) != nil || !commit.Receipt.Committed || commit.Receipt.WorkID != work.ID || commit.Receipt.CommitID != commit.ID || commit.Receipt.Revision != commit.Revision || commit.Receipt.OperationID != commit.OperationID || commit.OperationID == "" {
			conflicts = append(conflicts, ConflictInfo{Type: "invalid_commit_receipt", Message: fmt.Sprintf("提交 %s schema、摘要或操作回执无效", currCommitID)})
		}
		if commit.WorkID != work.ID {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "commit_work_id_mismatch",
				Message: fmt.Sprintf("提交清单 %s 的 workId (%s) 与作品 ID (%s) 不一致", currCommitID, commit.WorkID, work.ID),
			})
		}
		if commit.Revision != expectedRev {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "commit_revision_mismatch",
				Message: fmt.Sprintf("提交 %s 修订号 (%d) 与预期修订号 (%d) 不一致", currCommitID, commit.Revision, expectedRev),
			})
		}
		if commit.Revision != commit.BaseRevision+1 {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "commit_base_revision_mismatch",
				Message: fmt.Sprintf("提交 %s 修订号 (%d) 不等于基准修订号 (%d) + 1", currCommitID, commit.Revision, commit.BaseRevision),
			})
		}
		if prevChildCommit != nil && commit.Revision != prevChildCommit.BaseRevision {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "commit_parent_revision_mismatch",
				Message: fmt.Sprintf("父提交 %s 修订号 (%d) 与子提交基准修订号 (%d) 不一致", commit.ID, commit.Revision, prevChildCommit.BaseRevision),
			})
		}

		commitsChain = append(commitsChain, &commit)

		if commit.PreviousCommitID == "" {
			if commit.Revision != 1 || commit.BaseRevision != 0 {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "invalid_root_commit",
					Message: fmt.Sprintf("根提交 %s 修订号约束非法 (rev=%d, base=%d)", commit.ID, commit.Revision, commit.BaseRevision),
				})
			}
			break
		}

		prevChildCommit = &commit
		currCommitID = commit.PreviousCommitID
		expectedRev--
	}

	// 5. 校验可达提交链中引用的全量不可变记录的存在性、反序列化与真实规范摘要
	reachableRecords := make(map[string]*Record)
	reachableMedia := make(map[string]*MediaDescriptor)

	for _, cm := range commitsChain {
		for objID, revID := range cm.RecordRefs {
			if _, exists := reachableRecords[revID]; exists {
				continue
			}

			recEntry := fmt.Sprintf("records/%s.json", revID)
			rf, ok := zipFilesMap[recEntry]
			if !ok {
				missingFiles = append(missingFiles, MissingFileInfo{
					SourceAssetID: objID,
					Path:          recEntry,
					Reason:        "missing_record_file",
				})
				continue
			}

			rcRec, err := rf.Open()
			if err != nil {
				missingFiles = append(missingFiles, MissingFileInfo{
					SourceAssetID: objID,
					Path:          recEntry,
					Reason:        "unreadable_record_file",
				})
				continue
			}
			var record Record
			decErr := decodeStrictJSONReader(rcRec, &record)
			closeErr := rcRec.Close()
			if decErr != nil {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "corrupted_record_json",
					Message: fmt.Sprintf("记录 %s 数据格式损坏: %v", recEntry, decErr),
				})
				continue
			}
			if closeErr != nil {
				conflicts = append(conflicts, ConflictInfo{Type: "record_close_error", Message: fmt.Sprintf("关闭记录 %s 失败: %v", recEntry, closeErr)})
				continue
			}

			if record.SchemaVersion != SchemaVersion || record.ID != objID || record.RevisionID != revID || record.WorkID != work.ID {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "record_identity_mismatch",
					Message: fmt.Sprintf("记录 %s 内部声明与引用不符 (objId=%s, revId=%s, workId=%s)", recEntry, record.ID, record.RevisionID, record.WorkID),
				})
				continue
			}
			if _, ok := ValidRecordTypes[record.Type]; !ok {
				conflicts = append(conflicts, ConflictInfo{Type: "unknown_record_type", Message: fmt.Sprintf("记录 %s 使用未知记录类型 %q", recEntry, record.Type)})
				continue
			}

			computedDigest, err := computeRecordDigest(work.ID, record.ID, record.Type, record.Data)
			if err != nil || computedDigest != revID {
				conflicts = append(conflicts, ConflictInfo{
					Type:    "record_digest_mismatch",
					Message: fmt.Sprintf("记录 %s 规范 SHA-256 摘要不匹配 (声明: %s, 实际计算: %s)", recEntry, revID, computedDigest),
				})
				continue
			}

			reachableRecords[revID] = &record

			if record.Type == RecordTypeMedia {
				var desc MediaDescriptor
				if mErr := decodeStrictJSONBytes(record.Data, &desc); mErr != nil {
					conflicts = append(conflicts, ConflictInfo{
						Type:    "corrupted_media_descriptor",
						Message: fmt.Sprintf("媒体描述符 %s 损坏: %v", recEntry, mErr),
					})
					continue
				}
				if desc.FileID != record.ID || desc.WorkID != work.ID {
					conflicts = append(conflicts, ConflictInfo{
						Type:    "media_identity_mismatch",
						Message: fmt.Sprintf("媒体记录 %s 内部元数据与记录身份不一致", recEntry),
					})
					continue
				}
				safeExt, kind, err := NormalizeMediaExtension(desc.MIMEType)
				if err != nil || desc.Kind != kind || desc.Extension != safeExt {
					conflicts = append(conflicts, ConflictInfo{
						Type:    "media_format_mismatch",
						Message: fmt.Sprintf("媒体记录 %s MIME/类型/扩展名格式不规范", recEntry),
					})
					continue
				}
				reachableMedia[desc.SHA256+desc.Extension] = &desc
			}
		}
	}

	// 6a. 迁移记录引用的原始来源备份也必须随包完整携带，并核对与清单/原件摘要的关系。
	backupReferences := make(map[string]bool)
	for _, record := range reachableRecords {
		if record.Type != RecordTypeMigration {
			continue
		}
		var migration MigrationData
		if err := decodeStrictJSONBytes(record.Data, &migration); err != nil {
			conflicts = append(conflicts, ConflictInfo{Type: "corrupted_migration_record", Message: fmt.Sprintf("迁移记录 %s 数据损坏: %v", record.ID, err)})
			continue
		}
		for _, backupID := range migration.BackupReferences {
			if err := ValidateStorageID(backupID); err != nil {
				conflicts = append(conflicts, ConflictInfo{Type: "invalid_backup_reference", Message: fmt.Sprintf("迁移记录 %s 包含非法备份引用", record.ID)})
				continue
			}
			backupReferences[backupID] = true
		}
	}
	for backupID := range backupReferences {
		packageName := fmt.Sprintf("backups/%s/package.zip", backupID)
		manifestName := fmt.Sprintf("backups/%s/manifest.json", backupID)
		packageBytes, packageErr := readZipEntryBytes(zipFilesMap, packageName)
		manifestBytes, manifestErr := readZipEntryBytes(zipFilesMap, manifestName)
		if packageErr != nil || manifestErr != nil {
			missingFiles = append(missingFiles, MissingFileInfo{Path: packageName, Reason: "missing_source_backup"})
			if manifestErr != nil {
				missingFiles = append(missingFiles, MissingFileInfo{Path: manifestName, Reason: "missing_source_backup_manifest"})
			}
			continue
		}
		if err := validateMigrationBackupBytes(packageBytes, manifestBytes); err != nil {
			conflicts = append(conflicts, ConflictInfo{Type: "invalid_source_backup", Message: fmt.Sprintf("来源备份 %s 校验失败: %v", backupID, err)})
		}
	}
	for name := range zipFilesMap {
		if !strings.HasPrefix(name, "backups/") {
			continue
		}
		parts := strings.Split(name, "/")
		if len(parts) == 3 && !backupReferences[parts[1]] {
			conflicts = append(conflicts, ConflictInfo{Type: "unreferenced_source_backup", Message: fmt.Sprintf("作品包包含未被迁移记录引用的来源备份: %s", name)})
		}
	}

	// 6. 校验全量可达物理媒体原件的存在性、字节大小与流式 SHA-256 真实哈希
	for _, desc := range reachableMedia {
		mediaEntry := fmt.Sprintf("media/%s%s", desc.SHA256, desc.Extension)
		mf, ok := zipFilesMap[mediaEntry]
		if !ok {
			missingFiles = append(missingFiles, MissingFileInfo{
				Path:   mediaEntry,
				Reason: "missing_media_file",
				SHA256: desc.SHA256,
			})
			continue
		}

		if mf.UncompressedSize64 != uint64(desc.Bytes) {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "media_size_mismatch",
				Message: fmt.Sprintf("媒体文件 %s 声明大小 (%d) 与 ZIP 元数据大小 (%d) 不符", mediaEntry, desc.Bytes, mf.UncompressedSize64),
			})
		}

		rcMedia, err := mf.Open()
		if err != nil {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "unreadable_media_file",
				Message: fmt.Sprintf("打开媒体文件 %s 失败: %v", mediaEntry, err),
			})
			continue
		}

		mHasher := sha256.New()
		written, err := io.Copy(mHasher, rcMedia)
		closeErr := rcMedia.Close()
		if err != nil {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "media_read_error",
				Message: fmt.Sprintf("读取媒体文件 %s 计算摘要失败: %v", mediaEntry, err),
			})
			continue
		}
		if closeErr != nil {
			conflicts = append(conflicts, ConflictInfo{Type: "media_close_error", Message: fmt.Sprintf("关闭媒体文件 %s 失败: %v", mediaEntry, closeErr)})
			continue
		}

		if written != desc.Bytes {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "media_size_mismatch",
				Message: fmt.Sprintf("媒体文件 %s 实际读取大小 (%d) 与描述符 (%d) 不符", mediaEntry, written, desc.Bytes),
			})
		}

		actualSHA := hex.EncodeToString(mHasher.Sum(nil))
		if actualSHA != desc.SHA256 {
			conflicts = append(conflicts, ConflictInfo{
				Type:    "media_hash_mismatch",
				Message: fmt.Sprintf("媒体文件 %s 实际 SHA-256 内容摘要 (%s) 与声明 (%s) 不符", mediaEntry, actualSHA, desc.SHA256),
			})
		}
	}

	// 7. 严格核验 Head 提交中业务实体的相互归属与媒体引用关系
	if len(commitsChain) > 0 {
		headCommit := commitsChain[0]
		headRecordsByObjID := make(map[string]*Record)
		for objID, revID := range headCommit.RecordRefs {
			if rec, exists := reachableRecords[revID]; exists {
				headRecordsByObjID[objID] = rec
			}
		}

		for objID, rec := range headRecordsByObjID {
			switch rec.Type {
			case RecordTypeAsset:
				var asset AssetData
				if err := decodeStrictJSONBytes(rec.Data, &asset); err == nil {
					for _, mediaID := range asset.CurrentMediaIDs {
						mRec, exists := headRecordsByObjID[mediaID]
						if !exists || mRec.Type != RecordTypeMedia {
							conflicts = append(conflicts, ConflictInfo{
								Type:    "unresolved_media_reference",
								Message: fmt.Sprintf("资产 %s 引用的媒体 %s 在当前版本中不存在或不是 media 记录", objID, mediaID),
							})
						}
					}
				}
			case RecordTypeShot:
				var shot ShotData
				if err := decodeStrictJSONBytes(rec.Data, &shot); err == nil {
					srRec, exists := headRecordsByObjID[shot.CurrentRevision]
					if !exists || srRec.Type != RecordTypeShotRevision {
						conflicts = append(conflicts, ConflictInfo{
							Type:    "unresolved_shot_revision",
							Message: fmt.Sprintf("镜头 %s 关联的修订版本 %s 不存在或不是 shot_revision", objID, shot.CurrentRevision),
						})
					}
					for _, outID := range shot.SelectedOutputIDs {
						mRec, exists := headRecordsByObjID[outID]
						if !exists || mRec.Type != RecordTypeMedia {
							conflicts = append(conflicts, ConflictInfo{
								Type:    "unresolved_shot_output",
								Message: fmt.Sprintf("镜头 %s 选用的输出媒体 %s 不存在或不是 media", objID, outID),
							})
						}
					}
				}
			case RecordTypeEpisode:
				var ep EpisodeData
				if err := decodeStrictJSONBytes(rec.Data, &ep); err == nil {
					for _, shotID := range ep.CurrentShotIDs {
						sRec, exists := headRecordsByObjID[shotID]
						if !exists || sRec.Type != RecordTypeShot {
							conflicts = append(conflicts, ConflictInfo{
								Type:    "unresolved_episode_shot",
								Message: fmt.Sprintf("剧集 %s 关联的镜头 %s 不存在或不是 shot", objID, shotID),
							})
						}
					}
				}
			case RecordTypeGeneration:
				var gen GenerationData
				if err := decodeStrictJSONBytes(rec.Data, &gen); err == nil {
					for _, outID := range gen.OutputFileIDs {
						mRec, exists := headRecordsByObjID[outID]
						if !exists || mRec.Type != RecordTypeMedia {
							conflicts = append(conflicts, ConflictInfo{
								Type:    "unresolved_generation_output",
								Message: fmt.Sprintf("生成任务 %s 输出媒体 %s 不存在或不是 media", objID, outID),
							})
						}
					}
				}
			case RecordTypeArchive:
				var arch ArchiveData
				if err := decodeStrictJSONBytes(rec.Data, &arch); err == nil {
					for _, entityID := range arch.EntityRefs {
						if _, exists := headRecordsByObjID[entityID]; !exists {
							if _, existsInReachable := reachableRecords[entityID]; !existsInReachable {
								conflicts = append(conflicts, ConflictInfo{
									Type:    "unresolved_archive_reference",
									Message: fmt.Sprintf("归档记录 %s 引用的实体 %s 在包内未被引用或不存在", objID, entityID),
								})
							}
						}
					}
				}
			}
		}
	}

	canCommit := len(conflicts) == 0 && len(missingFiles) == 0

	return &WorkPackagePreviewResult{
		WorkID:        work.ID,
		Title:         work.Title,
		Revision:      work.Revision,
		CommitCount:   commitCount,
		RecordCount:   recordCount,
		MediaCount:    mediaCount,
		TotalBytes:    size,
		Conflicts:     conflicts,
		MissingFiles:  missingFiles,
		CanCommit:     canCommit,
		PackageDigest: packageDigest,
	}, nil
}

// PackageReceipt 记录作品包导入的操作回执
type PackageReceipt struct {
	OperationID   string `json:"operationId"`
	PackageDigest string `json:"packageDigest"`
	WorkID        string `json:"workId"`
	ImportedAt    string `json:"importedAt"`
}

// ImportWorkZip 将核验通过的作品 ZIP 包原子导入至本地作品仓库。
// 规则：
// 1. 先调用 PreviewWorkZip 严格校验；
// 2. 检查作品 ID 重复与幂等重试：同一 operationId 且同一 packageDigest 幂等恢复已导入作品，同 operationId 异包冲突报错，新导入遇已有作品拒绝覆盖；
// 3. 校验 operationID 安全性，杜绝路径穿越；在隔离暂存目录 staging/import_{operationId} 中解压并重核验，绝不删除已存在的暂存路径；
// 4. 原子无覆盖发布至 workspaces/{workId}，保留暂存与发布语义，不设人为大小上限；
// 5. 显式触发单作品索引重建并返回权威 Work。
func (s *Store) ImportWorkZip(operationID string, r io.ReaderAt, size int64) (*Work, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	if strings.TrimSpace(operationID) == "" {
		return nil, fmt.Errorf("%w: operationId 不能为空", ErrInvalidRequest)
	}
	if err := validateSafeFilename(operationID); err != nil {
		return nil, fmt.Errorf("%w: operationId 包含非法字符或流指示符: %v", ErrInvalidRequest, err)
	}

	preview, err := s.PreviewWorkZip(r, size)
	if err != nil {
		return nil, err
	}

	workID := preview.WorkID
	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}
	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	workDir, err := s.locator.WorkDir(workID)
	if err != nil {
		return nil, err
	}

	// 优先检查是否已有该作品：同 operationId 且同 packageDigest 幂等恢复前次结果；异包冲突拒绝覆盖
	if _, statErr := os.Lstat(workDir); statErr == nil {
		receiptPath := filepath.Join(workDir, "package_receipt.json")
		if receiptBytes, readErr := os.ReadFile(receiptPath); readErr == nil {
			var receipt PackageReceipt
			if decodeStrictJSONBytes(receiptBytes, &receipt) == nil && receipt.WorkID == workID && receipt.OperationID == operationID {
				if receipt.PackageDigest == preview.PackageDigest {
					// 相同 operationId 且相同包摘要：幂等返回已导入作品结果，不被 PreviewWorkZip 的 work_already_exists 冲突误拒绝
					return s.getWork(workID)
				}
				return nil, fmt.Errorf("%w: operationId %s 已被使用但导入包内容摘要不匹配 (历史: %s, 当前: %s)", ErrConflict, operationID, receipt.PackageDigest, preview.PackageDigest)
			}
		}
		return nil, fmt.Errorf("%w: 作品 %s 已存在于本地仓库中，拒绝重复导入覆盖", ErrConflict, workID)
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return nil, fmt.Errorf("检查作品导入目标失败: %w", statErr)
	}

	// 目标作品不存在时，作品包本身绝不能存在未解决的冲突或缺件
	if !preview.CanCommit {
		return nil, fmt.Errorf("%w: 作品包存在未解决冲突或缺件，禁止导入", ErrConflict)
	}

	// 在根 staging 目录下创建独立暂存目录；严禁删除已存在的未知暂存路径
	stagingParent := filepath.Join(s.locator.Root(), "staging")
	if err := os.MkdirAll(stagingParent, 0700); err != nil {
		return nil, fmt.Errorf("创建暂存根目录失败: %w", err)
	}
	tempImportDir := filepath.Join(stagingParent, fmt.Sprintf("import_%s", operationID))

	if _, statErr := os.Lstat(tempImportDir); statErr == nil {
		return nil, fmt.Errorf("%w: 导入暂存路径已存在，拒绝操作预存目录: %s", ErrConflict, tempImportDir)
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return nil, fmt.Errorf("核验导入暂存路径失败: %w", statErr)
	}

	if err := os.MkdirAll(tempImportDir, 0700); err != nil {
		return nil, fmt.Errorf("创建导入暂存目录失败: %w", err)
	}
	defer func() {
		_ = os.RemoveAll(tempImportDir)
	}()

	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, fmt.Errorf("解压作品包失败: %w", err)
	}

	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}

		targetPath := filepath.Join(tempImportDir, filepath.FromSlash(f.Name))
		targetDir := filepath.Dir(targetPath)
		if err := os.MkdirAll(targetDir, 0700); err != nil {
			return nil, fmt.Errorf("创建暂存子目录失败: %w", err)
		}

		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("打开 ZIP 文件条目 %s 失败: %w", f.Name, err)
		}

		outFile, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			_ = rc.Close()
			return nil, fmt.Errorf("创建暂存文件 %s 失败: %w", targetPath, err)
		}

		if _, err := io.Copy(outFile, rc); err != nil {
			_ = outFile.Close()
			_ = rc.Close()
			return nil, fmt.Errorf("写入暂存文件 %s 失败: %w", targetPath, err)
		}

		if err := outFile.Close(); err != nil {
			_ = rc.Close()
			return nil, fmt.Errorf("关闭暂存文件 %s 失败: %w", targetPath, err)
		}
		if err := rc.Close(); err != nil {
			return nil, fmt.Errorf("关闭 ZIP 条目 %s 失败: %w", f.Name, err)
		}
	}

	// 写入导入操作幂等回执，支持后续同 operationId + packageDigest 安全重试
	receipt := PackageReceipt{
		OperationID:   operationID,
		PackageDigest: preview.PackageDigest,
		WorkID:        workID,
		ImportedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}
	receiptBytes, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("序列化导入操作回执失败: %w", err)
	}
	if err := os.WriteFile(filepath.Join(tempImportDir, "package_receipt.json"), receiptBytes, 0600); err != nil {
		return nil, fmt.Errorf("写入导入操作回执失败: %w", err)
	}

	// 备份目录使用 no-replace 原子发布；已有同 ID 备份只有内容完全相同才复用。
	if err := s.publishPackageBackups(filepath.Join(tempImportDir, "backups")); err != nil {
		return nil, err
	}

	// 确保 inbox 目录在导入后也存在
	inboxPath := filepath.Join(tempImportDir, "inbox")
	if err := os.MkdirAll(inboxPath, 0700); err != nil {
		return nil, fmt.Errorf("创建 inbox 目录失败: %w", err)
	}

	// 核验暂存目录无重解析点
	if err := checkNoReparsePoint(tempImportDir); err != nil {
		return nil, err
	}

	// 将暂存目录原子重命名至最终作品目录
	if err := moveFileNoReplace(tempImportDir, workDir); err != nil {
		return nil, fmt.Errorf("发布导入作品失败: %w", err)
	}

	// 重建该作品的 SQLite 索引
	if s.indexer != nil {
		if payload, collectErr := s.collectWorkRebuildPayload(workID); collectErr == nil {
			_ = s.indexer.rebuildWorkLocked(payload)
		}
	}

	return s.getWork(workID)
}

// decodeStrictJSONReader 使用禁止未知字段的严格 JSON 解码器读取 reader 数据
func decodeStrictJSONReader(r io.Reader, v any) error {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%w: JSON 尾部包含多余数据", ErrInvalidRequest)
	}
	return nil
}
