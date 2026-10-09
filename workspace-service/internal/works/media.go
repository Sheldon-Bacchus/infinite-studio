package works

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"
)

// RegisterMedia 实现作品内流式原件上传、SHA-256 计算、跨格式物理去重与元数据登记。
// 规则：
// 1. 必须先确认目标 work 存在；空流直接拒绝（writtenBytes == 0）。
// 2. 严格以 mime.ParseMediaType 解析后的规范 MIME 决定规范 ext/kind，不进行原文件名 fallback；原文件名仅保留在 descriptor.originalFilename 中作为展示元数据。
// 3. 客户绝不可指定物理存储路径。
// 4. 同 hash 物理原件复用：检查已有 hash 对应的安全扩展名，核验字节与摘要；若格式与请求 MIME 冲突则拒绝报错（ErrConflict），不返回不一致的 descriptor；若内容与哈希不符报 ErrMediaHashMismatch。
// 5. 生成 32 位 hex 的逻辑 fileId，与 64 位 hex 的物理 sha256 互相独立。
// 6. 原件发布后返回 MediaDescriptor；未随 Commit 提交到 work.json 前，不可作为已提交的业务权威结果。
func (s *Store) RegisterMedia(workID string, r io.Reader, originalFilename, mimeType string) (*MediaDescriptor, error) {
	if err := s.beginOp(); err != nil {
		return nil, err
	}
	defer s.endOp()

	s.maintenanceMu.RLock()
	defer s.maintenanceMu.RUnlock()

	if err := ValidateStorageID(workID); err != nil {
		return nil, err
	}
	if r == nil {
		return nil, fmt.Errorf("%w: 媒体数据读取流不能为空", ErrInvalidRequest)
	}

	// 1. 确认目标作品存在（使用 private 无 beginOp helper）
	if _, err := s.getWork(workID); err != nil {
		return nil, err
	}

	workLock := s.getWorkLock(workID)
	workLock.Lock()
	defer workLock.Unlock()

	return s.registerMediaLocked(workID, r, originalFilename, mimeType)
}

// registerMediaLocked 在持有 workLock 且目标作品已确认存在的前提下，执行媒体流式登记与物理去重内核
func (s *Store) registerMediaLocked(workID string, r io.Reader, originalFilename, mimeType string) (*MediaDescriptor, error) {
	if r == nil {
		return nil, fmt.Errorf("%w: 媒体数据读取流不能为空", ErrInvalidRequest)
	}

	// 2. 以标准解析后的 MIME 决定规范 ext 与 kind，不使用原文件名 fallback
	safeExt, kind, err := NormalizeMediaExtension(mimeType)
	if err != nil {
		return nil, err
	}

	tempID, err := GenerateStorageID()
	if err != nil {
		return nil, err
	}

	stagingFile, err := s.locator.MediaStagingPath(workID, tempID)
	if err != nil {
		return nil, err
	}

	if err := checkNoReparsePoint(stagingFile); err != nil {
		return nil, err
	}

	// 必须使用排他创建 O_CREATE|O_EXCL，防止静默截断已存在的暂存文件
	f, err := os.OpenFile(stagingFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("排他创建暂存媒体文件失败: %w", err)
	}

	// 流式边写入边计算 SHA-256，内存缓冲区极小 (约 32KB)
	hasher := sha256.New()
	mw := io.MultiWriter(f, hasher)
	writtenBytes, err := io.Copy(mw, r)
	if err != nil {
		f.Close()
		_ = os.Remove(stagingFile)
		return nil, fmt.Errorf("流式写入媒体数据失败: %w", err)
	}

	// 拒绝空数据流
	if writtenBytes == 0 {
		f.Close()
		_ = os.Remove(stagingFile)
		return nil, fmt.Errorf("%w: 媒体数据流为空（0 字节）", ErrInvalidRequest)
	}

	if err := f.Sync(); err != nil {
		f.Close()
		_ = os.Remove(stagingFile)
		return nil, fmt.Errorf("刷盘暂存媒体文件失败: %w", err)
	}

	if err := f.Close(); err != nil {
		_ = os.Remove(stagingFile)
		return nil, fmt.Errorf("关闭暂存媒体文件失败: %w", err)
	}

	// 校验新建暂存文件非重解析点
	if err := checkNoReparsePoint(stagingFile); err != nil {
		_ = os.Remove(stagingFile)
		return nil, err
	}

	sha256Hex := hex.EncodeToString(hasher.Sum(nil))

	// 3. 检查作品内是否已存在相同 SHA-256 的物理原件；候选路径出错与 Lstat 非不存在错误必须直接报错
	var matchedPath string
	for _, ext := range AllSafeMediaExtensions {
		candidatePath, err := s.locator.MediaPath(workID, sha256Hex, ext)
		if err != nil {
			_ = os.Remove(stagingFile)
			return nil, fmt.Errorf("核验候选媒体路径失败 (%s): %w", ext, err)
		}

		fi, err := os.Lstat(candidatePath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			// 权限不足、IO 等错误绝不能吞没忽略，直接报错
			_ = os.Remove(stagingFile)
			return nil, fmt.Errorf("核验候选物理原件状态失败 (%s): %w", candidatePath, err)
		}

		// 发现已有物理原件，核验大小与摘要
		if fi.Size() != writtenBytes {
			_ = os.Remove(stagingFile)
			return nil, fmt.Errorf("%w: 已有物理文件大小 (%d) 与当前流式写入大小 (%d) 不一致", ErrMediaHashMismatch, fi.Size(), writtenBytes)
		}

		existingHash, hashErr := hashFileStream(candidatePath)
		if hashErr != nil {
			_ = os.Remove(stagingFile)
			return nil, fmt.Errorf("校验已有媒体物理文件摘要失败: %w", hashErr)
		}

		if existingHash != sha256Hex {
			_ = os.Remove(stagingFile)
			return nil, fmt.Errorf("%w: 已有物理文件内容哈希 (%s) 与当前摘要 (%s) 不符", ErrMediaHashMismatch, existingHash, sha256Hex)
		}

		// 核验格式是否与请求的 MIME 一致，若冲突则拒绝复用报错，不返回不一致的描述符
		existingFmt, ok := ExtToFormatMap[ext]
		if !ok || existingFmt.Kind != kind || existingFmt.Extension != safeExt {
			_ = os.Remove(stagingFile)
			return nil, fmt.Errorf("%w: 相同摘要的已有物理文件格式 (%s/%s) 与请求 MIME 格式 (%s/%s) 冲突", ErrConflict, existingFmt.Kind, existingFmt.Extension, kind, safeExt)
		}

		matchedPath = candidatePath
		break
	}

	if matchedPath != "" {
		// 已有物理文件完全一致且格式兼容，清理暂存文件，复用物理原件
		_ = os.Remove(stagingFile)
	} else {
		// 不存在任何相同哈希的原件：使用无覆盖原语发布到 media/ 目录
		destPath, err := s.locator.MediaPath(workID, sha256Hex, safeExt)
		if err != nil {
			_ = os.Remove(stagingFile)
			return nil, err
		}
		if err := moveFileNoReplace(stagingFile, destPath); err != nil {
			_ = os.Remove(stagingFile)
			return nil, fmt.Errorf("发布媒体物理文件至 %s 失败: %w", destPath, err)
		}
	}

	// 4. 生成独立的 32 位 hex 逻辑 fileId
	fileID, err := GenerateStorageID()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	desc := &MediaDescriptor{
		FileID:           fileID,
		WorkID:           workID,
		SHA256:           sha256Hex,
		Bytes:            writtenBytes,
		MIMEType:         mimeType,
		Kind:             kind,
		Extension:        safeExt,
		OriginalFilename: originalFilename,
		CreatedAt:        now,
	}

	return desc, nil
}

// GetMediaFile 根据当前已提交权威清单中登记的逻辑 fileId 定位并打开物理原件。
// 规则：原件读取只能从已提交的记录去取，绝不开放直读未提交原件的公共接口。
func (s *Store) GetMediaFile(workID, fileID string) (io.ReadCloser, *MediaDescriptor, error) {
	if err := s.beginOp(); err != nil {
		return nil, nil, err
	}
	defer s.endOp()

	if err := ValidateStorageID(workID); err != nil {
		return nil, nil, err
	}
	if err := ValidateStorageID(fileID); err != nil {
		return nil, nil, err
	}

	_, _, records, err := s.getWorkSnapshot(workID)
	if err != nil {
		return nil, nil, err
	}

	rec, exists := records[fileID]
	if !exists || rec.Type != RecordTypeMedia {
		return nil, nil, fmt.Errorf("%w: 媒体文件记录 %s 不存在或尚未随 Commit 提交登记", ErrWorkNotFound, fileID)
	}

	var desc MediaDescriptor
	if err := decodeStrictJSONBytes(rec.Data, &desc); err != nil {
		return nil, nil, fmt.Errorf("%w: 媒体记录数据损坏: %v", ErrCorruptData, err)
	}

	if desc.FileID != fileID || desc.WorkID != workID {
		return nil, nil, fmt.Errorf("%w: 媒体描述符身份不匹配 (fileId=%s, workId=%s)", ErrCorruptData, desc.FileID, desc.WorkID)
	}
	if err := ValidateStorageID(desc.FileID); err != nil {
		return nil, nil, fmt.Errorf("%w: 媒体描述符 fileId 格式非法: %v", ErrCorruptData, err)
	}
	if err := ValidateHashID(desc.SHA256); err != nil {
		return nil, nil, fmt.Errorf("%w: 媒体描述符 sha256 格式非法: %v", ErrCorruptData, err)
	}
	if desc.Bytes <= 0 {
		return nil, nil, fmt.Errorf("%w: 媒体描述符字节数非法 (%d)", ErrCorruptData, desc.Bytes)
	}
	safeExt, kind, err := NormalizeMediaExtension(desc.MIMEType)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: 媒体描述符 MIME 类型非法: %v", ErrCorruptData, err)
	}
	if desc.Extension != safeExt || desc.Kind != kind {
		return nil, nil, fmt.Errorf("%w: 媒体描述符格式不一致 (mime=%s, ext=%s vs %s, kind=%s vs %s)", ErrCorruptData, desc.MIMEType, desc.Extension, safeExt, desc.Kind, kind)
	}

	path, err := s.locator.MediaPath(workID, desc.SHA256, desc.Extension)
	if err != nil {
		return nil, nil, err
	}

	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, fmt.Errorf("%w: 物理媒体原件丢失 (%s)", ErrWorkNotFound, path)
		}
		return nil, nil, fmt.Errorf("打开媒体物理原件失败: %w", err)
	}

	return f, &desc, nil
}

// CreateMediaRecordChange 辅助函数：将 MediaDescriptor 打包为可供 Commit 提交的 RecordChange
func CreateMediaRecordChange(desc *MediaDescriptor) (RecordChange, error) {
	if desc == nil {
		return RecordChange{}, fmt.Errorf("%w: 媒体描述符为空", ErrInvalidRequest)
	}
	data, err := json.Marshal(desc)
	if err != nil {
		return RecordChange{}, fmt.Errorf("序列化媒体记录失败: %w", err)
	}
	return RecordChange{
		ID:   desc.FileID,
		Type: RecordTypeMedia,
		Data: data,
	}, nil
}

// hashFileStream 以固定小缓冲区流式计算现有文件的 SHA-256 摘要
func hashFileStream(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, f); err != nil {
		return "", err
	}

	return hex.EncodeToString(hasher.Sum(nil)), nil
}
