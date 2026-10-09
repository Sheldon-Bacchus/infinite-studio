package works

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// IndexedWork 索引表：作品权威元数据快照
type IndexedWork struct {
	WorkID          string `gorm:"column:work_id;primaryKey;size:32"`
	Title           string `gorm:"column:title;type:text"`
	CurrentCommitID string `gorm:"column:current_commit_id;size:32;index"`
	Revision        int64  `gorm:"column:revision;index"`
	CreatedAt       string `gorm:"column:created_at"`
	UpdatedAt       string `gorm:"column:updated_at"`
	IndexedAt       string `gorm:"column:indexed_at"`
}

func (IndexedWork) TableName() string { return "indexed_works" }

// IndexedCommit 索引表：提交快照记录
type IndexedCommit struct {
	WorkID           string `gorm:"column:work_id;primaryKey;size:32"`
	CommitID         string `gorm:"column:commit_id;primaryKey;size:32"`
	Revision         int64  `gorm:"column:revision;index"`
	BaseRevision     int64  `gorm:"column:base_revision"`
	OperationID      string `gorm:"column:operation_id;index"`
	RequestDigest    string `gorm:"column:request_digest;size:64"`
	PreviousCommitID string `gorm:"column:previous_commit_id;size:32"`
	Committed        bool   `gorm:"column:committed"`
	CreatedAt        string `gorm:"column:created_at"`
	IndexedAt        string `gorm:"column:indexed_at"`
}

func (IndexedCommit) TableName() string { return "indexed_commits" }

// IndexedRecord 索引表：当前已提交实体记录索引
type IndexedRecord struct {
	WorkID     string `gorm:"column:work_id;primaryKey;size:32"`
	RecordID   string `gorm:"column:record_id;primaryKey;size:128"`
	RevisionID string `gorm:"column:revision_id;size:64;index"`
	RecordType string `gorm:"column:record_type;size:32;index"`
	Data       string `gorm:"column:data;type:text"`
	IndexedAt  string `gorm:"column:indexed_at"`
}

func (IndexedRecord) TableName() string { return "indexed_records" }

// IndexedMedia 索引表：作品内媒体原件索引
type IndexedMedia struct {
	WorkID           string `gorm:"column:work_id;primaryKey;size:32"`
	FileID           string `gorm:"column:file_id;primaryKey;size:32"`
	SHA256           string `gorm:"column:sha256;size:64;index"`
	Bytes            int64  `gorm:"column:bytes"`
	MIMEType         string `gorm:"column:mime_type;size:64"`
	Kind             string `gorm:"column:kind;size:16;index"`
	Extension        string `gorm:"column:extension;size:16"`
	OriginalFilename string `gorm:"column:original_filename;type:text"`
	IndexedAt        string `gorm:"column:indexed_at"`
}

func (IndexedMedia) TableName() string { return "indexed_media" }

// IndexMeta 索引元数据标记表
type IndexMeta struct {
	Key       string `gorm:"column:key;primaryKey;size:64"`
	Value     string `gorm:"column:value;type:text"`
	UpdatedAt string `gorm:"column:updated_at"`
}

func (IndexMeta) TableName() string { return "index_meta" }

// Indexer 管理基于 SQLite 的可重建辅助索引。
// 核心架构原则：
// 1. 作品目录与不可变版本记录是唯一权威；SQLite 仅作为高效检索与关联查询的辅助投影。
// 2. 索引完全可由权威文件目录全量重建。
// 3. 权威提交切换成功后，即使索引写入失败，也绝不可误报未提交。
type Indexer struct {
	db      *gorm.DB
	dbPath  string
	locator *PathLocator
	mu      sync.Mutex
}

// checkSQLiteSidecarsNoReparsePoint 核验 SQLite 辅助文件（journal/wal/shm）是否存在重解析点或目录假冒
func checkSQLiteSidecarsNoReparsePoint(dbPath string) error {
	sidecars := []string{
		dbPath + "-journal",
		dbPath + "-wal",
		dbPath + "-shm",
	}
	for _, sc := range sidecars {
		if fi, err := os.Lstat(sc); err == nil {
			if err := checkNoReparsePoint(sc); err != nil {
				return fmt.Errorf("核验 SQLite 辅助文件 %s 重解析点失败: %w", sc, err)
			}
			if fi.IsDir() {
				return fmt.Errorf("%w: SQLite 辅助路径 %s 是目录而非普通文件", ErrCorruptData, sc)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("核验 SQLite 辅助文件状态失败 (%s): %w", sc, err)
		}
	}
	return nil
}

// NewIndexer 初始化或打开存储根目录下的 index.sqlite 索引数据库
func NewIndexer(locator *PathLocator) (*Indexer, error) {
	if locator == nil {
		return nil, errors.New("locator 不能为空")
	}

	dbPath, err := locator.IndexDBPath()
	if err != nil {
		return nil, err
	}

	// 打开/创建前预先审计重解析点与 SQLite 辅助文件
	if err := checkNoReparsePoint(dbPath); err != nil {
		return nil, err
	}
	if err := checkSQLiteSidecarsNoReparsePoint(dbPath); err != nil {
		return nil, err
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Discard,
	})
	if err != nil {
		return nil, fmt.Errorf("打开索引数据库失败 (%s): %w", dbPath, err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("获取底层 SQL 句柄失败: %w", err)
	}

	// 打开后再次审计最终文件与辅助文件非重解析点
	if err := checkNoReparsePoint(dbPath); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	if err := checkSQLiteSidecarsNoReparsePoint(dbPath); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}

	// 自动迁移索引表结构
	if err := db.AutoMigrate(
		&IndexedWork{},
		&IndexedCommit{},
		&IndexedRecord{},
		&IndexedMedia{},
		&IndexMeta{},
	); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("迁移索引表结构失败: %w", err)
	}

	return &Indexer{
		db:      db,
		dbPath:  dbPath,
		locator: locator,
	}, nil
}

// Close 安全关闭索引数据库连接
func (idx *Indexer) Close() error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	if idx.db == nil {
		return nil
	}
	sqlDB, err := idx.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// validateAndBuildIndexedMedia 严格解码与核验媒体记录描述符，包括身份、bytes > 0、MIME/kind/ext 强一致性
func validateAndBuildIndexedMedia(workID string, rec *Record, now string) (*IndexedMedia, error) {
	var desc MediaDescriptor
	if err := decodeStrictJSONBytes(rec.Data, &desc); err != nil {
		return nil, fmt.Errorf("%w: 解析媒体描述符失败 (%s): %v", ErrCorruptData, rec.ID, err)
	}
	if desc.FileID == "" || desc.FileID != rec.ID || desc.WorkID != workID {
		return nil, fmt.Errorf("%w: 媒体描述符身份校验失败 (%s)", ErrCorruptData, rec.ID)
	}
	if err := ValidateStorageID(desc.FileID); err != nil {
		return nil, fmt.Errorf("%w: 媒体 fileId 非法 (%s): %v", ErrCorruptData, rec.ID, err)
	}
	if err := ValidateHashID(desc.SHA256); err != nil {
		return nil, fmt.Errorf("%w: 媒体 sha256 非法 (%s): %v", ErrCorruptData, rec.ID, err)
	}
	if desc.Bytes <= 0 {
		return nil, fmt.Errorf("%w: 媒体字节数必须大于 0 (%s: %d)", ErrCorruptData, rec.ID, desc.Bytes)
	}
	safeExt, kind, err := NormalizeMediaExtension(desc.MIMEType)
	if err != nil {
		return nil, fmt.Errorf("%w: 媒体 MIME 类型非法 (%s): %v", ErrCorruptData, rec.ID, err)
	}
	if desc.Extension != safeExt || desc.Kind != kind {
		return nil, fmt.Errorf("%w: 媒体描述符格式不一致 (%s: mime=%s, ext=%s vs %s, kind=%s vs %s)", ErrCorruptData, rec.ID, desc.MIMEType, desc.Extension, safeExt, desc.Kind, kind)
	}
	return &IndexedMedia{
		WorkID:           workID,
		FileID:           desc.FileID,
		SHA256:           desc.SHA256,
		Bytes:            desc.Bytes,
		MIMEType:         desc.MIMEType,
		Kind:             desc.Kind,
		Extension:        desc.Extension,
		OriginalFilename: desc.OriginalFilename,
		IndexedAt:        now,
	}, nil
}

// IndexWork 在事务内原子同步作品权威快照至 SQLite 索引
func (idx *Indexer) IndexWork(work *Work, commit *Commit, records map[string]*Record) error {
	if work == nil || commit == nil {
		return errors.New("作品元数据与提交清单不能为空")
	}

	if err := checkSQLiteSidecarsNoReparsePoint(idx.dbPath); err != nil {
		return err
	}

	idx.mu.Lock()
	defer idx.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339Nano)

	return idx.db.Transaction(func(tx *gorm.DB) error {
		// 1. 投影作品主元数据
		indexedWork := IndexedWork{
			WorkID:          work.ID,
			Title:           work.Title,
			CurrentCommitID: work.CurrentCommitID,
			Revision:        work.Revision,
			CreatedAt:       work.CreatedAt,
			UpdatedAt:       work.UpdatedAt,
			IndexedAt:       now,
		}
		if err := tx.Save(&indexedWork).Error; err != nil {
			return fmt.Errorf("保存作品索引失败: %w", err)
		}

		// 2. 投影当前提交清单
		indexedCommit := IndexedCommit{
			WorkID:           commit.WorkID,
			CommitID:         commit.ID,
			Revision:         commit.Revision,
			BaseRevision:     commit.BaseRevision,
			OperationID:      commit.OperationID,
			RequestDigest:    commit.RequestDigest,
			PreviousCommitID: commit.PreviousCommitID,
			Committed:        commit.Receipt.Committed,
			CreatedAt:        commit.CreatedAt,
			IndexedAt:        now,
		}
		if err := tx.Save(&indexedCommit).Error; err != nil {
			return fmt.Errorf("保存提交索引失败: %w", err)
		}

		// 3. 刷新该作品当前记录集合（清理旧记录索引，重新写入当前完整集合）
		if err := tx.Where("work_id = ?", work.ID).Delete(&IndexedRecord{}).Error; err != nil {
			return fmt.Errorf("清理旧记录索引失败: %w", err)
		}
		if err := tx.Where("work_id = ?", work.ID).Delete(&IndexedMedia{}).Error; err != nil {
			return fmt.Errorf("清理旧媒体索引失败: %w", err)
		}

		for _, rec := range records {
			if rec == nil {
				return fmt.Errorf("%w: 待索引记录集合中包含 nil 记录", ErrCorruptData)
			}
			ir := IndexedRecord{
				WorkID:     work.ID,
				RecordID:   rec.ID,
				RevisionID: rec.RevisionID,
				RecordType: rec.Type,
				Data:       string(rec.Data),
				IndexedAt:  now,
			}
			if err := tx.Create(&ir).Error; err != nil {
				return fmt.Errorf("创建记录索引失败 (%s): %w", rec.ID, err)
			}

			if rec.Type == RecordTypeMedia {
				im, err := validateAndBuildIndexedMedia(work.ID, rec, now)
				if err != nil {
					return err
				}
				if err := tx.Create(im).Error; err != nil {
					return fmt.Errorf("创建媒体索引失败 (%s): %w", im.FileID, err)
				}
			}
		}

		// 4. 更新元数据标记
		meta := IndexMeta{
			Key:       "work_updated_" + work.ID,
			Value:     fmt.Sprintf("rev_%d", work.Revision),
			UpdatedAt: now,
		}
		return tx.Save(&meta).Error
	})
}

// workRebuildPayload 包含单个作品重建所需的数据快照与完整历史提交
type workRebuildPayload struct {
	work           *Work
	historyCommits []*Commit
	records        map[string]*Record
}

// RebuildWork 委托 Store.RebuildWork 执行单作品索引重建，保证生命周期与锁顺序
func (idx *Indexer) RebuildWork(store *Store, workID string) error {
	if store == nil {
		return errors.New("store 实例不能为空")
	}
	return store.RebuildWork(workID)
}

// rebuildWorkLocked 在获取 idx.mu 下执行单作品的索引更新（包括 IndexedWork、该作品全部 IndexedCommit 历史、IndexedRecord 与 IndexedMedia）
func (idx *Indexer) rebuildWorkLocked(payload *workRebuildPayload) error {
	if payload == nil || payload.work == nil {
		return errors.New("作品重建负载不能为空")
	}

	if err := checkSQLiteSidecarsNoReparsePoint(idx.dbPath); err != nil {
		return err
	}

	idx.mu.Lock()
	defer idx.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	return idx.db.Transaction(func(tx *gorm.DB) error {
		// 1. 保存作品主元数据
		indexedWork := IndexedWork{
			WorkID:          payload.work.ID,
			Title:           payload.work.Title,
			CurrentCommitID: payload.work.CurrentCommitID,
			Revision:        payload.work.Revision,
			CreatedAt:       payload.work.CreatedAt,
			UpdatedAt:       payload.work.UpdatedAt,
			IndexedAt:       now,
		}
		if err := tx.Save(&indexedWork).Error; err != nil {
			return fmt.Errorf("保存作品索引失败: %w", err)
		}

		// 2. 清理并重建该作品的全部已提交历史
		if err := tx.Where("work_id = ?", payload.work.ID).Delete(&IndexedCommit{}).Error; err != nil {
			return fmt.Errorf("清理旧提交历史失败: %w", err)
		}
		for _, c := range payload.historyCommits {
			if c == nil {
				return fmt.Errorf("%w: 提交历史中包含 nil 提交", ErrCorruptData)
			}
			indexedCommit := IndexedCommit{
				WorkID:           c.WorkID,
				CommitID:         c.ID,
				Revision:         c.Revision,
				BaseRevision:     c.BaseRevision,
				OperationID:      c.OperationID,
				RequestDigest:    c.RequestDigest,
				PreviousCommitID: c.PreviousCommitID,
				Committed:        c.Receipt.Committed,
				CreatedAt:        c.CreatedAt,
				IndexedAt:        now,
			}
			if err := tx.Create(&indexedCommit).Error; err != nil {
				return fmt.Errorf("创建提交历史索引失败 (%s): %w", c.ID, err)
			}
		}

		// 3. 清理并重建该作品的当前快照记录集合与媒体索引
		if err := tx.Where("work_id = ?", payload.work.ID).Delete(&IndexedRecord{}).Error; err != nil {
			return fmt.Errorf("清理旧记录索引失败: %w", err)
		}
		if err := tx.Where("work_id = ?", payload.work.ID).Delete(&IndexedMedia{}).Error; err != nil {
			return fmt.Errorf("清理旧媒体索引失败: %w", err)
		}

		for _, rec := range payload.records {
			if rec == nil {
				return fmt.Errorf("%w: 作品 %s 的 records 中包含 nil 记录", ErrCorruptData, payload.work.ID)
			}
			ir := IndexedRecord{
				WorkID:     payload.work.ID,
				RecordID:   rec.ID,
				RevisionID: rec.RevisionID,
				RecordType: rec.Type,
				Data:       string(rec.Data),
				IndexedAt:  now,
			}
			if err := tx.Create(&ir).Error; err != nil {
				return fmt.Errorf("创建记录索引失败 (%s): %w", rec.ID, err)
			}

			if rec.Type == RecordTypeMedia {
				im, err := validateAndBuildIndexedMedia(payload.work.ID, rec, now)
				if err != nil {
					return err
				}
				if err := tx.Create(im).Error; err != nil {
					return fmt.Errorf("创建媒体索引失败 (%s): %w", im.FileID, err)
				}
			}
		}

		// 4. 更新元数据标记
		meta := IndexMeta{
			Key:       "work_updated_" + payload.work.ID,
			Value:     fmt.Sprintf("rev_%d", payload.work.Revision),
			UpdatedAt: now,
		}
		return tx.Save(&meta).Error
	})
}

// RebuildAll 委托 Store.RebuildIndex 扫描权威作品目录并全量重建 SQLite 索引，保证生命周期与锁顺序
func (idx *Indexer) RebuildAll(store *Store) error {
	if store == nil {
		return errors.New("store 实例不能为空")
	}
	return store.RebuildIndex()
}

// rebuildAllLocked 在持有 idx.mu 下执行全量事务更新（清理过期投影与过期 work_updated 标记）
func (idx *Indexer) rebuildAllLocked(payloads []workRebuildPayload) error {
	if err := checkSQLiteSidecarsNoReparsePoint(idx.dbPath); err != nil {
		return err
	}

	idx.mu.Lock()
	defer idx.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	err := idx.db.Transaction(func(tx *gorm.DB) error {
		// 清理全量过期投影（彻底清除已在磁盘删除的作品、旧提交历史、旧记录与孤立媒体）
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&IndexedWork{}).Error; err != nil {
			return fmt.Errorf("清理旧作品索引失败: %w", err)
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&IndexedCommit{}).Error; err != nil {
			return fmt.Errorf("清理旧提交索引失败: %w", err)
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&IndexedRecord{}).Error; err != nil {
			return fmt.Errorf("清理旧记录索引失败: %w", err)
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&IndexedMedia{}).Error; err != nil {
			return fmt.Errorf("清理旧媒体索引失败: %w", err)
		}

		// 清理所有已过期的 work_updated_* 标记
		if err := tx.Where("key LIKE ?", "work_updated_%").Delete(&IndexMeta{}).Error; err != nil {
			return fmt.Errorf("清理旧作品更新标记失败: %w", err)
		}

		// 重建采集到的所有作品及其历史与记录
		for _, p := range payloads {
			indexedWork := IndexedWork{
				WorkID:          p.work.ID,
				Title:           p.work.Title,
				CurrentCommitID: p.work.CurrentCommitID,
				Revision:        p.work.Revision,
				CreatedAt:       p.work.CreatedAt,
				UpdatedAt:       p.work.UpdatedAt,
				IndexedAt:       now,
			}
			if err := tx.Create(&indexedWork).Error; err != nil {
				return fmt.Errorf("创建作品索引失败 (%s): %w", p.work.ID, err)
			}

			// 重建该作品全部提交历史
			for _, c := range p.historyCommits {
				if c == nil {
					return fmt.Errorf("%w: 提交历史中包含 nil 提交", ErrCorruptData)
				}
				indexedCommit := IndexedCommit{
					WorkID:           c.WorkID,
					CommitID:         c.ID,
					Revision:         c.Revision,
					BaseRevision:     c.BaseRevision,
					OperationID:      c.OperationID,
					RequestDigest:    c.RequestDigest,
					PreviousCommitID: c.PreviousCommitID,
					Committed:        c.Receipt.Committed,
					CreatedAt:        c.CreatedAt,
					IndexedAt:        now,
				}
				if err := tx.Create(&indexedCommit).Error; err != nil {
					return fmt.Errorf("创建提交历史索引失败 (%s): %w", c.ID, err)
				}
			}

			// 重建当前快照记录集合与媒体索引
			for _, rec := range p.records {
				if rec == nil {
					return fmt.Errorf("%w: 作品 %s 的 records 中包含 nil 记录", ErrCorruptData, p.work.ID)
				}
				ir := IndexedRecord{
					WorkID:     p.work.ID,
					RecordID:   rec.ID,
					RevisionID: rec.RevisionID,
					RecordType: rec.Type,
					Data:       string(rec.Data),
					IndexedAt:  now,
				}
				if err := tx.Create(&ir).Error; err != nil {
					return fmt.Errorf("创建记录索引失败 (%s): %w", rec.ID, err)
				}

				if rec.Type == RecordTypeMedia {
					im, err := validateAndBuildIndexedMedia(p.work.ID, rec, now)
					if err != nil {
						return err
					}
					if err := tx.Create(im).Error; err != nil {
						return fmt.Errorf("创建媒体索引失败 (%s): %w", im.FileID, err)
					}
				}
			}

			meta := IndexMeta{
				Key:       "work_updated_" + p.work.ID,
				Value:     fmt.Sprintf("rev_%d", p.work.Revision),
				UpdatedAt: now,
			}
			if err := tx.Save(&meta).Error; err != nil {
				return err
			}
		}

		meta := IndexMeta{
			Key:       "last_rebuild_at",
			Value:     now,
			UpdatedAt: now,
		}
		return tx.Save(&meta).Error
	})
	if err != nil {
		return fmt.Errorf("全量重建索引事务失败: %w", err)
	}

	return nil
}

// IsWorkIndexed 核验指定作品是否已被索引至 targetRevision
func (idx *Indexer) IsWorkIndexed(workID string, targetRevision int64) (bool, error) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	var count int64
	if err := idx.db.Model(&IndexedWork{}).
		Where("work_id = ? AND revision >= ?", workID, targetRevision).
		Count(&count).Error; err != nil {
		return false, fmt.Errorf("查询作品索引状态失败: %w", err)
	}
	return count > 0, nil
}

// QueryIndexedWork 从索引中查询作品概要
func (idx *Indexer) QueryIndexedWork(workID string) (*IndexedWork, error) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	var item IndexedWork
	if err := idx.db.Where("work_id = ?", workID).First(&item).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWorkNotFound
		}
		return nil, err
	}
	return &item, nil
}
