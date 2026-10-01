package workspace

import (
	"crypto/sha256"
	"encoding/json"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

const backupManifestFilename = "manifest.json"

func vacuumInto(source, target string) error {
	db, err := gorm.Open(sqlite.Open(source), &gorm.Config{})
	if err != nil {
		return err
	}
	defer closeDatabase(db)
	return db.Exec("VACUUM INTO ?", target).Error
}

func (a *App) CreateBackup(destination string) (BackupManifest, error) {
	a.writeLock.Lock()
	defer a.writeLock.Unlock()
	target, err := absolutePath(destination)
	if err != nil {
		return BackupManifest{}, err
	}
	backupRoot := filepath.Join(a.root, "backups")
	if target == backupRoot || !pathContains(backupRoot, target) {
		return BackupManifest{}, errors.New("备份目标必须是工作区 backups 目录中的新子目录")
	}
	if err := verifyRecordFileReferences(a.db, a.workspaceID); err != nil {
		return BackupManifest{}, fmt.Errorf("工作区记录引用校验失败，备份未创建：%w", err)
	}
	if err := os.Mkdir(target, 0700); err != nil {
		return BackupManifest{}, fmt.Errorf("创建备份目录失败：%w", err)
	}
	for _, recoveryDir := range []string{"files", "staging"} {
		if err := ensureNoUntrackedFiles(filepath.Join(a.root, recoveryDir), a.db, a.workspaceID, recoveryDir); err != nil {
			return BackupManifest{}, err
		}
	}
	databasePath := filepath.Join(target, databaseFilename)
	if err := a.db.Exec("VACUUM INTO ?", databasePath).Error; err != nil {
		return BackupManifest{}, fmt.Errorf("SQLite 一致快照失败：%w", err)
	}
	var entries []WorkspaceFile
	if err := a.db.Where("workspace_id = ? AND state = ?", a.workspaceID, "ready").Order("id ASC").Find(&entries).Error; err != nil {
		return BackupManifest{}, err
	}
	manifest := BackupManifest{
		SchemaVersion: SchemaVersion, WorkspaceID: a.workspaceID, Product: ProductID,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Files: make([]BackupFile, 0, len(entries)),
	}
	for _, entry := range entries {
		sourcePath, err := safeWorkspacePath(a.root, entry.RelativePath)
		if err != nil {
			return BackupManifest{}, err
		}
		fileHash, bytes, err := hashFile(sourcePath)
		if err != nil {
			return BackupManifest{}, fmt.Errorf("原件 %s 缺失或无法读取", entry.ID)
		}
		if fileHash != entry.SHA256 || bytes != entry.Bytes {
			return BackupManifest{}, fmt.Errorf("原件 %s 的大小或 SHA-256 不匹配", entry.ID)
		}
		destinationPath, err := safeWorkspacePathForNewFile(target, entry.RelativePath)
		if err != nil {
			return BackupManifest{}, err
		}
		if err := copyFile(sourcePath, destinationPath); err != nil {
			return BackupManifest{}, err
		}
		manifest.Files = append(manifest.Files, BackupFile{FileID: entry.ID, Path: entry.RelativePath, SHA256: entry.SHA256, Bytes: entry.Bytes})
	}
	manifest.DatabaseSHA256, _, err = hashFile(databasePath)
	if err != nil {
		return BackupManifest{}, err
	}
	if err := writeBackupManifest(filepath.Join(target, backupManifestFilename), manifest); err != nil {
		return BackupManifest{}, err
	}
	return manifest, nil
}

func VerifyBackup(backupRoot string) (BackupVerification, error) {
	root, err := absolutePath(backupRoot)
	if err != nil {
		return BackupVerification{}, err
	}
	manifest, err := readBackupManifest(filepath.Join(root, backupManifestFilename))
	if err != nil {
		return BackupVerification{}, err
	}
	databasePath := filepath.Join(root, databaseFilename)
	databaseHash, _, err := hashFile(databasePath)
	if err != nil || databaseHash != manifest.DatabaseSHA256 {
		return BackupVerification{}, errors.New("备份数据库 SHA-256 不匹配")
	}
	db, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		return BackupVerification{}, err
	}
	defer closeDatabase(db)
	if err := validateDatabase(db, Manifest{SchemaVersion: manifest.SchemaVersion, WorkspaceID: manifest.WorkspaceID, Product: manifest.Product}); err != nil {
		return BackupVerification{}, err
	}
	if err := verifyRecordFileReferences(db, manifest.WorkspaceID); err != nil {
		return BackupVerification{}, fmt.Errorf("备份记录引用校验失败：%w", err)
	}
	var integrity string
	if err := db.Raw("PRAGMA integrity_check").Scan(&integrity).Error; err != nil || integrity != "ok" {
		return BackupVerification{}, errors.New("备份数据库完整性检查失败")
	}
	var entries []WorkspaceFile
	if err := db.Where("workspace_id = ? AND state = ?", manifest.WorkspaceID, "ready").Order("id ASC").Find(&entries).Error; err != nil {
		return BackupVerification{}, err
	}
	if len(entries) != len(manifest.Files) {
		return BackupVerification{}, errors.New("备份清单与数据库文件记录数量不一致")
	}
	seen := make(map[string]struct{}, len(manifest.Files))
	for index, entry := range entries {
		file := manifest.Files[index]
		if file.FileID != entry.ID || file.Path != entry.RelativePath || file.SHA256 != entry.SHA256 || file.Bytes != entry.Bytes {
			return BackupVerification{}, fmt.Errorf("备份清单与数据库文件记录不一致：%s", entry.ID)
		}
		if _, duplicate := seen[file.FileID]; duplicate {
			return BackupVerification{}, errors.New("备份清单含重复 fileId")
		}
		seen[file.FileID] = struct{}{}
		filePath, err := safeWorkspacePath(root, file.Path)
		if err != nil {
			return BackupVerification{}, err
		}
		fileHash, bytes, err := hashFile(filePath)
		if err != nil || fileHash != file.SHA256 || bytes != file.Bytes {
			return BackupVerification{}, fmt.Errorf("备份原件缺失或校验失败：%s", file.FileID)
		}
	}
	return BackupVerification{WorkspaceID: manifest.WorkspaceID, Files: len(entries), Valid: true}, nil
}

func verifyRecordFileReferences(db *gorm.DB, workspaceID string) error {
	app := &App{db: db, workspaceID: workspaceID}
	var canvases []legacyCanvasProject
	if err := db.Where("user_id = ?", workspaceID).Find(&canvases).Error; err != nil {
		return err
	}
	for _, row := range canvases {
		if err := app.validateFileReferences([]byte(row.ProjectData)); err != nil {
			return fmt.Errorf("画布 %s：%w", row.ID, err)
		}
	}
	var assets []legacyWorkspaceAsset
	if err := db.Where("workspace_id = ?", workspaceID).Find(&assets).Error; err != nil {
		return err
	}
	for _, row := range assets {
		if err := app.validateFileReferences([]byte(row.AssetData)); err != nil {
			return fmt.Errorf("素材 %s：%w", row.ID, err)
		}
	}
	return nil
}

func RestoreBackup(backupRoot, targetRoot string) error {
	verification, err := VerifyBackup(backupRoot)
	if err != nil {
		return err
	}
	if !verification.Valid {
		return errors.New("备份未通过校验")
	}
	source, err := absolutePath(backupRoot)
	if err != nil {
		return err
	}
	target, err := absolutePath(targetRoot)
	if err != nil {
		return err
	}
	if source == target || pathContains(source, target) {
		return errors.New("恢复目标不能位于备份目录内")
	}
	if _, err := os.Lstat(target); err == nil {
		return errors.New("恢复目标已存在；恢复不会覆盖任何目录")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	manifest, err := readBackupManifest(filepath.Join(source, backupManifestFilename))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(target, 0700); err != nil {
		return err
	}
	if err := createWorkspaceDirs(target); err != nil {
		return err
	}
	if err := copyFile(filepath.Join(source, databaseFilename), filepath.Join(target, databaseFilename)); err != nil {
		return err
	}
	for _, entry := range manifest.Files {
		from, err := safeWorkspacePath(source, entry.Path)
		if err != nil {
			return err
		}
		to, err := safeWorkspacePathForNewFile(target, entry.Path)
		if err != nil {
			return err
		}
		if err := copyFile(from, to); err != nil {
			return err
		}
	}
	return writeManifest(filepath.Join(target, "workspace.json"), Manifest{
		SchemaVersion: manifest.SchemaVersion, WorkspaceID: manifest.WorkspaceID, Product: manifest.Product,
	})
}

func readBackupManifest(path string) (BackupManifest, error) {
	file, err := os.Open(path)
	if err != nil {
		return BackupManifest{}, err
	}
	defer file.Close()
	var manifest BackupManifest
	if err := decodeJSON(file, &manifest); err != nil {
		return BackupManifest{}, errors.New("备份清单损坏或格式未知")
	}
	if manifest.SchemaVersion != SchemaVersion || manifest.WorkspaceID == "" || manifest.Product != ProductID {
		return BackupManifest{}, errors.New("备份清单版本、产品或身份不受支持")
	}
	return manifest, nil
}

func writeBackupManifest(path string, manifest BackupManifest) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	encoderErr := json.NewEncoder(file).Encode(manifest)
	syncErr := file.Sync()
	closeErr := file.Close()
	for _, currentErr := range []error{encoderErr, syncErr, closeErr} {
		if currentErr != nil {
			return currentErr
		}
	}
	return nil
}

func ensureNoUntrackedFiles(directory string, db *gorm.DB, workspaceID, managedRoot string) error {
	if managedRoot == "staging" {
		entries, err := os.ReadDir(directory)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if len(entries) != 0 {
			return errors.New("staging 中保留有待恢复文件；备份拒绝遗漏这些文件")
		}
		return nil
	}
	var files []WorkspaceFile
	if err := db.Where("workspace_id = ? AND state = ?", workspaceID, "ready").Find(&files).Error; err != nil {
		return err
	}
	known := make(map[string]struct{}, len(files))
	for _, file := range files {
		known[filepath.Clean(filepath.FromSlash(file.RelativePath))] = struct{}{}
	}
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if errors.Is(walkErr, os.ErrNotExist) {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("files 中存在符号链接；备份拒绝沿链接读取")
		}
		relative, err := filepath.Rel(filepath.Dir(directory), path)
		if err != nil {
			return err
		}
		if _, ok := known[filepath.Clean(relative)]; !ok {
			return fmt.Errorf("files 中存在未登记原件，备份拒绝遗漏：%s", relative)
		}
		return nil
	})
	return err
}

func safeWorkspacePathForNewFile(root, relative string) (string, error) {
	if filepath.IsAbs(relative) || strings.Contains(relative, "\\") {
		return "", errors.New("工作区文件路径无效")
	}
	clean := filepath.Clean(filepath.FromSlash(relative))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("工作区文件路径越界")
	}
	if !strings.HasPrefix(clean, "files"+string(filepath.Separator)) {
		return "", errors.New("备份原件路径必须位于 files 目录")
	}
	full := filepath.Join(root, clean)
	if !pathContains(root, full) {
		return "", errors.New("工作区文件路径越界")
	}
	if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
		return "", err
	}
	return full, nil
}

func hashFile(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hasher := sha256.New()
	bytes, err := io.Copy(hasher, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hasher.Sum(nil)), bytes, nil
}

func copyFile(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	syncErr := output.Sync()
	closeErr := output.Close()
	for _, currentErr := range []error{copyErr, syncErr, closeErr} {
		if currentErr != nil {
			return currentErr
		}
	}
	return nil
}

