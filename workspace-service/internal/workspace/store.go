package workspace

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

const databaseFilename = "workspace.sqlite"

var ErrManifestMissing = errors.New("workspace manifest missing")

type App struct {
	root              string
	databasePath      string
	workspaceID       string
	serviceInstanceID string
	accessToken       string
	db                *gorm.DB
	writeLock         sync.RWMutex
}

type legacyCanvasProject struct {
	UserID      string `gorm:"column:user_id;primaryKey"`
	ID          string `gorm:"column:id;primaryKey"`
	ProjectData string `gorm:"column:project_data;type:text"`
	CreatedAt   string `gorm:"column:created_at"`
	UpdatedAt   string `gorm:"column:updated_at"`
	DeletedAt   string `gorm:"column:deleted_at"`
}

func (legacyCanvasProject) TableName() string { return "canvas_projects" }

type legacyWorkspaceAsset struct {
	WorkspaceID string `gorm:"column:workspace_id;primaryKey"`
	ID          string `gorm:"column:id;primaryKey"`
	AssetData   string `gorm:"column:asset_data;type:text"`
	CreatedAt   string `gorm:"column:created_at"`
	UpdatedAt   string `gorm:"column:updated_at"`
	DeletedAt   string `gorm:"column:deleted_at"`
}

func (legacyWorkspaceAsset) TableName() string { return "local_workspace_assets" }

func Open(dataRoot string) (*App, error) {
	token := os.Getenv("LOCAL_WORKSPACE_ACCESS_TOKEN")
	if token == "" {
		return nil, errors.New("缺少本地工作区服务访问凭证")
	}
	app, err := OpenForMaintenance(dataRoot)
	if err != nil {
		return nil, err
	}
	app.accessToken = token
	return app, nil
}

func OpenForMaintenance(dataRoot string) (*App, error) {
	root, err := absolutePath(dataRoot)
	if err != nil {
		return nil, err
	}
	rootInfo, err := os.Lstat(root)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("工作区根目录不存在、不是普通目录或包含符号链接")
	}
	manifest, err := readManifest(filepath.Join(root, "workspace.json"))
	if err != nil {
		return nil, err
	}
	databasePath := filepath.Join(root, databaseFilename)
	if info, err := os.Lstat(databasePath); err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("工作区数据库不存在或不是普通文件；请先从隔离副本准备工作区")
	}
	db, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("打开工作区数据库失败：%w", err)
	}
	if err := validateDatabase(db, manifest); err != nil {
		if sqlDB, closeErr := db.DB(); closeErr == nil {
			_ = sqlDB.Close()
		}
		return nil, err
	}
	instanceID, err := randomID()
	if err != nil {
		return nil, err
	}
	return &App{
		root: root, databasePath: databasePath, workspaceID: manifest.WorkspaceID,
		serviceInstanceID: instanceID, db: db,
	}, nil
}

func (a *App) Close() error {
	sqlDB, err := a.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func absolutePath(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", errors.New("工作区路径必须是绝对路径")
	}
	return filepath.Clean(path), nil
}

func readManifest(path string) (Manifest, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Manifest{}, fmt.Errorf("%w：服务不会自动登记或初始化现有数据", ErrManifestMissing)
		}
		return Manifest{}, fmt.Errorf("读取工作区清单失败：%w", err)
	}
	defer file.Close()
	var manifest Manifest
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, fmt.Errorf("工作区清单损坏或格式未知：%w", err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return Manifest{}, fmt.Errorf("工作区清单损坏：%w", err)
	}
	if manifest.SchemaVersion != SchemaVersion || manifest.Product != ProductID || strings.TrimSpace(manifest.WorkspaceID) == "" {
		return Manifest{}, errors.New("工作区清单版本、产品或身份不受支持")
	}
	return manifest, nil
}

func validateDatabase(db *gorm.DB, manifest Manifest) error {
	for _, model := range []any{
		&WorkspaceMetadata{}, &WorkspaceRevision{}, &WorkspaceOperation{}, &WorkspaceFile{},
		&legacyCanvasProject{}, &legacyWorkspaceAsset{},
	} {
		if !db.Migrator().HasTable(model) {
			return errors.New("工作区数据库缺少所需表；拒绝自动迁移")
		}
	}
	var metadata WorkspaceMetadata
	if err := db.First(&metadata, "id = ?", 1).Error; err != nil {
		return fmt.Errorf("读取数据库工作区身份失败：%w", err)
	}
	if metadata.WorkspaceID != manifest.WorkspaceID || metadata.Product != manifest.Product || metadata.SchemaVersion != manifest.SchemaVersion {
		return errors.New("workspace.json 与数据库身份或存储版本不一致")
	}
	return nil
}

func InitializeEmpty(dataRoot string) error {
	root, err := absolutePath(dataRoot)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(root); err == nil {
		return errors.New("新工作区目标已存在；初始化不会覆盖任何目录")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	if err := createWorkspaceDirs(root); err != nil {
		return err
	}
	workspaceID, err := randomID()
	if err != nil {
		return err
	}
	if err := initializeDatabase(filepath.Join(root, databaseFilename), workspaceID); err != nil {
		return err
	}
	return writeManifest(filepath.Join(root, "workspace.json"), Manifest{
		SchemaVersion: SchemaVersion, WorkspaceID: workspaceID, Product: ProductID,
	})
}

func PrepareCopy(sourceRoot, targetRoot string) error {
	source, err := absolutePath(sourceRoot)
	if err != nil {
		return err
	}
	target, err := absolutePath(targetRoot)
	if err != nil {
		return err
	}
	if source == target || pathContains(source, target) {
		return errors.New("隔离副本目标不能位于来源目录内")
	}
	if _, err := os.Lstat(target); err == nil {
		return errors.New("隔离副本目标已存在；不会覆盖已有内容")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	sourceDB := filepath.Join(source, databaseFilename)
	if info, err := os.Stat(sourceDB); err != nil || !info.Mode().IsRegular() {
		return errors.New("来源目录中没有可复制的工作区数据库")
	}
	if err := os.MkdirAll(target, 0700); err != nil {
		return err
	}
	if err := createWorkspaceDirs(target); err != nil {
		return err
	}
	db, err := gorm.Open(sqlite.Open(sourceDB), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("打开来源数据库失败：%w", err)
	}
	workspaceID, err := discoverWorkspaceID(db, source)
	if err != nil {
		closeDatabase(db)
		return err
	}
	if err := closeDatabase(db); err != nil {
		return err
	}
	targetDB := filepath.Join(target, databaseFilename)
	if err := vacuumInto(sourceDB, targetDB); err != nil {
		return fmt.Errorf("创建 SQLite 一致副本失败：%w", err)
	}
	for _, name := range []string{"files", "previews", "staging"} {
		if err := copyDirectory(filepath.Join(source, name), filepath.Join(target, name)); err != nil {
			return fmt.Errorf("复制工作区目录 %s 失败：%w", name, err)
		}
	}
	if err := initializeCopiedDatabase(targetDB, workspaceID); err != nil {
		return err
	}
	return writeManifest(filepath.Join(target, "workspace.json"), Manifest{
		SchemaVersion: SchemaVersion, WorkspaceID: workspaceID, Product: ProductID,
	})
}

func discoverWorkspaceID(db *gorm.DB, sourceRoot string) (string, error) {
	manifest, manifestErr := readManifest(filepath.Join(sourceRoot, "workspace.json"))
	if manifestErr != nil && !errors.Is(manifestErr, ErrManifestMissing) {
		return "", manifestErr
	}
	ids := map[string]struct{}{}
	if db.Migrator().HasTable(&legacyCanvasProject{}) {
		var values []string
		if err := db.Model(&legacyCanvasProject{}).Distinct("user_id").Pluck("user_id", &values).Error; err != nil {
			return "", err
		}
		for _, value := range values {
			if value = strings.TrimSpace(value); value != "" {
				ids[value] = struct{}{}
			}
		}
	}
	if db.Migrator().HasTable(&legacyWorkspaceAsset{}) {
		var values []string
		if err := db.Model(&legacyWorkspaceAsset{}).Distinct("workspace_id").Pluck("workspace_id", &values).Error; err != nil {
			return "", err
		}
		for _, value := range values {
			if value = strings.TrimSpace(value); value != "" {
				ids[value] = struct{}{}
			}
		}
	}
	if len(ids) > 1 {
		return "", errors.New("来源数据库包含多个工作区身份，拒绝合并")
	}
	if len(ids) == 1 {
		for id := range ids {
			if manifestErr == nil && manifest.WorkspaceID != id {
				return "", errors.New("来源目录清单与数据库工作区身份不一致")
			}
			return id, nil
		}
	}
	if manifestErr == nil {
		return manifest.WorkspaceID, nil
	}
	return randomID()
}

func initializeDatabase(path, workspaceID string) error {
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		return err
	}
	defer closeDatabase(db)
	return initializeSchema(db, workspaceID)
}

func initializeCopiedDatabase(path, workspaceID string) error {
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		return err
	}
	defer closeDatabase(db)
	var existing WorkspaceMetadata
	if err := db.First(&existing, "id = ?", 1).Error; err == nil {
		if existing.WorkspaceID != workspaceID || existing.Product != ProductID || existing.SchemaVersion != SchemaVersion {
			return errors.New("隔离副本中的既有工作区身份与来源记录不一致")
		}
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) && db.Migrator().HasTable(&WorkspaceMetadata{}) {
		return err
	}
	return initializeSchema(db, workspaceID)
}

func initializeSchema(db *gorm.DB, workspaceID string) error {
	if err := db.AutoMigrate(
		&legacyCanvasProject{}, &legacyWorkspaceAsset{}, &WorkspaceMetadata{},
		&WorkspaceRevision{}, &WorkspaceOperation{}, &WorkspaceFile{},
	); err != nil {
		return fmt.Errorf("初始化隔离工作区结构失败：%w", err)
	}
	metadata := WorkspaceMetadata{ID: 1, WorkspaceID: workspaceID, Product: ProductID, SchemaVersion: SchemaVersion}
	if err := db.Create(&metadata).Error; err != nil {
		return fmt.Errorf("登记隔离工作区身份失败：%w", err)
	}
	return nil
}

func createWorkspaceDirs(root string) error {
	for _, name := range []string{"files", "previews", "staging", "backups"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0700); err != nil {
			return err
		}
	}
	return nil
}

func writeManifest(path string, manifest Manifest) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encodeErr := encoder.Encode(manifest)
	syncErr := file.Sync()
	closeErr := file.Close()
	if encodeErr != nil {
		return encodeErr
	}
	if syncErr != nil {
		return syncErr
	}
	return closeErr
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("JSON 后有额外内容")
		}
		return err
	}
	return nil
}

func closeDatabase(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func randomID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	encoded := hex.EncodeToString(value[:])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:], nil
}

func pathContains(parent, child string) bool {
	relative, err := filepath.Rel(parent, child)
	if err != nil {
		return true
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}

func copyDirectory(source, target string) error {
	if _, err := os.Lstat(source); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("工作区目录含符号链接：%s", path)
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0700)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("工作区目录含不支持的文件：%s", path)
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return err
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			_ = input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		syncErr := output.Sync()
		outputErr := output.Close()
		inputErr := input.Close()
		for _, currentErr := range []error{copyErr, syncErr, outputErr, inputErr} {
			if currentErr != nil {
				return currentErr
			}
		}
		return nil
	})
}
