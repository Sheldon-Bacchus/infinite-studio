package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
)

const DefaultDramaUploadMaxBytes int64 = 100 << 20

var ErrDramaUploadTooLarge = errors.New("候选文件超过上传限制")
var ErrDramaUploadSizeMismatch = errors.New("候选文件长度发生变化")

var dramaProjectNamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)

// DramaImportCatalog is the normalized, read-only catalog consumed by the canvas importer.
type DramaImportCatalog struct {
	SourceSnapshot    DramaSourceSnapshot  `json:"sourceSnapshot"`
	Project           DramaImportProject   `json:"project"`
	Episodes          []DramaImportEpisode `json:"episodes"`
	Assets            []DramaImportAsset   `json:"assets"`
	BeatContextAssets []DramaImportAsset   `json:"beatContextAssets"`
	Warnings          []string             `json:"warnings"`
}

type DramaAssetCatalog struct {
	SourceSnapshot DramaSourceSnapshot `json:"sourceSnapshot"`
	Project        DramaImportProject  `json:"project"`
	Assets         []DramaImportAsset  `json:"assets"`
	Warnings       []string            `json:"warnings"`
}

type DramaImportAsset struct {
	ID               string          `json:"id"`
	Tab              string          `json:"tab"`
	Kind             string          `json:"kind"`
	Role             string          `json:"role"`
	Label            string          `json:"label"`
	Sublabel         string          `json:"sublabel,omitempty"`
	RelPath          string          `json:"relPath,omitempty"`
	URL              string          `json:"url,omitempty"`
	Exists           bool            `json:"exists"`
	MediaType        string          `json:"mediaType"`
	AspectRatio      string          `json:"aspectRatio,omitempty"`
	Meta             map[string]any  `json:"meta,omitempty"`
	SlotTarget       json.RawMessage `json:"slotTarget,omitempty"`
	Pushable         *bool           `json:"pushable,omitempty"`
	HistoryAvailable bool            `json:"historyAvailable,omitempty"`
	RestoreAvailable bool            `json:"restoreAvailable,omitempty"`
}

type DramaSourceSnapshot struct {
	ProjectID   string `json:"projectId"`
	Revision    string `json:"revision"`
	GeneratedAt string `json:"generatedAt"`
}

type DramaImportProject struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type DramaImportEpisode struct {
	Number      int               `json:"number"`
	Title       string            `json:"title"`
	Summary     string            `json:"summary"`
	BeatCount   int               `json:"beatCount"`
	IdentityIDs []string          `json:"identityIds"`
	SceneIDs    []string          `json:"sceneIds"`
	PropIDs     []string          `json:"propIds"`
	Beats       []DramaImportBeat `json:"beats"`
}

type DramaImportBeat struct {
	Episode              int      `json:"episode"`
	BeatNumber           int      `json:"beatNumber"`
	Title                string   `json:"title"`
	Content              string   `json:"content"`
	Prompt               string   `json:"prompt"`
	VisualDescription    string   `json:"visualDescription,omitempty"`
	KeyframePrompt       string   `json:"keyframePrompt,omitempty"`
	VideoPrompt          string   `json:"videoPrompt,omitempty"`
	AudioPrompt          string   `json:"audioPrompt,omitempty"`
	VideoMode            string   `json:"videoMode,omitempty"`
	DurationSeconds      float64  `json:"durationSeconds,omitempty"`
	SceneID              string   `json:"sceneId"`
	IdentityIDs          []string `json:"identityIds"`
	PropIDs              []string `json:"propIds"`
	SketchURL            string   `json:"sketchUrl"`
	FrameURL             string   `json:"frameUrl"`
	VideoURL             string   `json:"videoUrl"`
	AudioURL             string   `json:"audioUrl"`
	AudioDurationSeconds float64  `json:"audioDurationSeconds"`
}

type DramaClawClient struct {
	BaseURL    string
	APIToken   string
	HTTPClient *http.Client
}

type DramaCandidateUploadResult struct {
	URL      string `json:"url"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}

type DramaCreateIdentityRequest struct {
	SourceURL         string `json:"source_url"`
	Character         string `json:"character"`
	IdentityName      string `json:"identity_name"`
	AppearanceDetails string `json:"appearance_details,omitempty"`
	FacePrompt        string `json:"face_prompt,omitempty"`
	AgeGroup          string `json:"age_group,omitempty"`
}

type DramaIdentityResult struct {
	Character    string `json:"character"`
	IdentityID   string `json:"identity_id"`
	IdentityName string `json:"identity_name"`
	TargetURL    string `json:"target_url"`
}

type DramaPushRequest struct {
	SourceURL string          `json:"source_url"`
	Target    json.RawMessage `json:"target"`
	MarkStale bool            `json:"mark_stale"`
}

type DramaPushResult struct {
	TargetURL     string  `json:"target_url"`
	Backup        *string `json:"backup,omitempty"`
	StaleMarked   int     `json:"stale_marked"`
	AffectedCount int     `json:"affected_count"`
}

type DramaPushImpact struct {
	Target        json.RawMessage `json:"target"`
	AffectedBeats []any           `json:"affected_beats"`
	AffectedCount int             `json:"affected_count"`
}

type DramaAssetHistoryEntry struct {
	HistoryID string `json:"history_id"`
	Filename  string `json:"filename"`
	URL       string `json:"url"`
	CreatedAt string `json:"created_at"`
	Bytes     int64  `json:"bytes"`
}

type DramaAssetHistory struct {
	Kind       string                   `json:"kind"`
	IdentityID string                   `json:"identity_id,omitempty"`
	CurrentURL string                   `json:"current_url,omitempty"`
	Entries    []DramaAssetHistoryEntry `json:"entries"`
}

type DramaAssetHistoryRestoreRequest struct {
	Kind       string `json:"kind"`
	IdentityID string `json:"identity_id,omitempty"`
	HistoryID  string `json:"history_id"`
}

type DramaAssetHistoryRestoreResult struct {
	Kind            string `json:"kind"`
	IdentityID      string `json:"identity_id,omitempty"`
	Restored        bool   `json:"restored"`
	URL             string `json:"url"`
	BackupHistoryID string `json:"backup_history_id,omitempty"`
}

var dramaPushTargetRequiredFields = map[string][]string{
	"frame": {"episode", "beat"}, "sketch": {"episode", "beat"}, "director_render": {"episode", "beat"},
	"selected_background": {"episode", "beat"}, "video": {"episode", "beat"}, "beat_audio": {"episode", "beat"},
	"identity": {"character", "identity_id"}, "identity_costume": {"character", "identity_id"},
	"identity_portrait": {"character", "identity_id"}, "portrait": {"character"},
	"scene_master": {"scene_id"}, "scene_360": {"scene_id"}, "scene_reverse_master": {"scene_id"},
	"scene_spatial_layout": {"scene_id"}, "scene_director_pano_360": {"scene_id"},
	"scene_3gs_active_ply": {"scene_id"}, "scene_3gs_master_ply": {"scene_id"},
	"scene_3gs_reverse_ply": {"scene_id"}, "scene_3gs_pano_ply": {"scene_id"},
	"scene_3gs_custom_scene": {"scene_id"}, "scene_3gs_collision_glb": {"scene_id"}, "prop_ref": {"prop_id"},
}

func (c *DramaClawClient) postJSONData(ctx context.Context, endpointPath string, payload any) (json.RawMessage, error) {
	return c.writeJSONData(ctx, http.MethodPost, endpointPath, payload)
}

func (c *DramaClawClient) patchJSONData(ctx context.Context, endpointPath string, payload any) (json.RawMessage, error) {
	return c.writeJSONData(ctx, http.MethodPatch, endpointPath, payload)
}

func (c *DramaClawClient) writeJSONData(ctx context.Context, method, endpointPath string, payload any) (json.RawMessage, error) {
	endpoint, err := c.endpoint(endpointPath)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	client := c.writeHTTPClient()
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("虾集写回请求失败: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("读取虾集写回响应失败: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("虾集写回返回 %s", response.Status)
	}
	var envelope struct {
		OK    *bool           `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error string          `json:"error"`
		Msg   string          `json:"msg"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, errors.New("虾集写回响应无效")
	}
	if envelope.OK != nil && !*envelope.OK {
		return nil, errors.New("虾集写回被拒绝")
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, errors.New("虾集写回响应缺少 data")
	}
	return envelope.Data, nil
}

func (c *DramaClawClient) CreateIdentity(ctx context.Context, projectID string, payload DramaCreateIdentityRequest) (DramaIdentityResult, error) {
	if c == nil || strings.TrimSpace(projectID) == "" {
		return DramaIdentityResult{}, errors.New("虾集项目 ID 不能为空")
	}
	if strings.TrimSpace(payload.Character) == "" || strings.TrimSpace(payload.IdentityName) == "" {
		return DramaIdentityResult{}, errors.New("角色名和身份名不能为空")
	}
	sourceURL, err := c.resolveCandidateURL(projectID, payload.SourceURL)
	if err != nil {
		return DramaIdentityResult{}, err
	}
	payload.SourceURL = sourceURL
	data, err := c.postJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/freezone/assets/identities", payload)
	if err != nil {
		return DramaIdentityResult{}, err
	}
	var result DramaIdentityResult
	if err := json.Unmarshal(data, &result); err != nil {
		return DramaIdentityResult{}, errors.New("虾集新建身份响应无效")
	}
	if result.IdentityID == "" {
		return DramaIdentityResult{}, errors.New("虾集新建身份响应缺少身份 ID")
	}
	result.TargetURL = c.ProxyMediaURL(result.TargetURL)
	return result, nil
}

func validateDramaPushTarget(raw json.RawMessage) error {
	var target map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &target) != nil || target == nil {
		return errors.New("素材目标格式无效")
	}
	var kind string
	if json.Unmarshal(target["kind"], &kind) != nil || len(dramaPushTargetRequiredFields[kind]) == 0 {
		return errors.New("不支持的虾集素材目标")
	}
	allowed := map[string]bool{"kind": true}
	for _, field := range dramaPushTargetRequiredFields[kind] {
		allowed[field] = true
		if len(target[field]) == 0 || string(target[field]) == "null" {
			return fmt.Errorf("素材目标缺少 %s", field)
		}
		if field == "episode" || field == "beat" {
			var number int
			if json.Unmarshal(target[field], &number) != nil || number <= 0 {
				return fmt.Errorf("素材目标 %s 必须是正整数", field)
			}
		} else {
			var value string
			if json.Unmarshal(target[field], &value) != nil || strings.TrimSpace(value) == "" {
				return fmt.Errorf("素材目标 %s 不能为空", field)
			}
		}
	}
	for field := range target {
		if !allowed[field] {
			return fmt.Errorf("素材目标包含不支持字段 %s", field)
		}
	}
	return nil
}

func (c *DramaClawClient) PushCandidate(ctx context.Context, projectID string, payload DramaPushRequest) (DramaPushResult, error) {
	if c == nil || strings.TrimSpace(projectID) == "" {
		return DramaPushResult{}, errors.New("虾集项目 ID 不能为空")
	}
	sourceURL, err := c.resolveCandidateURL(projectID, payload.SourceURL)
	if err != nil {
		return DramaPushResult{}, err
	}
	if err := validateDramaPushTarget(payload.Target); err != nil {
		return DramaPushResult{}, err
	}
	payload.SourceURL = sourceURL
	data, err := c.postJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/freezone/push", payload)
	if err != nil {
		return DramaPushResult{}, err
	}
	var wire struct {
		TargetURL     string  `json:"target_url"`
		Backup        *string `json:"backup"`
		StaleMarked   int     `json:"stale_marked"`
		AffectedCount int     `json:"affected_count"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return DramaPushResult{}, errors.New("虾集素材替换响应无效")
	}
	result := DramaPushResult{TargetURL: c.ProxyMediaURL(wire.TargetURL), Backup: wire.Backup, StaleMarked: wire.StaleMarked, AffectedCount: wire.AffectedCount}
	if result.Backup != nil {
		backup := path.Base(strings.ReplaceAll(*result.Backup, "\\", "/"))
		result.Backup = &backup
	}
	return result, nil
}

func (c *DramaClawClient) writeHTTPClient() *http.Client {
	base := c.HTTPClient
	if base == nil {
		base = http.DefaultClient
	}
	client := *base
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return &client
}

func (c *DramaClawClient) GetPushImpact(ctx context.Context, projectID string, target json.RawMessage) (DramaPushImpact, error) {
	if c == nil || strings.TrimSpace(projectID) == "" {
		return DramaPushImpact{}, errors.New("虾集项目 ID 不能为空")
	}
	if err := validateDramaPushTarget(target); err != nil {
		return DramaPushImpact{}, err
	}
	data, err := c.postJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/freezone/impact", struct {
		Target json.RawMessage `json:"target"`
	}{Target: target})
	if err != nil {
		return DramaPushImpact{}, err
	}
	var result DramaPushImpact
	if err := json.Unmarshal(data, &result); err != nil {
		return DramaPushImpact{}, errors.New("虾集素材影响范围响应无效")
	}
	return result, nil
}

func validDramaHistoryKind(kind string) bool {
	switch kind {
	case "portrait", "identity", "identity_costume", "identity_portrait":
		return true
	default:
		return false
	}
}

func (c *DramaClawClient) GetAssetHistory(ctx context.Context, projectID, character, kind, identityID string) (DramaAssetHistory, error) {
	if !validDramaHistoryKind(kind) || strings.TrimSpace(character) == "" || strings.TrimSpace(projectID) == "" {
		return DramaAssetHistory{}, errors.New("角色素材历史参数无效")
	}
	if kind != "portrait" && strings.TrimSpace(identityID) == "" {
		return DramaAssetHistory{}, errors.New("该素材历史需要 identity_id")
	}
	query := url.Values{"kind": []string{kind}}
	if identityID != "" {
		query.Set("identity_id", identityID)
	}
	data, err := c.getData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/characters/"+url.PathEscape(character)+"/asset-history?"+query.Encode())
	if err != nil {
		return DramaAssetHistory{}, err
	}
	var result DramaAssetHistory
	if err := json.Unmarshal(data, &result); err != nil {
		return DramaAssetHistory{}, errors.New("虾集角色历史响应无效")
	}
	result.CurrentURL = c.ProxyMediaURL(result.CurrentURL)
	for index := range result.Entries {
		result.Entries[index].URL = c.ProxyMediaURL(result.Entries[index].URL)
	}
	return result, nil
}

func (c *DramaClawClient) RestoreAssetHistory(ctx context.Context, projectID, character string, payload DramaAssetHistoryRestoreRequest) (DramaAssetHistoryRestoreResult, error) {
	if !validDramaHistoryKind(payload.Kind) || strings.TrimSpace(character) == "" || strings.TrimSpace(projectID) == "" || strings.TrimSpace(payload.HistoryID) == "" {
		return DramaAssetHistoryRestoreResult{}, errors.New("恢复角色素材历史参数无效")
	}
	if payload.Kind != "portrait" && strings.TrimSpace(payload.IdentityID) == "" {
		return DramaAssetHistoryRestoreResult{}, errors.New("该素材历史需要 identity_id")
	}
	data, err := c.postJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/characters/"+url.PathEscape(character)+"/asset-history/restore", payload)
	if err != nil {
		return DramaAssetHistoryRestoreResult{}, err
	}
	var result DramaAssetHistoryRestoreResult
	if err := json.Unmarshal(data, &result); err != nil {
		return DramaAssetHistoryRestoreResult{}, errors.New("虾集历史恢复响应无效")
	}
	if !result.Restored {
		return DramaAssetHistoryRestoreResult{}, errors.New("虾集未确认角色素材恢复成功")
	}
	result.URL = c.ProxyMediaURL(result.URL)
	return result, nil
}

// UploadCandidate streams a user-selected file into the project's DramaClaw freezone uploads.
func (c *DramaClawClient) UploadCandidate(ctx context.Context, projectID, filename, contentType string, input io.Reader, expectedSize, maxBytes int64) (DramaCandidateUploadResult, error) {
	if c == nil || c.BaseURL == "" {
		return DramaCandidateUploadResult{}, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if strings.TrimSpace(projectID) == "" || input == nil || expectedSize < 0 {
		return DramaCandidateUploadResult{}, errors.New("候选上传参数无效")
	}
	if maxBytes <= 0 {
		maxBytes = DefaultDramaUploadMaxBytes
	}
	if expectedSize > maxBytes {
		return DramaCandidateUploadResult{}, ErrDramaUploadTooLarge
	}
	filename = path.Base(strings.ReplaceAll(filename, `\`, "/"))
	if filename == "" || filename == "." || filename == "/" {
		filename = "candidate.bin"
	}
	if _, _, err := mime.ParseMediaType(contentType); err != nil {
		contentType = "application/octet-stream"
	}
	endpoint, err := c.endpoint("/api/v1/projects/" + url.PathEscape(projectID) + "/freezone/upload")
	if err != nil {
		return DramaCandidateUploadResult{}, err
	}

	pipeReader, pipeWriter := io.Pipe()
	multipartWriter := multipart.NewWriter(pipeWriter)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
	header.Set("Content-Type", contentType)
	var prefix bytes.Buffer
	prefixWriter := multipart.NewWriter(&prefix)
	if err := prefixWriter.SetBoundary(multipartWriter.Boundary()); err != nil {
		return DramaCandidateUploadResult{}, err
	}
	if _, err := prefixWriter.CreatePart(header); err != nil {
		return DramaCandidateUploadResult{}, err
	}
	contentLength := int64(prefix.Len()) + expectedSize + int64(len("\r\n--"+multipartWriter.Boundary()+"--\r\n"))
	copyResult := make(chan error, 1)
	go func() {
		part, partErr := multipartWriter.CreatePart(header)
		if partErr != nil {
			copyResult <- partErr
			_ = pipeWriter.CloseWithError(partErr)
			return
		}
		written, copyErr := io.Copy(part, io.LimitReader(input, expectedSize+1))
		if copyErr != nil {
			copyResult <- copyErr
			_ = pipeWriter.CloseWithError(copyErr)
			return
		}
		if written != expectedSize {
			copyResult <- ErrDramaUploadSizeMismatch
			_ = pipeWriter.CloseWithError(ErrDramaUploadSizeMismatch)
			return
		}
		if closeErr := multipartWriter.Close(); closeErr != nil {
			copyResult <- closeErr
			_ = pipeWriter.CloseWithError(closeErr)
			return
		}
		copyResult <- nil
		_ = pipeWriter.Close()
	}()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, pipeReader)
	if err != nil {
		_ = pipeReader.CloseWithError(err)
		<-copyResult
		return DramaCandidateUploadResult{}, err
	}
	request.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	request.ContentLength = contentLength
	request.Header.Set("Accept", "application/json")
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	client := c.writeHTTPClient()
	response, err := client.Do(request)
	if err != nil {
		_ = pipeReader.CloseWithError(err)
		<-copyResult
		return DramaCandidateUploadResult{}, fmt.Errorf("虾集候选上传请求失败: %w", err)
	}
	defer response.Body.Close()
	if copyErr := <-copyResult; copyErr != nil {
		return DramaCandidateUploadResult{}, copyErr
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return DramaCandidateUploadResult{}, fmt.Errorf("读取虾集候选上传响应失败: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return DramaCandidateUploadResult{}, fmt.Errorf("虾集候选上传返回 %s", response.Status)
	}
	var envelope struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || !envelope.OK {
		return DramaCandidateUploadResult{}, errors.New("虾集候选上传响应无效")
	}
	var result DramaCandidateUploadResult
	if err := json.Unmarshal(envelope.Data, &result); err != nil || result.URL == "" {
		return DramaCandidateUploadResult{}, errors.New("虾集候选上传响应缺少文件地址")
	}
	if _, err := c.resolveCandidateURL(projectID, result.URL); err != nil {
		return DramaCandidateUploadResult{}, err
	}
	return result, nil
}

func (c *DramaClawClient) resolveCandidateURL(projectID, raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "" && !c.sameOrigin(parsed) {
		return "", errors.New("候选素材地址不属于当前项目")
	}
	base, err := url.Parse(c.BaseURL)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", errors.New("DRAMACLAW_BASE_URL 无效")
	}
	if !parsed.IsAbs() {
		parsed = base.ResolveReference(parsed)
	}
	if !c.sameOrigin(parsed) || parsed.Fragment != "" || path.Clean(parsed.Path) != parsed.Path {
		return "", errors.New("候选素材地址不属于当前项目")
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 6 || parts[0] != "static" || parts[1] != "projects" || parts[2] != projectID || parts[3] != "freezone" || parts[4] != "_uploads" || parts[5] == "" || parts[5] == "." || parts[5] == ".." {
		return "", errors.New("候选素材地址不属于当前项目")
	}
	return parsed.String(), nil
}

func NewDramaClawClient(baseURL, apiToken string) *DramaClawClient {
	client := &DramaClawClient{
		BaseURL:  strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		APIToken: strings.TrimSpace(apiToken),
		HTTPClient: &http.Client{
			Timeout: 5 * time.Minute,
		},
	}
	client.HTTPClient.CheckRedirect = func(req *http.Request, _ []*http.Request) error {
		if !client.sameOrigin(req.URL) {
			return errors.New("虾集媒体重定向地址不属于已配置服务")
		}
		return nil
	}
	return client
}

func (c *DramaClawClient) GetImportCatalog(ctx context.Context, projectID string, episode, beat *int) (DramaImportCatalog, error) {
	if c == nil || c.BaseURL == "" {
		return DramaImportCatalog{}, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if strings.TrimSpace(projectID) == "" {
		return DramaImportCatalog{}, errors.New("虾集项目 ID 不能为空")
	}
	if beat != nil && episode == nil {
		return DramaImportCatalog{}, errors.New("查询分镜上下文时必须提供集数")
	}

	episodesData, err := c.getData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/episodes")
	if err != nil {
		return DramaImportCatalog{}, err
	}
	episodes, err := normalizeDramaEpisodes(episodesData)
	if err != nil {
		return DramaImportCatalog{}, err
	}

	parts := [][]byte{episodesData}
	if episode != nil {
		index := -1
		for i := range episodes {
			if episodes[i].Number == *episode {
				index = i
				break
			}
		}
		if index < 0 {
			return DramaImportCatalog{}, fmt.Errorf("虾集第 %d 集不存在", *episode)
		}
		beatsData, beatsErr := c.getData(ctx, fmt.Sprintf("/api/v1/projects/%s/episodes/%d/beats", url.PathEscape(projectID), *episode))
		if beatsErr != nil {
			return DramaImportCatalog{}, beatsErr
		}
		beats, normalizeErr := normalizeDramaBeats(beatsData, *episode)
		if normalizeErr != nil {
			return DramaImportCatalog{}, normalizeErr
		}
		episodes[index].Beats = beats
		if episodes[index].BeatCount == 0 {
			episodes[index].BeatCount = len(beats)
		}
		parts = append(parts, beatsData)
	}

	assetsPath := "/api/v1/projects/" + url.PathEscape(projectID) + "/freezone/assets"
	assetsData, assetsErr := c.getData(ctx, assetsPath)
	assets := []DramaImportAsset{}
	warnings := []string{}
	if assetsErr != nil {
		warnings = append(warnings, "读取虾集素材目录失败")
	} else {
		assets, err = c.normalizeDramaImportAssets(assetsData)
		if err != nil {
			warnings = append(warnings, "解析虾集素材目录失败")
		} else {
			parts = append(parts, assetsData)
		}
	}

	beatContextAssets := []DramaImportAsset{}
	if episode != nil {
		query := url.Values{}
		query.Set("episode", fmt.Sprint(*episode))
		if beat != nil {
			query.Set("beat", fmt.Sprint(*beat))
		}
		contextPath := "/api/v1/projects/" + url.PathEscape(projectID) + "/freezone/assets/beat-context?" + query.Encode()
		contextData, contextErr := c.getData(ctx, contextPath)
		if contextErr != nil {
			warnings = append(warnings, "读取虾集分镜素材上下文失败")
		} else {
			beatContextAssets, err = c.normalizeDramaBeatContextAssets(contextData)
			if err != nil {
				warnings = append(warnings, "解析虾集分镜素材上下文失败")
			} else {
				parts = append(parts, contextData)
			}
		}
	}

	catalog := DramaImportCatalog{
		SourceSnapshot: DramaSourceSnapshot{
			ProjectID:   projectID,
			Revision:    dramaRevision(parts...),
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		},
		Project:           DramaImportProject{ID: projectID, Title: projectID},
		Episodes:          episodes,
		Assets:            assets,
		BeatContextAssets: beatContextAssets,
		Warnings:          warnings,
	}
	c.rewriteMediaURLs(&catalog)
	return catalog, nil
}

// GetProjectSummaries returns DramaClaw's own visible project records. The
// project API remains the source of truth; the canvas backend only validates
// the response envelope and array shape before returning it to the UI.
func (c *DramaClawClient) GetProjectSummaries(ctx context.Context) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	data, err := c.getData(ctx, "/api/v1/projects/summaries?status=all")
	if err != nil {
		return nil, err
	}
	var summaries []json.RawMessage
	if err := json.Unmarshal(data, &summaries); err != nil || summaries == nil {
		return nil, errors.New("虾集项目列表响应无效")
	}
	for _, summary := range summaries {
		var item map[string]json.RawMessage
		if err := json.Unmarshal(summary, &item); err != nil || item == nil {
			return nil, errors.New("虾集项目列表包含无效项目")
		}
		var id, projectID string
		_ = json.Unmarshal(item["id"], &id)
		_ = json.Unmarshal(item["project_id"], &projectID)
		if strings.TrimSpace(id) == "" && strings.TrimSpace(projectID) == "" {
			return nil, errors.New("虾集项目列表缺少项目 ID")
		}
	}
	return data, nil
}

// GetAssetCatalog reads only the project asset page data. It deliberately
// avoids the separate episode/beat importer routes used by /xiaji/episodes.
func (c *DramaClawClient) GetAssetCatalog(ctx context.Context, projectID string) (DramaAssetCatalog, error) {
	if c == nil || c.BaseURL == "" {
		return DramaAssetCatalog{}, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if strings.TrimSpace(projectID) == "" {
		return DramaAssetCatalog{}, errors.New("虾集项目 ID 不能为空")
	}
	data, err := c.getData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/freezone/assets")
	if err != nil {
		return DramaAssetCatalog{}, err
	}
	assets, err := c.normalizeDramaImportAssets(data)
	if err != nil {
		return DramaAssetCatalog{}, err
	}
	catalog := DramaAssetCatalog{
		SourceSnapshot: DramaSourceSnapshot{
			ProjectID:   projectID,
			Revision:    dramaRevision(data),
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		},
		Project:  DramaImportProject{ID: projectID, Title: projectID},
		Assets:   assets,
		Warnings: []string{},
	}
	c.rewriteAssetURLs(catalog.Assets)
	return catalog, nil
}

// GetAssetDomainList reads one of DramaClaw's domain-owned asset pages through
// an explicit allowlist. The episode/beat importer has its own endpoint and is
// intentionally not reachable through this method.
func (c *DramaClawClient) GetAssetDomainList(ctx context.Context, projectID, domain string) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if strings.TrimSpace(projectID) == "" {
		return nil, errors.New("虾集项目 ID 不能为空")
	}
	if !validDramaRouteSegment(projectID) {
		return nil, errors.New("虾集项目 ID 无效")
	}
	var endpoint string
	switch domain {
	case "characters", "scenes", "props":
		endpoint = "/api/v1/projects/" + url.PathEscape(projectID) + "/" + domain + "?summary=true"
	default:
		return nil, errors.New("不支持的虾塘素材分类")
	}
	data, err := c.getData(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	var rows []json.RawMessage
	if err := json.Unmarshal(data, &rows); err != nil || rows == nil {
		return nil, errors.New("虾塘素材分类响应无效")
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, errors.New("虾塘素材分类响应无效")
	}
	rewriteDramaDomainMediaURLs(c, value)
	normalized, err := json.Marshal(value)
	if err != nil {
		return nil, errors.New("虾塘素材分类响应无效")
	}
	return normalized, nil
}

func (c *DramaClawClient) GetCharacterVoiceSamples(ctx context.Context, projectID, character string) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if !validDramaRouteSegment(projectID) || !validDramaRouteSegment(character) {
		return nil, errors.New("虾塘项目或角色名称无效")
	}
	data, err := c.getData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/characters/"+url.PathEscape(character)+"/voice-samples")
	if err != nil {
		return nil, err
	}
	return rewriteDramaDomainMediaData(c, data)
}

func (c *DramaClawClient) GetNarratorVoice(ctx context.Context, projectID string, sources bool) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if !validDramaRouteSegment(projectID) {
		return nil, errors.New("虾塘项目 ID 无效")
	}
	endpoint := "/api/v1/projects/" + url.PathEscape(projectID) + "/narrator-voice"
	if sources {
		endpoint += "/sources"
	}
	data, err := c.getData(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	return rewriteDramaDomainMediaData(c, data)
}

func (c *DramaClawClient) UpdateCharacterVoice(ctx context.Context, projectID, character, slot, operation string, payload json.RawMessage) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaCharacterVoiceOperation(projectID, character, slot, operation, payload); err != nil {
		return nil, err
	}
	endpoint := "/api/v1/projects/" + url.PathEscape(projectID) + "/characters/" + url.PathEscape(character) + "/voice-samples/" + url.PathEscape(slot) + "/" + operation
	data, err := c.postJSONData(ctx, endpoint, payload)
	if err != nil {
		return nil, err
	}
	return rewriteDramaDomainMediaData(c, data)
}

func (c *DramaClawClient) UpdateNarratorVoice(ctx context.Context, projectID, operation string, payload json.RawMessage) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := ValidateDramaNarratorVoiceOperation(projectID, operation, payload); err != nil {
		return nil, err
	}
	data, err := c.postJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/narrator-voice/"+operation, payload)
	if err != nil {
		return nil, err
	}
	return rewriteDramaDomainMediaData(c, data)
}

func (c *DramaClawClient) UploadCharacterVoiceSample(ctx context.Context, projectID, character, slot, filename, contentType string, input io.Reader, size, maxBytes int64) (json.RawMessage, error) {
	if !validDramaRouteSegment(projectID) || !validDramaRouteSegment(character) || !validDramaVoiceSlot(slot) {
		return nil, errors.New("虾塘项目、角色或声线槽位无效")
	}
	endpoint := "/api/v1/projects/" + url.PathEscape(projectID) + "/characters/" + url.PathEscape(character) + "/voice-samples/" + url.PathEscape(slot) + "/upload"
	return c.uploadDramaVoice(ctx, endpoint, filename, contentType, input, size, maxBytes)
}

func (c *DramaClawClient) UploadNarratorVoice(ctx context.Context, projectID, filename, contentType string, input io.Reader, size, maxBytes int64) (json.RawMessage, error) {
	if !validDramaRouteSegment(projectID) {
		return nil, errors.New("虾塘项目 ID 无效")
	}
	return c.uploadDramaVoice(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/narrator-voice/upload", filename, contentType, input, size, maxBytes)
}

func validDramaVoiceSlot(slot string) bool {
	switch slot {
	case "default", "child", "youth", "middle", "elder":
		return true
	default:
		return false
	}
}

func ValidateDramaCharacterVoiceOperation(projectID, character, slot, operation string, payload json.RawMessage) error {
	if !validDramaRouteSegment(projectID) || !validDramaRouteSegment(character) || !validDramaVoiceSlot(slot) {
		return errors.New("虾塘项目、角色或声线槽位无效")
	}
	return validateDramaVoicePayload(operation, payload, false)
}

func ValidateDramaNarratorVoiceOperation(projectID, operation string, payload json.RawMessage) error {
	if !validDramaRouteSegment(projectID) {
		return errors.New("虾塘项目 ID 无效")
	}
	return validateDramaVoicePayload(operation, payload, true)
}

func validateDramaVoicePayload(operation string, payload json.RawMessage, narrator bool) error {
	var body map[string]json.RawMessage
	if len(payload) == 0 || json.Unmarshal(payload, &body) != nil || body == nil {
		return errors.New("虾塘声线操作参数无效")
	}
	allowed := map[string]bool{}
	switch operation {
	case "record":
		allowed["data_url"] = true
	case "copy":
		if !narrator {
			return errors.New("角色声线不支持复制操作")
		}
		allowed["source_path"] = true
	case "trim":
		allowed["start_seconds"], allowed["duration_seconds"] = true, true
		if !narrator {
			allowed["source_path"] = true
		}
	case "delete":
	default:
		return errors.New("不支持的虾塘声线操作")
	}
	for key := range body {
		if !allowed[key] {
			return errors.New("虾塘声线请求包含不支持的字段")
		}
	}
	switch operation {
	case "record", "copy":
		key := "data_url"
		if operation == "copy" {
			key = "source_path"
		}
		var value string
		if json.Unmarshal(body[key], &value) != nil || strings.TrimSpace(value) == "" {
			return errors.New("虾塘声线请求缺少必要内容")
		}
	case "trim":
		var start, duration float64
		if json.Unmarshal(body["start_seconds"], &start) != nil || json.Unmarshal(body["duration_seconds"], &duration) != nil || start < 0 || duration <= 0 {
			return errors.New("虾塘声线裁剪参数无效")
		}
		if !narrator {
			var source string
			if json.Unmarshal(body["source_path"], &source) != nil || strings.TrimSpace(source) == "" {
				return errors.New("角色声线裁剪缺少源文件路径")
			}
		}
	}
	return nil
}

func (c *DramaClawClient) uploadDramaVoice(ctx context.Context, endpointPath, filename, contentType string, input io.Reader, size, maxBytes int64) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if input == nil || size < 0 {
		return nil, errors.New("虾塘声线上传参数无效")
	}
	if maxBytes <= 0 {
		maxBytes = DefaultDramaUploadMaxBytes
	}
	if size > maxBytes {
		return nil, ErrDramaUploadTooLarge
	}
	filename = path.Base(strings.ReplaceAll(filename, `\`, "/"))
	if filename == "" || filename == "." || filename == "/" {
		filename = "voice.bin"
	}
	if _, _, err := mime.ParseMediaType(contentType); err != nil {
		contentType = "application/octet-stream"
	}
	endpoint, err := c.endpoint(endpointPath)
	if err != nil {
		return nil, err
	}
	pipeReader, pipeWriter := io.Pipe()
	multipartWriter := multipart.NewWriter(pipeWriter)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
	header.Set("Content-Type", contentType)
	var prefix bytes.Buffer
	prefixWriter := multipart.NewWriter(&prefix)
	if err := prefixWriter.SetBoundary(multipartWriter.Boundary()); err != nil {
		return nil, err
	}
	if _, err := prefixWriter.CreatePart(header); err != nil {
		return nil, err
	}
	contentLength := int64(prefix.Len()) + size + int64(len("\r\n--"+multipartWriter.Boundary()+"--\r\n"))
	copyResult := make(chan error, 1)
	go func() {
		part, partErr := multipartWriter.CreatePart(header)
		if partErr != nil {
			copyResult <- partErr
			_ = pipeWriter.CloseWithError(partErr)
			return
		}
		written, copyErr := io.Copy(part, io.LimitReader(input, size+1))
		if copyErr != nil {
			copyResult <- copyErr
			_ = pipeWriter.CloseWithError(copyErr)
			return
		}
		if written != size {
			copyResult <- ErrDramaUploadSizeMismatch
			_ = pipeWriter.CloseWithError(ErrDramaUploadSizeMismatch)
			return
		}
		if closeErr := multipartWriter.Close(); closeErr != nil {
			copyResult <- closeErr
			_ = pipeWriter.CloseWithError(closeErr)
			return
		}
		copyResult <- nil
		_ = pipeWriter.Close()
	}()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, pipeReader)
	if err != nil {
		_ = pipeReader.CloseWithError(err)
		<-copyResult
		return nil, err
	}
	request.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	request.ContentLength = contentLength
	request.Header.Set("Accept", "application/json")
	if c.APIToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	response, err := c.writeHTTPClient().Do(request)
	if err != nil {
		_ = pipeReader.CloseWithError(err)
		<-copyResult
		return nil, fmt.Errorf("虾集声线上传请求失败: %w", err)
	}
	defer response.Body.Close()
	if copyErr := <-copyResult; copyErr != nil {
		return nil, copyErr
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("读取虾集声线上传响应失败: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("虾集声线上传返回 %s", response.Status)
	}
	var envelope struct {
		OK   *bool           `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.OK == nil || !*envelope.OK || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, errors.New("虾集声线上传响应无效")
	}
	return rewriteDramaDomainMediaData(c, envelope.Data)
}

func rewriteDramaDomainMediaData(client *DramaClawClient, data json.RawMessage) (json.RawMessage, error) {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, errors.New("虾塘声线响应格式无效")
	}
	rewriteDramaDomainMediaURLs(client, value)
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, errors.New("虾塘声线响应格式无效")
	}
	return encoded, nil
}

var dramaAssetDomainFields = map[string]map[string]bool{
	"characters": {"name": true, "role": true, "is_main": true, "gender": true, "age_group": true, "description": true, "face_prompt": true, "body_type": true, "fish_voice_id": true, "aliases": true},
	"scenes":     {"name": true, "aliases": true, "scene_type": true, "base_scene_id": true, "variant_id": true, "time_of_day": true, "environment_prompt": true, "variant_prompt": true, "description": true, "spatial_layout_image": true, "notes": true},
	"props":      {"name": true, "aliases": true, "prop_type": true, "visual_prompt": true, "description": true, "owner": true, "notes": true},
}

func (c *DramaClawClient) CreateAssetDomainItem(ctx context.Context, projectID, domain string, body json.RawMessage) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := validateDramaAssetDomainBody(projectID, domain, "", body, true); err != nil {
		return nil, err
	}
	return c.postJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/"+domain, json.RawMessage(body))
}

func (c *DramaClawClient) UpdateAssetDomainItem(ctx context.Context, projectID, domain, name string, body json.RawMessage) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if err := validateDramaAssetDomainBody(projectID, domain, name, body, false); err != nil {
		return nil, err
	}
	return c.patchJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/"+domain+"/"+url.PathEscape(name), json.RawMessage(body))
}

func (c *DramaClawClient) DeleteAssetDomainItem(ctx context.Context, projectID, domain, name string) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if !validDramaRouteSegment(projectID) || !validDramaRouteSegment(name) || dramaAssetDomainFields[domain] == nil {
		return nil, errors.New("虾塘素材项目、分类或名称无效")
	}
	return c.postJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/"+domain+"/"+url.PathEscape(name)+"/delete", struct{}{})
}

func validateDramaAssetDomainBody(projectID, domain, name string, body json.RawMessage, creating bool) error {
	if !validDramaRouteSegment(projectID) || dramaAssetDomainFields[domain] == nil || (!creating && !validDramaRouteSegment(name)) {
		return errors.New("虾塘素材项目、分类或名称无效")
	}
	var fields map[string]json.RawMessage
	if len(body) == 0 || json.Unmarshal(body, &fields) != nil || fields == nil {
		return errors.New("虾塘素材请求内容无效")
	}
	if len(fields) == 0 {
		return errors.New("虾塘素材请求内容不能为空")
	}
	for key, raw := range fields {
		if !dramaAssetDomainFields[domain][key] {
			return errors.New("虾塘素材请求包含不支持的字段")
		}
		if key == "aliases" {
			var aliases []string
			if string(raw) != "null" && json.Unmarshal(raw, &aliases) != nil {
				return errors.New("虾塘素材 aliases 必须是字符串列表")
			}
			continue
		}
		if key == "is_main" {
			var value bool
			if string(raw) != "null" && json.Unmarshal(raw, &value) != nil {
				return errors.New("虾塘素材 is_main 必须是布尔值")
			}
			continue
		}
		var value string
		if string(raw) != "null" && json.Unmarshal(raw, &value) != nil {
			return errors.New("虾塘素材文本字段格式无效")
		}
	}
	if creating {
		var itemName string
		if raw, ok := fields["name"]; !ok || json.Unmarshal(raw, &itemName) != nil || strings.TrimSpace(itemName) == "" {
			return errors.New("虾塘素材名称不能为空")
		}
	}
	return nil
}

func ValidateDramaAssetDomainWrite(projectID, domain, name string, body json.RawMessage, creating bool) error {
	return validateDramaAssetDomainBody(projectID, domain, name, body, creating)
}

func validDramaRouteSegment(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || value == "." || value == ".." || strings.ContainsAny(value, `/\\`) {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func rewriteDramaDomainMediaURLs(client *DramaClawClient, value any) {
	switch node := value.(type) {
	case []any:
		for _, item := range node {
			rewriteDramaDomainMediaURLs(client, item)
		}
	case map[string]any:
		for key, item := range node {
			if (key == "url" || strings.HasSuffix(key, "_url")) && !strings.Contains(key, "history") && !strings.Contains(key, "restore") {
				if raw, ok := item.(string); ok && raw != "" {
					node[key] = client.ProxyMediaURL(raw)
					continue
				}
			}
			rewriteDramaDomainMediaURLs(client, item)
		}
	}
}

func (c *DramaClawClient) CreateProject(ctx context.Context, name string) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if !dramaProjectNamePattern.MatchString(name) {
		return nil, errors.New("虾集项目名称须为 1-64 位英文、数字或下划线")
	}
	data, err := c.postJSONData(ctx, "/api/v1/projects", struct {
		Name string `json:"name"`
	}{Name: name})
	if err != nil {
		return nil, err
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(data, &result); err != nil || result == nil {
		return nil, errors.New("虾集新建项目响应无效")
	}
	return data, nil
}

func (c *DramaClawClient) UpdateProjectLifecycle(ctx context.Context, projectID, action string) (json.RawMessage, error) {
	if c == nil || c.BaseURL == "" {
		return nil, errors.New("未配置 DRAMACLAW_BASE_URL")
	}
	if strings.TrimSpace(projectID) == "" {
		return nil, errors.New("虾集项目 ID 不能为空")
	}
	switch action {
	case "archive", "unarchive", "delete", "restore", "purge":
	default:
		return nil, errors.New("不支持的虾集项目操作")
	}
	return c.postJSONData(ctx, "/api/v1/projects/"+url.PathEscape(projectID)+"/"+action, struct{}{})
}

type dramaFreezoneAssetWire struct {
	ID          string          `json:"id"`
	Tab         string          `json:"tab"`
	Kind        string          `json:"kind"`
	Role        string          `json:"role"`
	Label       string          `json:"label"`
	Sublabel    string          `json:"sublabel"`
	RelPath     string          `json:"rel_path"`
	URL         string          `json:"url"`
	Exists      bool            `json:"exists"`
	MediaType   string          `json:"media_type"`
	AspectRatio string          `json:"aspect_ratio"`
	Meta        map[string]any  `json:"meta"`
	SlotTarget  json.RawMessage `json:"slot_target"`
	Pushable    *bool           `json:"pushable"`
	HistoryURL  string          `json:"history_url"`
	RestoreURL  string          `json:"restore_url"`
}

type dramaBeatContextWire struct {
	Assets json.RawMessage `json:"assets"`
}

func (c *DramaClawClient) normalizeDramaImportAssets(data json.RawMessage) ([]DramaImportAsset, error) {
	var raw []dramaFreezoneAssetWire
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("解析虾集素材目录失败: %w", err)
	}
	return c.normalizeDramaAssetRecords(raw), nil
}

func (c *DramaClawClient) normalizeDramaBeatContextAssets(data json.RawMessage) ([]DramaImportAsset, error) {
	var context dramaBeatContextWire
	if err := json.Unmarshal(data, &context); err != nil {
		return nil, fmt.Errorf("解析虾集分镜素材上下文失败: %w", err)
	}
	if len(context.Assets) == 0 || string(context.Assets) == "null" {
		return []DramaImportAsset{}, nil
	}
	var raw []dramaFreezoneAssetWire
	if err := json.Unmarshal(context.Assets, &raw); err != nil {
		return nil, fmt.Errorf("解析虾集分镜素材列表失败: %w", err)
	}
	return c.normalizeDramaAssetRecords(raw), nil
}

func (c *DramaClawClient) normalizeDramaAssetRecords(raw []dramaFreezoneAssetWire) []DramaImportAsset {
	assets := make([]DramaImportAsset, 0, len(raw))
	for _, item := range raw {
		asset := DramaImportAsset{
			ID:               item.ID,
			Tab:              item.Tab,
			Kind:             item.Kind,
			Role:             item.Role,
			Label:            item.Label,
			Sublabel:         item.Sublabel,
			RelPath:          item.RelPath,
			Exists:           item.Exists,
			MediaType:        item.MediaType,
			AspectRatio:      item.AspectRatio,
			Meta:             item.Meta,
			SlotTarget:       item.SlotTarget,
			Pushable:         item.Pushable,
			HistoryAvailable: item.HistoryURL != "",
			RestoreAvailable: item.RestoreURL != "",
		}
		if item.Exists {
			asset.URL = c.ProxyMediaURL(item.URL)
		}
		assets = append(assets, asset)
	}
	return assets
}

func (c *DramaClawClient) getData(ctx context.Context, path string) (json.RawMessage, error) {
	endpoint, err := c.endpoint(path)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.APIToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("虾集接口请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("虾集接口返回 %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("读取虾集响应失败: %w", err)
	}
	var envelope struct {
		OK   *bool           `json:"ok"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("解析虾集响应失败: %w", err)
	}
	if envelope.OK != nil && !*envelope.OK {
		if envelope.Msg != "" {
			return nil, errors.New(envelope.Msg)
		}
		return nil, errors.New("虾集接口返回失败")
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, errors.New("虾集响应缺少 data")
	}
	return envelope.Data, nil
}

func (c *DramaClawClient) endpoint(path string) (string, error) {
	base, err := url.Parse(c.BaseURL)
	if err != nil || base.Scheme == "" || base.Host == "" || (base.Scheme != "http" && base.Scheme != "https") {
		return "", errors.New("DRAMACLAW_BASE_URL 无效")
	}
	return strings.TrimRight(c.BaseURL, "/") + "/" + strings.TrimLeft(path, "/"), nil
}

func (c *DramaClawClient) sameOrigin(target *url.URL) bool {
	base, err := url.Parse(c.BaseURL)
	if err != nil || target == nil {
		return false
	}
	return strings.EqualFold(base.Scheme, target.Scheme) && strings.EqualFold(base.Host, target.Host)
}

func (c *DramaClawClient) FetchMedia(ctx context.Context, target string) (*http.Response, error) {
	parsed, err := url.Parse(target)
	if err != nil || !c.sameOrigin(parsed) {
		return nil, errors.New("媒体地址不属于已配置的虾集服务")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	if c.APIToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIToken)
	}
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("虾集媒体请求失败: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		resp.Body.Close()
		return nil, fmt.Errorf("虾集媒体返回 %s", resp.Status)
	}
	return resp, nil
}

func (c *DramaClawClient) rewriteMediaURLs(catalog *DramaImportCatalog) {
	c.rewriteAssetURLs(catalog.Assets)
	c.rewriteAssetURLs(catalog.BeatContextAssets)
	for episodeIndex := range catalog.Episodes {
		for beatIndex := range catalog.Episodes[episodeIndex].Beats {
			beat := &catalog.Episodes[episodeIndex].Beats[beatIndex]
			beat.SketchURL = c.ProxyMediaURL(beat.SketchURL)
			beat.FrameURL = c.ProxyMediaURL(beat.FrameURL)
			beat.VideoURL = c.ProxyMediaURL(beat.VideoURL)
			beat.AudioURL = c.ProxyMediaURL(beat.AudioURL)
		}
	}
}

func (c *DramaClawClient) rewriteAssetURLs(assets []DramaImportAsset) {
	for index := range assets {
		assets[index].URL = c.ProxyMediaURL(assets[index].URL)
	}
}

func (c *DramaClawClient) ProxyMediaURL(raw string) string {
	if strings.TrimSpace(raw) == "" || strings.HasPrefix(raw, "/api/v1/drama/media?") {
		return raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if !parsed.IsAbs() {
		base, baseErr := url.Parse(c.BaseURL)
		if baseErr != nil {
			return ""
		}
		parsed = base.ResolveReference(parsed)
	}
	if !c.sameOrigin(parsed) {
		return ""
	}
	return "/api/v1/drama/media?url=" + url.QueryEscape(parsed.String())
}

type dramaEpisodeWire struct {
	Number      int             `json:"number"`
	Title       string          `json:"title"`
	Summary     string          `json:"summary"`
	BeatCount   int             `json:"beat_count"`
	IdentityIDs json.RawMessage `json:"identity_ids"`
	SceneMenu   json.RawMessage `json:"scene_menu"`
	PropMenu    json.RawMessage `json:"prop_menu"`
}

func normalizeDramaEpisodes(data json.RawMessage) ([]DramaImportEpisode, error) {
	var raw []dramaEpisodeWire
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("解析虾集集数失败: %w", err)
	}
	episodes := make([]DramaImportEpisode, 0, len(raw))
	for _, item := range raw {
		episodes = append(episodes, DramaImportEpisode{
			Number:      item.Number,
			Title:       item.Title,
			Summary:     item.Summary,
			BeatCount:   item.BeatCount,
			IdentityIDs: normalizeStringList(item.IdentityIDs),
			SceneIDs:    normalizeStringList(item.SceneMenu),
			PropIDs:     normalizeStringList(item.PropMenu),
			Beats:       []DramaImportBeat{},
		})
	}
	return episodes, nil
}

type dramaBeatWire struct {
	Episode              int             `json:"episode"`
	BeatNumber           int             `json:"beat_number"`
	Number               int             `json:"number"`
	Title                string          `json:"title"`
	Name                 string          `json:"name"`
	Content              string          `json:"content"`
	Description          string          `json:"description"`
	Text                 string          `json:"text"`
	Prompt               string          `json:"prompt"`
	VisualDescription    string          `json:"visual_description"`
	VisualDescriptionAlt string          `json:"visualDescription"`
	KeyframePrompt       string          `json:"keyframe_prompt"`
	KeyframePromptAlt    string          `json:"keyframePrompt"`
	VideoPrompt          string          `json:"video_prompt"`
	VideoPromptAlt       string          `json:"videoPrompt"`
	AudioPrompt          string          `json:"audio_prompt"`
	AudioPromptAlt       string          `json:"audioPrompt"`
	VideoMode            string          `json:"video_mode"`
	VideoModeAlt         string          `json:"videoMode"`
	DurationSeconds      float64         `json:"duration_seconds"`
	DurationSecondsAlt   float64         `json:"durationSeconds"`
	SceneID              string          `json:"scene_id"`
	IdentityIDs          json.RawMessage `json:"identity_ids"`
	PropIDs              json.RawMessage `json:"prop_ids"`
	SketchURL            string          `json:"sketch_url"`
	FrameURL             string          `json:"frame_url"`
	VideoURL             string          `json:"video_url"`
	AudioURL             string          `json:"audio_url"`
	AudioDurationSeconds float64         `json:"audio_duration_seconds"`
}

func normalizeDramaBeats(data json.RawMessage, episode int) ([]DramaImportBeat, error) {
	var raw []dramaBeatWire
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("解析虾集分镜失败: %w", err)
	}
	beats := make([]DramaImportBeat, 0, len(raw))
	for _, item := range raw {
		beatNumber := item.BeatNumber
		if beatNumber == 0 {
			beatNumber = item.Number
		}
		title := item.Title
		if title == "" {
			title = item.Name
		}
		content := item.Content
		if content == "" {
			content = item.Description
		}
		if content == "" {
			content = item.Text
		}
		itemEpisode := item.Episode
		if itemEpisode == 0 {
			itemEpisode = episode
		}
		beats = append(beats, DramaImportBeat{
			Episode:              itemEpisode,
			BeatNumber:           beatNumber,
			Title:                title,
			Content:              content,
			Prompt:               item.Prompt,
			VisualDescription:    firstNonEmpty(item.VisualDescription, item.VisualDescriptionAlt),
			KeyframePrompt:       firstNonEmpty(item.KeyframePrompt, item.KeyframePromptAlt),
			VideoPrompt:          firstNonEmpty(item.VideoPrompt, item.VideoPromptAlt),
			AudioPrompt:          firstNonEmpty(item.AudioPrompt, item.AudioPromptAlt),
			VideoMode:            firstNonEmpty(item.VideoMode, item.VideoModeAlt),
			DurationSeconds:      firstPositive(item.DurationSeconds, item.DurationSecondsAlt),
			SceneID:              item.SceneID,
			IdentityIDs:          normalizeStringList(item.IdentityIDs),
			PropIDs:              normalizeStringList(item.PropIDs),
			SketchURL:            item.SketchURL,
			FrameURL:             item.FrameURL,
			VideoURL:             item.VideoURL,
			AudioURL:             item.AudioURL,
			AudioDurationSeconds: item.AudioDurationSeconds,
		})
	}
	return beats, nil
}

func normalizeStringList(data json.RawMessage) []string {
	if len(data) == 0 || string(data) == "null" {
		return []string{}
	}
	var stringsValue []string
	if json.Unmarshal(data, &stringsValue) == nil {
		return stringsValue
	}
	var singleValue string
	if json.Unmarshal(data, &singleValue) == nil && singleValue != "" {
		return []string{singleValue}
	}
	var objects []map[string]any
	if json.Unmarshal(data, &objects) != nil {
		return []string{}
	}
	result := make([]string, 0, len(objects))
	for _, item := range objects {
		for _, key := range []string{"id", "key", "name", "title"} {
			if value, ok := item[key].(string); ok && value != "" {
				result = append(result, value)
				break
			}
		}
	}
	return result
}

func dramaRevision(parts ...[]byte) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = hash.Write(part)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func firstPositive(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}
