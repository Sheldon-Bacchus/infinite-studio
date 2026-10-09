package works

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"mime"
	"path/filepath"
	"strings"
)

// MediaFormat 定义媒体的大类与规范扩展名
type MediaFormat struct {
	Kind      string
	Extension string
}

// mimeToFormatMap 依据标准 MIME 类型决定规范安全扩展名与统一媒体大类
var mimeToFormatMap = map[string]MediaFormat{
	// 文本 (text)
	"text/plain":       {Kind: MediaKindText, Extension: ".txt"},
	"application/json": {Kind: MediaKindText, Extension: ".json"},
	"text/markdown":    {Kind: MediaKindText, Extension: ".md"},

	// 图像 (image)
	"image/png":  {Kind: MediaKindImage, Extension: ".png"},
	"image/jpeg": {Kind: MediaKindImage, Extension: ".jpg"},
	"image/webp": {Kind: MediaKindImage, Extension: ".webp"},
	"image/gif":  {Kind: MediaKindImage, Extension: ".gif"},

	// 视频 (video)
	"video/mp4":       {Kind: MediaKindVideo, Extension: ".mp4"},
	"video/webm":      {Kind: MediaKindVideo, Extension: ".webm"},
	"video/quicktime": {Kind: MediaKindVideo, Extension: ".mov"},

	// 音频 (audio)
	"audio/mpeg":  {Kind: MediaKindAudio, Extension: ".mp3"},
	"audio/mp3":   {Kind: MediaKindAudio, Extension: ".mp3"},
	"audio/wav":   {Kind: MediaKindAudio, Extension: ".wav"},
	"audio/x-wav": {Kind: MediaKindAudio, Extension: ".wav"},
	"audio/ogg":   {Kind: MediaKindAudio, Extension: ".ogg"},
	"audio/mp4":   {Kind: MediaKindAudio, Extension: ".m4a"},
	"audio/aac":   {Kind: MediaKindAudio, Extension: ".aac"},
	"audio/flac":  {Kind: MediaKindAudio, Extension: ".flac"},
}

// ExtToFormatMap 扩展名反查格式映射，用于已有原件复用时的格式冲突核验
var ExtToFormatMap = map[string]MediaFormat{
	".txt":  {Kind: MediaKindText, Extension: ".txt"},
	".json": {Kind: MediaKindText, Extension: ".json"},
	".md":   {Kind: MediaKindText, Extension: ".md"},
	".png":  {Kind: MediaKindImage, Extension: ".png"},
	".jpg":  {Kind: MediaKindImage, Extension: ".jpg"},
	".jpeg": {Kind: MediaKindImage, Extension: ".jpg"},
	".webp": {Kind: MediaKindImage, Extension: ".webp"},
	".gif":  {Kind: MediaKindImage, Extension: ".gif"},
	".mp4":  {Kind: MediaKindVideo, Extension: ".mp4"},
	".webm": {Kind: MediaKindVideo, Extension: ".webm"},
	".mov":  {Kind: MediaKindVideo, Extension: ".mov"},
	".mp3":  {Kind: MediaKindAudio, Extension: ".mp3"},
	".wav":  {Kind: MediaKindAudio, Extension: ".wav"},
	".ogg":  {Kind: MediaKindAudio, Extension: ".ogg"},
	".m4a":  {Kind: MediaKindAudio, Extension: ".m4a"},
	".aac":  {Kind: MediaKindAudio, Extension: ".aac"},
	".flac": {Kind: MediaKindAudio, Extension: ".flac"},
}

// AllSafeMediaExtensions 列出系统中全部受支持的已知安全媒体扩展名
var AllSafeMediaExtensions = []string{
	".txt", ".json", ".md",
	".png", ".jpg", ".jpeg", ".webp", ".gif",
	".mp4", ".webm", ".mov",
	".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac",
}

// ValidateStorageID 校验存储标识符。
// 规则：固定 32 位全小写十六进制 ASCII [0-9a-f]{32}。
func ValidateStorageID(id string) error {
	if len(id) != 32 {
		return fmt.Errorf("%w: ID 长度必须精确为 32 位 (实际 %d)", ErrInvalidID, len(id))
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return fmt.Errorf("%w: ID 包含非法字符 %q，仅允许小写十六进制 [0-9a-f]", ErrInvalidID, string(c))
		}
	}
	return nil
}

// ValidateHashID 校验内容摘要标识符（如 SHA-256、revisionId）。
// 规则：固定 64 位全小写十六进制 ASCII [0-9a-f]{64}。
func ValidateHashID(hash string) error {
	if len(hash) != 64 {
		return fmt.Errorf("%w: 哈希长度必须精确为 64 位 (实际 %d)", ErrInvalidHash, len(hash))
	}
	for i := 0; i < len(hash); i++ {
		c := hash[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return fmt.Errorf("%w: 哈希包含非法字符 %q，仅允许小写十六进制 [0-9a-f]", ErrInvalidHash, string(c))
		}
	}
	return nil
}

// GenerateStorageID 生成 32 字符（16 字节）的小写十六进制随机存储标识符
func GenerateStorageID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("生成随机存储 ID 失败: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// NormalizeMediaExtension 使用标准 mime.ParseMediaType 解析后匹配已知映射决定规范 ext/kind。
// 移除文件名 fallback，必须声明有效已知的 MIME 类型。
func NormalizeMediaExtension(rawMIME string) (safeExt string, kind string, err error) {
	cleanMIME := strings.TrimSpace(rawMIME)
	if cleanMIME == "" {
		return "", "", fmt.Errorf("%w: MIME 类型不能为空", ErrInvalidRequest)
	}

	mediatype, _, parseErr := mime.ParseMediaType(cleanMIME)
	if parseErr != nil {
		return "", "", fmt.Errorf("%w: MIME 类型解析失败 (%s): %v", ErrInvalidRequest, cleanMIME, parseErr)
	}

	fmtInfo, ok := mimeToFormatMap[mediatype]
	if !ok {
		return "", "", fmt.Errorf("%w: 不受支持的媒体 MIME 类型: %s", ErrInvalidRequest, mediatype)
	}

	return fmtInfo.Extension, fmtInfo.Kind, nil
}

func isDOSDeviceName(name string) bool {
	upper := strings.ToUpper(name)
	base := upper
	if dotIdx := strings.IndexByte(upper, '.'); dotIdx != -1 {
		base = upper[:dotIdx]
	}
	switch base {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return true
	}
	return false
}

// validateSafeFilename 严格校验暂存文件名，拒绝冒号、绝对路径、斜杠反斜杠、ADS 备用数据流及 Windows 非法文件名与保留名
func validateSafeFilename(name string) error {
	if name == "" {
		return fmt.Errorf("%w: 暂存文件名不能为空", ErrInvalidRequest)
	}
	if filepath.IsAbs(name) {
		return fmt.Errorf("%w: 暂存文件名不能为绝对路径: %s", ErrInvalidRequest, name)
	}
	// 拒绝冒号（防止 Windows NTFS ADS 注入）、斜杠、反斜杠及 Windows 禁忌字符
	if strings.ContainsAny(name, `/\:*"<>|?`) {
		return fmt.Errorf("%w: 暂存文件名包含非法字符或流指示符: %s", ErrInvalidRequest, name)
	}
	if name == "." || name == ".." || strings.HasPrefix(name, "..") {
		return fmt.Errorf("%w: 暂存文件名不能为相对路径指示符: %s", ErrInvalidRequest, name)
	}
	if strings.HasPrefix(name, " ") || strings.HasSuffix(name, " ") || strings.HasSuffix(name, ".") {
		return fmt.Errorf("%w: 暂存文件名不能以空格或点开头/结尾: %s", ErrInvalidRequest, name)
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c < 32 {
			return fmt.Errorf("%w: 暂存文件名包含控制字符", ErrInvalidRequest)
		}
	}
	if isDOSDeviceName(name) {
		return fmt.Errorf("%w: 暂存文件名不能为 Windows 保留设备名称: %s", ErrInvalidRequest, name)
	}
	return nil
}

// PathLocator 负责管理作品根目录与内部资源的规范路径定位与边界核查
type PathLocator struct {
	root string
}

// NewPathLocator 构造路径定位器，并对根目录执行绝对路径转换、边界核查与重解析点检测
func NewPathLocator(dataRoot string) (*PathLocator, error) {
	if !isWindows() {
		return nil, ErrUnsupportedPlatform
	}

	trimmed := strings.TrimSpace(dataRoot)
	if trimmed == "" {
		return nil, fmt.Errorf("%w: 存储根路径不能为空", ErrInvalidRequest)
	}
	if !filepath.IsAbs(trimmed) {
		return nil, fmt.Errorf("%w: 存储根路径必须为绝对路径 (%s)", ErrInvalidRequest, dataRoot)
	}

	cleanRoot := filepath.Clean(trimmed)

	// 检查根目录及各级父目录直至卷根是否包含重解析点
	if err := checkNoReparsePoint(cleanRoot); err != nil {
		return nil, err
	}

	return &PathLocator{root: cleanRoot}, nil
}

// Root 返回已校验的绝对根目录
func (p *PathLocator) Root() string {
	return p.root
}

// RootManifestPath 返回根目录标识清单 root.json 绝对路径
func (p *PathLocator) RootManifestPath() (string, error) {
	target := filepath.Join(p.root, "root.json")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// RootStagingManifestPath 返回根目录暂存清单 root.json.tmp 绝对路径并核验安全
func (p *PathLocator) RootStagingManifestPath() (string, error) {
	if err := validateSafeFilename("root.json.tmp"); err != nil {
		return "", err
	}
	target := filepath.Join(p.root, "root.json.tmp")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// WorkStagingManifestPath 返回作品元数据暂存文件 work.json.tmp 绝对路径
func (p *PathLocator) WorkStagingManifestPath(workID string) (string, error) {
	return p.StagingFilePath(workID, "work.json.tmp")
}

// CommitStagingManifestPath 返回提交清单暂存文件 commit_{commitID}.tmp 绝对路径
func (p *PathLocator) CommitStagingManifestPath(workID, commitID string) (string, error) {
	if err := ValidateStorageID(commitID); err != nil {
		return "", err
	}
	return p.StagingFilePath(workID, fmt.Sprintf("commit_%s.tmp", commitID))
}

// RecordStagingPath 返回记录暂存文件 rec_{revisionID}.tmp 绝对路径
func (p *PathLocator) RecordStagingPath(workID, revisionID string) (string, error) {
	if err := ValidateHashID(revisionID); err != nil {
		return "", err
	}
	return p.StagingFilePath(workID, fmt.Sprintf("rec_%s.tmp", revisionID))
}

// MediaStagingPath 返回媒体流暂存文件 media_{tempID}.tmp 绝对路径
func (p *PathLocator) MediaStagingPath(workID, tempID string) (string, error) {
	if err := ValidateStorageID(tempID); err != nil {
		return "", err
	}
	return p.StagingFilePath(workID, fmt.Sprintf("media_%s.tmp", tempID))
}

// LockFilePath 返回全局根独占锁文件路径
func (p *PathLocator) LockFilePath() (string, error) {
	target := filepath.Join(p.root, ".works.lock")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// IndexDBPath 返回作品仓库全局 SQLite 索引文件 index.sqlite 的绝对路径
func (p *PathLocator) IndexDBPath() (string, error) {
	target := filepath.Join(p.root, "index.sqlite")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// BackupsDir 返回仓库级持久备份目录 root/backups/ 绝对路径
func (p *PathLocator) BackupsDir() (string, error) {
	target := filepath.Join(p.root, "backups")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// BackupDir 返回特定备份的目录路径 root/backups/{backupID}
func (p *PathLocator) BackupDir(backupID string) (string, error) {
	if err := ValidateStorageID(backupID); err != nil {
		return "", err
	}
	target := filepath.Join(p.root, "backups", backupID)
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// BackupPackagePath 返回特定备份的原始包文件路径 root/backups/{backupID}/package.zip
func (p *PathLocator) BackupPackagePath(backupID string) (string, error) {
	backupDir, err := p.BackupDir(backupID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(backupDir, "package.zip")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// BackupManifestPath 返回特定备份的清单文件路径 root/backups/{backupID}/manifest.json
func (p *PathLocator) BackupManifestPath(backupID string) (string, error) {
	backupDir, err := p.BackupDir(backupID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(backupDir, "manifest.json")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// WorkspacesDir 返回包含所有作品的 workspaces/ 目录绝对路径
func (p *PathLocator) WorkspacesDir() (string, error) {
	target := filepath.Join(p.root, "workspaces")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// WorkDir 返回特定作品的根目录绝对路径：root/workspaces/workID
func (p *PathLocator) WorkDir(workID string) (string, error) {
	if err := ValidateStorageID(workID); err != nil {
		return "", err
	}
	target := filepath.Join(p.root, "workspaces", workID)
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// WorkManifestPath 返回作品权威元数据 work.json 绝对路径
func (p *PathLocator) WorkManifestPath(workID string) (string, error) {
	workDir, err := p.WorkDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(workDir, "work.json")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// CommitsDir 返回提交目录路径
func (p *PathLocator) CommitsDir(workID string) (string, error) {
	workDir, err := p.WorkDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(workDir, "commits")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// CommitDir 返回特定提交目录路径
func (p *PathLocator) CommitDir(workID, commitID string) (string, error) {
	if err := ValidateStorageID(commitID); err != nil {
		return "", err
	}
	commitsDir, err := p.CommitsDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(commitsDir, commitID)
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// CommitManifestPath 返回特定提交清单 manifest.json 绝对路径
func (p *PathLocator) CommitManifestPath(workID, commitID string) (string, error) {
	commitDir, err := p.CommitDir(workID, commitID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(commitDir, "manifest.json")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// RecordsDir 返回不可变记录目录路径
func (p *PathLocator) RecordsDir(workID string) (string, error) {
	workDir, err := p.WorkDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(workDir, "records")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// RecordPath 返回特定不可变记录 records/{revisionId}.json 绝对路径（revisionID 为 64 位内容哈希）
func (p *PathLocator) RecordPath(workID, revisionID string) (string, error) {
	if err := ValidateHashID(revisionID); err != nil {
		return "", err
	}
	recordsDir, err := p.RecordsDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(recordsDir, revisionID+".json")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// MediaDir 返回媒体物理原件目录路径
func (p *PathLocator) MediaDir(workID string) (string, error) {
	workDir, err := p.WorkDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(workDir, "media")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// MediaPath 返回媒体物理文件 media/{sha256}.{ext} 绝对路径
func (p *PathLocator) MediaPath(workID, sha256Hex, safeExt string) (string, error) {
	if err := ValidateHashID(sha256Hex); err != nil {
		return "", err
	}
	validExt := false
	for _, ext := range AllSafeMediaExtensions {
		if ext == safeExt {
			validExt = true
			break
		}
	}
	if !validExt {
		return "", fmt.Errorf("%w: 不受支持的扩展名 %q", ErrInvalidRequest, safeExt)
	}

	mediaDir, err := p.MediaDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(mediaDir, sha256Hex+safeExt)
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// StagingDir 返回同卷暂存目录路径
func (p *PathLocator) StagingDir(workID string) (string, error) {
	workDir, err := p.WorkDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(workDir, "staging")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// StagingFilePath 返回暂存目录下特定文件的绝对路径，严格校验文件名合法性与重解析点
func (p *PathLocator) StagingFilePath(workID, filename string) (string, error) {
	if err := validateSafeFilename(filename); err != nil {
		return "", err
	}
	stagingDir, err := p.StagingDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(stagingDir, filename)
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// InboxDir 返回作品手动导入收件箱目录路径 root/workspaces/{workID}/inbox
func (p *PathLocator) InboxDir(workID string) (string, error) {
	workDir, err := p.WorkDir(workID)
	if err != nil {
		return "", err
	}
	target := filepath.Join(workDir, "inbox")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// RootStagingDir 返回根目录全局暂存目录 root/staging
func (p *PathLocator) RootStagingDir() (string, error) {
	target := filepath.Join(p.root, "staging")
	if err := p.verifyPath(target); err != nil {
		return "", err
	}
	return target, nil
}

// verifyPath 综合检查路径边界与重解析点，不设 260 硬限制，真实报告 OS 错误
func (p *PathLocator) verifyPath(target string) error {
	cleanTarget := filepath.Clean(target)

	// 1. 根边界核验：确保目标路径必须位于 root 内部
	rel, err := filepath.Rel(p.root, cleanTarget)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrPathOutOfBounds, err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("%w: 路径 %s 超出工作区根 %s", ErrPathOutOfBounds, target, p.root)
	}

	// 2. 检查重解析点（包含现有路径与各级祖先）
	if err := checkNoReparsePoint(cleanTarget); err != nil {
		return err
	}

	return nil
}
