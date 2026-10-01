package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// LocalWorkspaceID 是所有本地浏览器页面共用的固定数据域。
// 它不依赖浏览器 Cookie、登录账号或浏览器配置文件。
const LocalWorkspaceID = "local-workspace"

func CurrentLocalCanvasProjects(_ context.Context) ([]json.RawMessage, error) {
	projects, err := repository.ListUserCanvasProjects(LocalWorkspaceID)
	if err != nil {
		return nil, err
	}
	return canvasProjectData(projects), nil
}

func SaveLocalCanvasProject(_ context.Context, raw json.RawMessage, expectedRaw json.RawMessage) (json.RawMessage, error) {
	project, err := canvasProjectFromRaw(LocalWorkspaceID, raw)
	if err != nil {
		return nil, err
	}
	expected, err := canvasProjectExpectationFromRaw(LocalWorkspaceID, project.ID, expectedRaw)
	if err != nil {
		return nil, err
	}
	saved, err := repository.SaveLocalCanvasProjectsIfUnchanged(
		LocalWorkspaceID,
		[]model.CanvasProject{project},
		map[string]*model.CanvasProject{project.ID: expected},
	)
	if err != nil {
		return nil, err
	}
	for _, item := range saved {
		if item.ID == project.ID {
			return json.RawMessage(item.ProjectData), nil
		}
	}
	return nil, errors.New("画布保存后未能读取规范数据")
}

func SyncLocalCanvasProjects(_ context.Context, rawProjects []json.RawMessage, rawExpected map[string]json.RawMessage) ([]json.RawMessage, error) {
	projects := make([]model.CanvasProject, 0, len(rawProjects))
	for _, raw := range rawProjects {
		project, err := canvasProjectFromRaw(LocalWorkspaceID, raw)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	expected, err := canvasProjectExpectationsFromRaw(LocalWorkspaceID, rawExpected)
	if err != nil {
		return nil, err
	}
	saved, err := repository.SaveLocalCanvasProjectsIfUnchanged(LocalWorkspaceID, projects, expected)
	if err != nil {
		return nil, err
	}
	return canvasProjectData(saved), nil
}

func canvasProjectExpectationsFromRaw(userID string, rawExpected map[string]json.RawMessage) (map[string]*model.CanvasProject, error) {
	if rawExpected == nil {
		return nil, errors.New("画布保存缺少读取基线")
	}
	expected := make(map[string]*model.CanvasProject, len(rawExpected))
	for id, raw := range rawExpected {
		id = strings.TrimSpace(id)
		if id == "" || len(raw) == 0 {
			return nil, errors.New("画布保存读取基线无效")
		}
		if strings.TrimSpace(string(raw)) == "null" {
			expected[id] = nil
			continue
		}
		project, err := canvasProjectFromRaw(userID, raw)
		if err != nil || project.ID != id {
			return nil, errors.New("画布保存读取基线与画布 ID 不匹配")
		}
		expected[id] = &project
	}
	return expected, nil
}

func canvasProjectExpectationFromRaw(userID string, id string, raw json.RawMessage) (*model.CanvasProject, error) {
	if len(raw) == 0 {
		return nil, errors.New("画布保存缺少读取基线")
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return nil, nil
	}
	project, err := canvasProjectFromRaw(userID, raw)
	if err != nil || project.ID != id {
		return nil, errors.New("画布保存读取基线与画布 ID 不匹配")
	}
	return &project, nil
}

func ImportLocalCanvasProjects(_ context.Context, rawProjects []json.RawMessage) ([]json.RawMessage, error) {
	projects := make([]model.CanvasProject, 0, len(rawProjects))
	for _, raw := range rawProjects {
		project, err := canvasProjectFromRaw(LocalWorkspaceID, raw)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}

	imported := make([]model.CanvasProject, 0, len(projects))
	for _, project := range projects {
		saved, err := repository.ImportLocalCanvasProject(project)
		if err != nil {
			return nil, err
		}
		imported = append(imported, saved)
	}
	return canvasProjectData(imported), nil
}

func CurrentLocalWorkspaceAssets(_ context.Context) ([]json.RawMessage, error) {
	assets, err := repository.ListLocalWorkspaceAssets(LocalWorkspaceID)
	if err != nil {
		return nil, err
	}
	result := make([]json.RawMessage, 0, len(assets))
	for _, asset := range assets {
		result = append(result, json.RawMessage(asset.AssetData))
	}
	return result, nil
}

func SyncLocalWorkspaceAssets(ctx context.Context, rawAssets []json.RawMessage) ([]json.RawMessage, error) {
	assets := make([]model.LocalWorkspaceAsset, 0, len(rawAssets))
	for _, raw := range rawAssets {
		asset, err := localWorkspaceAssetFromRaw(raw)
		if err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	if err := repository.SaveLocalWorkspaceAssets(LocalWorkspaceID, assets); err != nil {
		return nil, err
	}
	return CurrentLocalWorkspaceAssets(ctx)
}

func DeleteLocalWorkspaceAssets(_ context.Context, assetIDs []string) error {
	ids := make([]string, 0, len(assetIDs))
	for _, id := range assetIDs {
		if value := strings.TrimSpace(id); value != "" {
			ids = append(ids, value)
		}
	}
	if len(ids) == 0 {
		return errors.New("本地素材参数无效")
	}
	return repository.DeleteLocalWorkspaceAssets(
		LocalWorkspaceID,
		ids,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
}

func DeleteLocalCanvasProjects(_ context.Context, projectIDs []string, rawExpected map[string]json.RawMessage) error {
	ids := make([]string, 0, len(projectIDs))
	for _, id := range projectIDs {
		if value := strings.TrimSpace(id); value != "" {
			ids = append(ids, value)
		}
	}
	if len(ids) == 0 {
		return errors.New("画布项目参数无效")
	}
	expected, err := canvasProjectExpectationsFromRaw(LocalWorkspaceID, rawExpected)
	if err != nil {
		return err
	}
	return repository.SoftDeleteLocalCanvasProjectsIfUnchanged(
		LocalWorkspaceID,
		ids,
		expected,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
}

func localWorkspaceAssetFromRaw(raw json.RawMessage) (model.LocalWorkspaceAsset, error) {
	if !json.Valid(raw) {
		return model.LocalWorkspaceAsset{}, errors.New("本地素材 JSON 无效")
	}
	var asset struct {
		ID        string `json:"id"`
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &asset); err != nil {
		return model.LocalWorkspaceAsset{}, err
	}
	asset.ID = strings.TrimSpace(asset.ID)
	if asset.ID == "" {
		return model.LocalWorkspaceAsset{}, errors.New("本地素材 ID 不能为空")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if asset.CreatedAt == "" {
		asset.CreatedAt = now
	}
	if asset.UpdatedAt == "" {
		asset.UpdatedAt = now
	}
	return model.LocalWorkspaceAsset{
		WorkspaceID: LocalWorkspaceID,
		ID:          asset.ID,
		AssetData:   string(raw),
		CreatedAt:   asset.CreatedAt,
		UpdatedAt:   asset.UpdatedAt,
	}, nil
}
