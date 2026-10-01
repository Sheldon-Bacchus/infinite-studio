package workspace

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
)

func (a *App) uploadFile(w http.ResponseWriter, r *http.Request) {
	a.writeLock.RLock()
	defer a.writeLock.RUnlock()
	part, header, err := r.FormFile("file")
	if err != nil {
		writeAPIError(w, http.StatusUnprocessableEntity, "上传文件参数无效", ErrInvalidRequest)
		return
	}
	defer part.Close()
	filename := safeFilename(header.Filename)
	fileID, err := randomID()
	if err != nil {
		writeRecordError(w, err)
		return
	}
	if requestedID := r.FormValue("fileId"); requestedID != "" {
		if !safeFileID(requestedID) {
			writeAPIError(w, http.StatusUnprocessableEntity, "文件 ID 无效", ErrInvalidRequest)
			return
		}
		fileID = requestedID
	}
	stagingID, err := randomID()
	if err != nil {
		writeRecordError(w, err)
		return
	}
	stagingPath := filepath.Join(a.root, "staging", stagingID+".part")
	staging, err := os.OpenFile(stagingPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		writeRecordError(w, err)
		return
	}
	buffered := bufio.NewReader(part)
	firstBytes, _ := buffered.Peek(512)
	hasher := sha256.New()
	bytesWritten, copyErr := io.Copy(io.MultiWriter(staging, hasher), buffered)
	syncErr := staging.Sync()
	closeErr := staging.Close()
	for _, currentErr := range []error{copyErr, syncErr, closeErr} {
		if currentErr != nil {
			writeRecordError(w, currentErr)
			return
		}
	}
	if bytesWritten == 0 {
		writeAPIError(w, http.StatusUnprocessableEntity, "文件内容不能为空", ErrInvalidRequest)
		return
	}
	detectedType := http.DetectContentType(firstBytes)
	if detectedType == "application/octet-stream" && header.Header.Get("Content-Type") != "" {
		if parsed, _, err := mime.ParseMediaType(header.Header.Get("Content-Type")); err == nil {
			detectedType = parsed
		}
	}
	if detectedType == "" {
		detectedType = "application/octet-stream"
	}
	sha256Value := hex.EncodeToString(hasher.Sum(nil))
	var existing WorkspaceFile
	lookupErr := a.db.Where("workspace_id = ? AND id = ?", a.workspaceID, fileID).Take(&existing).Error
	if lookupErr == nil {
		if existing.State != "ready" || existing.SHA256 != sha256Value || existing.Bytes != bytesWritten || existing.MIMEType != detectedType {
			writeAPIError(w, http.StatusConflict, "文件 ID 已对应不同内容", ErrConflict)
			return
		}
		existingPath, pathErr := safeWorkspacePath(a.root, existing.RelativePath)
		if pathErr != nil {
			writeRecordError(w, pathErr)
			return
		}
		existingHash, existingBytes, hashErr := hashFile(existingPath)
		if hashErr != nil || existingHash != existing.SHA256 || existingBytes != existing.Bytes {
			writeAPIError(w, http.StatusConflict, "已存在的文件原件校验失败", ErrConflict)
			return
		}
		if err := os.Remove(stagingPath); err != nil {
			writeRecordError(w, err)
			return
		}
		writeAPI(w, http.StatusCreated, fileReference(existing))
		return
	}
	if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		writeRecordError(w, lookupErr)
		return
	}
	relativePath := filepath.ToSlash(filepath.Join("files", fileID))
	finalPath := filepath.Join(a.root, filepath.FromSlash(relativePath))
	if _, err := os.Lstat(finalPath); err == nil {
		writeAPIError(w, http.StatusConflict, "文件身份冲突", ErrConflict)
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		writeRecordError(w, err)
		return
	}
	if err := os.Rename(stagingPath, finalPath); err != nil {
		writeRecordError(w, err)
		return
	}
	entry := WorkspaceFile{
		ID: fileID, WorkspaceID: a.workspaceID, RelativePath: relativePath,
		SHA256: sha256Value, MIMEType: detectedType,
		Bytes: bytesWritten, Filename: filename, State: "ready",
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	dbErr := a.db.Create(&entry).Error
	if dbErr != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "文件已落盘但登记失败，原件已保留待恢复", dbErr)
		return
	}
	writeAPI(w, http.StatusCreated, fileReference(entry))
}

func fileReference(file WorkspaceFile) FileReference {
	return FileReference{
		FileID: file.ID, StorageKey: "file:" + file.ID, SHA256: file.SHA256,
		Bytes: file.Bytes, MIMEType: file.MIMEType, URL: "/api/files/" + file.ID + "/content",
	}
}

func safeFileID(id string) bool {
	if id == "" {
		return false
	}
	for _, char := range id {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '_' || char == '-') {
			return false
		}
	}
	return true
}

func hashFile(filePath string) (string, int64, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hasher := sha256.New()
	bytesRead, err := io.Copy(hasher, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hasher.Sum(nil)), bytesRead, nil
}

func (a *App) fileContent(w http.ResponseWriter, r *http.Request, id string) {
	if id == "" || strings.Contains(id, "/") {
		writeAPIError(w, http.StatusNotFound, "工作区文件不存在", ErrRecordNotFound)
		return
	}
	var entry WorkspaceFile
	err := a.db.Where("workspace_id = ? AND id = ? AND state = ?", a.workspaceID, id, "ready").Take(&entry).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeAPIError(w, http.StatusNotFound, "工作区文件不存在", ErrRecordNotFound)
		return
	}
	if err != nil {
		writeRecordError(w, err)
		return
	}
	filePath, err := safeWorkspacePath(a.root, entry.RelativePath)
	if err != nil {
		writeRecordError(w, err)
		return
	}
	file, err := os.Open(filePath)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "工作区原件缺失", ErrRecordNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeAPIError(w, http.StatusNotFound, "工作区原件缺失", ErrRecordNotFound)
		return
	}
	w.Header().Set("Content-Type", entry.MIMEType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": entry.Filename}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, entry.Filename, info.ModTime(), file)
}

func safeFilename(filename string) string {
	filename = strings.ReplaceAll(filename, "\\", "/")
	filename = path.Base(filename)
	if filename == "." || filename == "/" || filename == "" {
		return "upload"
	}
	return filename
}

func safeWorkspacePath(root, relative string) (string, error) {
	if filepath.IsAbs(relative) || strings.Contains(relative, "\\") {
		return "", errors.New("工作区文件路径无效")
	}
	clean := filepath.Clean(filepath.FromSlash(relative))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("工作区文件路径越界")
	}
	if !strings.HasPrefix(clean, "files"+string(filepath.Separator)) {
		return "", errors.New("原件路径必须位于 files 目录")
	}
	full := filepath.Join(root, clean)
	if !pathContains(root, full) {
		return "", errors.New("工作区文件路径越界")
	}
	current := root
	relativeParts := strings.Split(clean, string(filepath.Separator))
	for index, part := range relativeParts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 || index < len(relativeParts)-1 && !info.IsDir() {
			return "", fmt.Errorf("工作区文件路径包含链接或非目录组件")
		}
	}
	return full, nil
}
