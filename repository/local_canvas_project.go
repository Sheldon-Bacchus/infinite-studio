package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

var ErrLocalCanvasProjectDeleted = errors.New("本地画布已删除，拒绝过期写入")
var ErrLocalCanvasProjectConflict = errors.New("画布已在其他页面修改，请刷新后确认并重试")

// SaveLocalCanvasProject 保存本机工作区画布；已删除项目只能通过显式导入恢复。
func SaveLocalCanvasProject(project model.CanvasProject) (model.CanvasProject, error) {
	unlock := LockLocalWorkspaceReferences()
	defer unlock()
	project.UserID = strings.TrimSpace(project.UserID)
	project.ID = strings.TrimSpace(project.ID)
	if err := validateLocalTimestamp(project.UpdatedAt); err != nil {
		return project, fmt.Errorf("画布更新时间无效：%w", err)
	}
	if err := ValidateLocalWorkspaceStorageReferences(project.ProjectData); err != nil {
		return project, err
	}
	return saveLocalCanvasProject(project, false)
}

// ImportLocalCanvasProject 显式导入画布，保留 ZIP 导入身份并避免 ID 冲突覆盖现有画布。
func ImportLocalCanvasProject(project model.CanvasProject) (model.CanvasProject, error) {
	unlock := LockLocalWorkspaceReferences()
	defer unlock()
	project.UserID = strings.TrimSpace(project.UserID)
	project.ID = strings.TrimSpace(project.ID)
	if project.ID == "" {
		return project, errors.New("本地画布 ID 不能为空")
	}
	if err := validateLocalTimestamp(project.UpdatedAt); err != nil {
		return project, fmt.Errorf("画布更新时间无效：%w", err)
	}
	project, importKey, err := ensureLocalCanvasImportIdentity(project)
	if err != nil {
		return project, err
	}
	db, err := DB()
	if err != nil {
		return project, err
	}
	var allProjects []model.CanvasProject
	if err := db.Where("user_id = ?", project.UserID).Order("id ASC").Find(&allProjects).Error; err != nil {
		return project, err
	}
	for _, existing := range allProjects {
		if localCanvasImportKey(existing.ProjectData) == importKey {
			return importLocalCanvasProjectWithIdentity(project, importKey, existing.ID)
		}
	}

	var current model.CanvasProject
	err = db.First(&current, "user_id = ? AND id = ?", project.UserID, project.ID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return project, err
	}
	if err == nil {
		currentKey := localCanvasImportKey(current.ProjectData)
		sameLegacyProject := currentKey == "" && sameLocalCanvasProjectContent(current.ProjectData, project.ProjectData)
		if currentKey == importKey || sameLegacyProject {
			return importLocalCanvasProjectWithIdentity(project, importKey, project.ID)
		}

		canonicalID := importedLocalCanvasProjectID(importKey)
		if canonicalID == project.ID {
			return project, fmt.Errorf("画布导入身份冲突：无法为 %q 分配独立 ID", project.ID)
		}
		var canonical model.CanvasProject
		canonicalErr := db.First(&canonical, "user_id = ? AND id = ?", project.UserID, canonicalID).Error
		if canonicalErr == nil && localCanvasImportKey(canonical.ProjectData) != importKey {
			return project, fmt.Errorf("画布导入身份冲突：目标 ID %q 已被其他项目占用", canonicalID)
		}
		if canonicalErr != nil && !errors.Is(canonicalErr, gorm.ErrRecordNotFound) {
			return project, canonicalErr
		}
		return importLocalCanvasProjectWithIdentity(project, importKey, canonicalID)
	}

	// If a prior collision import was already remapped and the original source ID
	// has since been purged, recognize the stable remapped ID instead of creating
	// a second copy under the original ID.
	canonicalID := importedLocalCanvasProjectID(importKey)
	if canonicalID != project.ID {
		var canonical model.CanvasProject
		canonicalErr := db.First(&canonical, "user_id = ? AND id = ?", project.UserID, canonicalID).Error
		if canonicalErr == nil && localCanvasImportKey(canonical.ProjectData) == importKey {
			return importLocalCanvasProjectWithIdentity(project, importKey, canonicalID)
		}
		if canonicalErr != nil && !errors.Is(canonicalErr, gorm.ErrRecordNotFound) {
			return project, canonicalErr
		}
	}
	return importLocalCanvasProjectWithIdentity(project, importKey, project.ID)
}

func importLocalCanvasProjectWithIdentity(project model.CanvasProject, importKey string, id string) (model.CanvasProject, error) {
	project.ID = id
	project.ProjectData = setLocalCanvasProjectIdentity(project.ProjectData, id, importKey)
	if err := ValidateLocalWorkspaceStorageReferences(project.ProjectData); err != nil {
		return project, err
	}
	return saveLocalCanvasProject(project, true)
}

func ensureLocalCanvasImportIdentity(project model.CanvasProject) (model.CanvasProject, string, error) {
	var data map[string]json.RawMessage
	if err := json.Unmarshal([]byte(project.ProjectData), &data); err != nil || data == nil {
		if err == nil {
			err = errors.New("画布数据必须是 JSON 对象")
		}
		return project, "", fmt.Errorf("画布导入数据无效：%w", err)
	}
	importKey := localCanvasImportKey(project.ProjectData)
	if importKey == "" {
		identity, err := normalizedLocalCanvasProjectContent(project.ProjectData)
		if err != nil {
			return project, "", err
		}
		digest := sha256.Sum256(identity)
		importKey = "zip-project:" + hex.EncodeToString(digest[:])[:24]
	}
	project.ProjectData = setLocalCanvasProjectIdentity(project.ProjectData, project.ID, importKey)
	return project, importKey, nil
}

func localCanvasImportKey(projectData string) string {
	var data map[string]json.RawMessage
	if json.Unmarshal([]byte(projectData), &data) != nil {
		return ""
	}
	var key string
	if json.Unmarshal(data["importKey"], &key) != nil {
		return ""
	}
	return strings.TrimSpace(key)
}

func setLocalCanvasProjectIdentity(projectData string, id string, importKey string) string {
	var data map[string]json.RawMessage
	if json.Unmarshal([]byte(projectData), &data) != nil || data == nil {
		return projectData
	}
	encodedID, _ := json.Marshal(id)
	encodedKey, _ := json.Marshal(importKey)
	data["id"] = encodedID
	data["importKey"] = encodedKey
	encoded, err := json.Marshal(data)
	if err != nil {
		return projectData
	}
	return string(encoded)
}

func importedLocalCanvasProjectID(importKey string) string {
	digest := sha256.Sum256([]byte(importKey))
	return "imported-" + hex.EncodeToString(digest[:])[:24]
}

func sameLocalCanvasProjectContent(left string, right string) bool {
	leftContent, leftErr := normalizedLocalCanvasProjectContent(left)
	rightContent, rightErr := normalizedLocalCanvasProjectContent(right)
	return leftErr == nil && rightErr == nil && string(leftContent) == string(rightContent)
}

func normalizedLocalCanvasProjectContent(projectData string) ([]byte, error) {
	var data map[string]json.RawMessage
	if err := json.Unmarshal([]byte(projectData), &data); err != nil || data == nil {
		if err == nil {
			err = errors.New("画布数据必须是 JSON 对象")
		}
		return nil, fmt.Errorf("画布数据无效：%w", err)
	}
	delete(data, "createdAt")
	delete(data, "updatedAt")
	delete(data, "importKey")
	return json.Marshal(data)
}

func saveLocalCanvasProject(project model.CanvasProject, allowRestore bool) (model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return project, err
	}
	if err := ensureUniqueLocalXiajiProjectBinding(db, project); err != nil {
		return project, err
	}

	project.UserID = strings.TrimSpace(project.UserID)
	project.ID = strings.TrimSpace(project.ID)

	var current model.CanvasProject
	err = db.First(&current, "user_id = ? AND id = ?", project.UserID, project.ID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return project, db.Create(&project).Error
	}
	if err != nil {
		return project, err
	}
	if current.DeletedAt != "" {
		if err := validateLocalTimestamp(current.UpdatedAt); err != nil {
			return current, fmt.Errorf("已删除画布更新时间无效：%w", err)
		}
		if !allowRestore {
			return current, ErrLocalCanvasProjectDeleted
		}
		result := db.Model(&model.CanvasProject{}).
			Where("user_id = ? AND id = ? AND deleted_at = ? AND updated_at = ?", project.UserID, project.ID, current.DeletedAt, current.UpdatedAt).
			Updates(map[string]any{
				"project_data": project.ProjectData,
				"created_at":   project.CreatedAt,
				"updated_at":   project.UpdatedAt,
				"deleted_at":   "",
			})
		if result.Error != nil {
			return project, result.Error
		}
		if result.RowsAffected == 0 {
			if err := db.First(&current, "user_id = ? AND id = ?", project.UserID, project.ID).Error; err != nil {
				return project, err
			}
			return current, nil
		}
		return project, nil
	}
	currentIsNewer, err := localTimestampAfter(current.UpdatedAt, project.UpdatedAt)
	if err != nil {
		return current, err
	}
	if currentIsNewer {
		return current, nil
	}
	result := db.Model(&model.CanvasProject{}).
		Where("user_id = ? AND id = ? AND deleted_at = '' AND updated_at = ?", project.UserID, project.ID, current.UpdatedAt).
		Updates(map[string]any{
			"project_data": project.ProjectData,
			"created_at":   project.CreatedAt,
			"updated_at":   project.UpdatedAt,
			"deleted_at":   "",
		})
	if result.Error != nil {
		return project, result.Error
	}
	if result.RowsAffected == 0 {
		if err := db.First(&current, "user_id = ? AND id = ?", project.UserID, project.ID).Error; err != nil {
			return project, err
		}
		return current, nil
	}
	return project, nil
}

func ensureUniqueLocalXiajiProjectBinding(db *gorm.DB, project model.CanvasProject) error {
	projectAssetID, err := xiajiProjectAssetID(project.ProjectData)
	if err != nil {
		return fmt.Errorf("无法核验虾料项目与画布的关系：%w", err)
	}
	if projectAssetID == "" {
		return nil
	}
	var existingProjects []model.CanvasProject
	if err := db.Where("user_id = ? AND deleted_at = '' AND id <> ?", project.UserID, project.ID).Find(&existingProjects).Error; err != nil {
		return fmt.Errorf("读取现有虾画项目关系失败：%w", err)
	}
	for _, existing := range existingProjects {
		existingAssetID, err := xiajiProjectAssetID(existing.ProjectData)
		if err != nil {
			return fmt.Errorf("无法核验现有画布 %q 的虾料项目关系：%w", existing.ID, err)
		}
		if existingAssetID == projectAssetID {
			return fmt.Errorf("%w：虾料项目 %q 已绑定画布 %q", ErrLocalCanvasProjectConflict, projectAssetID, existing.ID)
		}
	}
	return nil
}

func xiajiProjectAssetID(projectData string) (string, error) {
	var data struct {
		XiajiProjectAssetID json.RawMessage `json:"xiajiProjectAssetId"`
	}
	if err := json.Unmarshal([]byte(projectData), &data); err != nil {
		return "", err
	}
	if len(data.XiajiProjectAssetID) == 0 || string(data.XiajiProjectAssetID) == "null" {
		return "", nil
	}
	var id string
	if err := json.Unmarshal(data.XiajiProjectAssetID, &id); err != nil {
		return "", errors.New("画布项目中的 xiajiProjectAssetId 格式无效")
	}
	return strings.TrimSpace(id), nil
}

func SaveLocalCanvasProjects(userID string, projects []model.CanvasProject) ([]model.CanvasProject, error) {
	for _, project := range projects {
		project.UserID = userID
		if _, err := SaveLocalCanvasProject(project); err != nil {
			return nil, err
		}
	}
	return ListUserCanvasProjects(userID)
}

// SaveLocalCanvasProjectsIfUnchanged applies a batch only when each persisted
// project still matches the snapshot observed by the caller. A nil expected
// project means that the caller expects the ID not to exist yet.
func SaveLocalCanvasProjectsIfUnchanged(
	userID string,
	projects []model.CanvasProject,
	expectedProjects map[string]*model.CanvasProject,
) ([]model.CanvasProject, error) {
	userID = strings.TrimSpace(userID)
	if expectedProjects == nil {
		return nil, errors.New("画布保存缺少读取基线")
	}
	seen := make(map[string]struct{}, len(projects))
	for i := range projects {
		project := &projects[i]
		project.UserID = userID
		project.ID = strings.TrimSpace(project.ID)
		if project.ID == "" {
			return nil, errors.New("本地画布 ID 不能为空")
		}
		if _, duplicate := seen[project.ID]; duplicate {
			return nil, fmt.Errorf("画布列表包含重复 ID：%s", project.ID)
		}
		seen[project.ID] = struct{}{}
		expected, ok := expectedProjects[project.ID]
		if !ok {
			return nil, fmt.Errorf("画布 %q 缺少读取基线", project.ID)
		}
		if expected != nil && (expected.ID != project.ID || strings.TrimSpace(expected.UserID) != userID) {
			return nil, fmt.Errorf("画布 %q 的读取基线无效", project.ID)
		}
		if err := validateLocalTimestamp(project.UpdatedAt); err != nil {
			return nil, fmt.Errorf("画布更新时间无效：%w", err)
		}
		if err := ValidateLocalWorkspaceStorageReferences(project.ProjectData); err != nil {
			return nil, err
		}
	}

	unlock := LockLocalWorkspaceReferences()
	defer unlock()
	db, err := DB()
	if err != nil {
		return nil, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		for _, project := range projects {
			if err := ensureUniqueLocalXiajiProjectBinding(tx, project); err != nil {
				return err
			}
			expected := expectedProjects[project.ID]
			var current model.CanvasProject
			err := tx.First(&current, "user_id = ? AND id = ?", userID, project.ID).Error
			if expected == nil {
				if err == nil {
					return fmt.Errorf("%w: 画布 %q 已存在", ErrLocalCanvasProjectConflict, project.ID)
				}
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				if err := tx.Create(&project).Error; err != nil {
					return fmt.Errorf("%w: %v", ErrLocalCanvasProjectConflict, err)
				}
				continue
			}
			if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && current.DeletedAt != "") {
				return fmt.Errorf("%w: 画布 %q 已不存在", ErrLocalCanvasProjectConflict, project.ID)
			}
			if err != nil {
				return err
			}
			if current.CreatedAt != expected.CreatedAt || current.UpdatedAt != expected.UpdatedAt ||
				!sameCanvasProjectSnapshot(current.ProjectData, expected.ProjectData) {
				return fmt.Errorf("%w: 画布 %q 的读取基线已过期", ErrLocalCanvasProjectConflict, project.ID)
			}

			result := tx.Model(&model.CanvasProject{}).
				Where("user_id = ? AND id = ? AND deleted_at = '' AND created_at = ? AND updated_at = ? AND project_data = ?",
					userID, project.ID, current.CreatedAt, current.UpdatedAt, current.ProjectData).
				Updates(map[string]any{
					"project_data": project.ProjectData,
					"created_at":   project.CreatedAt,
					"updated_at":   project.UpdatedAt,
					"deleted_at":   "",
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("%w: 画布 %q 在保存期间发生变化", ErrLocalCanvasProjectConflict, project.ID)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return ListUserCanvasProjects(userID)
}

func sameCanvasProjectSnapshot(left string, right string) bool {
	var leftValue any
	var rightValue any
	leftDecoder := json.NewDecoder(strings.NewReader(left))
	leftDecoder.UseNumber()
	rightDecoder := json.NewDecoder(strings.NewReader(right))
	rightDecoder.UseNumber()
	if leftDecoder.Decode(&leftValue) != nil || rightDecoder.Decode(&rightValue) != nil {
		return false
	}
	leftJSON, leftErr := json.Marshal(leftValue)
	rightJSON, rightErr := json.Marshal(rightValue)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}

// SoftDeleteLocalCanvasProjectsIfUnchanged only deletes projects that still
// match the snapshots observed by the caller. Nil expectations represent IDs
// that the caller expects not to exist yet.
func SoftDeleteLocalCanvasProjectsIfUnchanged(
	userID string,
	ids []string,
	expectedProjects map[string]*model.CanvasProject,
	deletedAt string,
) error {
	userID = strings.TrimSpace(userID)
	ids = uniqueTrimmedValues(ids...)
	if len(ids) == 0 || expectedProjects == nil {
		return errors.New("画布删除缺少项目或读取基线")
	}
	if err := validateLocalTimestamp(deletedAt); err != nil {
		return fmt.Errorf("画布删除时间无效：%w", err)
	}
	for _, id := range ids {
		expected, ok := expectedProjects[id]
		if !ok {
			return fmt.Errorf("画布 %q 缺少删除读取基线", id)
		}
		if expected != nil && (expected.ID != id || strings.TrimSpace(expected.UserID) != userID) {
			return fmt.Errorf("画布 %q 的删除读取基线无效", id)
		}
	}

	unlock := LockLocalWorkspaceReferences()
	defer unlock()
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, id := range ids {
			expected := expectedProjects[id]
			var current model.CanvasProject
			err := tx.First(&current, "user_id = ? AND id = ?", userID, id).Error
			if expected == nil {
				if err == nil {
					return fmt.Errorf("%w: 画布 %q 已存在", ErrLocalCanvasProjectConflict, id)
				}
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				tombstone := model.CanvasProject{
					UserID: userID, ID: id, CreatedAt: deletedAt, UpdatedAt: deletedAt, DeletedAt: deletedAt,
				}
				if err := tx.Create(&tombstone).Error; err != nil {
					return fmt.Errorf("%w: %v", ErrLocalCanvasProjectConflict, err)
				}
				continue
			}
			if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && current.DeletedAt != "") {
				return fmt.Errorf("%w: 画布 %q 已不存在", ErrLocalCanvasProjectConflict, id)
			}
			if err != nil {
				return err
			}
			if current.CreatedAt != expected.CreatedAt || current.UpdatedAt != expected.UpdatedAt ||
				!sameCanvasProjectSnapshot(current.ProjectData, expected.ProjectData) {
				return fmt.Errorf("%w: 画布 %q 的删除读取基线已过期", ErrLocalCanvasProjectConflict, id)
			}
			result := tx.Model(&model.CanvasProject{}).
				Where("user_id = ? AND id = ? AND deleted_at = '' AND created_at = ? AND updated_at = ? AND project_data = ?",
					userID, id, current.CreatedAt, current.UpdatedAt, current.ProjectData).
				Updates(map[string]any{"updated_at": deletedAt, "deleted_at": deletedAt})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("%w: 画布 %q 在删除期间发生变化", ErrLocalCanvasProjectConflict, id)
			}
		}
		return nil
	})
}
