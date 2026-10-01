package repository

import (
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
)

// SaveStorageObject 保存存储对象记录。
func SaveStorageObject(object model.StorageObject) (model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, err
	}
	return object, db.Save(&object).Error
}

// GetStorageObject 根据 ID 获取存储对象。
func GetStorageObject(id string) (model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, err
	}
	var object model.StorageObject
	err = db.First(&object, "id = ?", id).Error
	return object, err
}

// FindStorageObjectBySHA256 查找本地工作区中内容相同的对象，避免两个页面重复写入媒体。
func FindStorageObjectBySHA256(createdBy string, sha256 string) (model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, err
	}
	var object model.StorageObject
	err = db.Where(
		"created_by = ? AND sha256 = ? AND deleted_at = ''",
		strings.TrimSpace(createdBy),
		strings.TrimSpace(sha256),
	).Order("created_at ASC").First(&object).Error
	return object, err
}

// DeleteStorageObjectRecord 删除存储对象记录（软删除）。
func DeleteStorageObjectRecord(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.StorageObject{}, "id = ?", id).Error
}
