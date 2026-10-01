package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

// 同一个后端进程内，按内容去重必须覆盖“查询后写入”的整个临界区，
// 否则两个浏览器同时上传同一文件时仍可能各自创建一个对象记录。
var localStorageMu sync.Mutex

// UploadLocalStorageObject 将文件写入固定的本机工作区，并按 SHA-256 去重。
func UploadLocalStorageObject(filename string, contentType string, data []byte) (UploadedStorageObject, error) {
	return UploadLocalStorageReader(filename, contentType, bytes.NewReader(data))
}

// UploadLocalStorageReader streams a multipart body to disk while calculating
// its digest, avoiding a second in-memory copy of large local media files.
func UploadLocalStorageReader(filename string, contentType string, source io.Reader) (UploadedStorageObject, error) {
	localStorageMu.Lock()
	defer localStorageMu.Unlock()

	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}

	directory := strings.TrimSpace(config.Cfg.LocalFilesDir)
	if directory == "" {
		return UploadedStorageObject{}, errors.New("本地文件目录未配置")
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return UploadedStorageObject{}, err
	}
	temporary, err := os.CreateTemp(directory, ".infinite-canvas-upload-*")
	if err != nil {
		return UploadedStorageObject{}, err
	}
	temporaryPath := temporary.Name()
	defer func() {
		if temporaryPath != "" {
			_ = os.Remove(temporaryPath)
		}
	}()
	hasher := sha256.New()
	bytesWritten, err := io.Copy(io.MultiWriter(temporary, hasher), source)
	if err != nil {
		_ = temporary.Close()
		return UploadedStorageObject{}, err
	}
	if bytesWritten == 0 {
		_ = temporary.Close()
		return UploadedStorageObject{}, errors.New("文件内容不能为空")
	}
	if err := temporary.Close(); err != nil {
		return UploadedStorageObject{}, err
	}
	digest := hex.EncodeToString(hasher.Sum(nil))

	if existing, err := repository.FindStorageObjectBySHA256(LocalWorkspaceID, digest); err == nil {
		filePath, pathErr := localStoragePath(existing.ObjectKey)
		if pathErr != nil {
			return UploadedStorageObject{}, pathErr
		}
		if _, statErr := os.Stat(filePath); errors.Is(statErr, os.ErrNotExist) {
			if err := os.Rename(temporaryPath, filePath); err != nil {
				return UploadedStorageObject{}, err
			}
			temporaryPath = ""
		} else if statErr != nil {
			return UploadedStorageObject{}, statErr
		}
		return uploadedLocalStorageObject(existing), nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return UploadedStorageObject{}, err
	}

	ext := safeLocalExtension(filename, contentType)
	objectID := uuid.NewString()
	objectKey := objectID + ext
	filePath, err := localStoragePath(objectKey)
	if err != nil {
		return UploadedStorageObject{}, err
	}
	if err := os.Rename(temporaryPath, filePath); err != nil {
		return UploadedStorageObject{}, err
	}
	temporaryPath = ""

	object := model.StorageObject{
		ID:         objectID,
		ProviderID: "local",
		ObjectKey:  objectKey,
		MimeType:   contentType,
		Bytes:      bytesWritten,
		SHA256:     digest,
		CreatedBy:  LocalWorkspaceID,
		CreatedAt:  now(),
	}
	if _, err := repository.SaveStorageObject(object); err != nil {
		_ = os.Remove(filePath)
		return UploadedStorageObject{}, err
	}
	return uploadedLocalStorageObject(object), nil
}

func DeleteLocalStorageObject(id string) error {
	localStorageMu.Lock()
	defer localStorageMu.Unlock()
	unlockReferences := repository.LockLocalWorkspaceReferences()
	defer unlockReferences()

	object, err := repository.GetStorageObject(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if object.ProviderID != "local" || object.CreatedBy != LocalWorkspaceID {
		return errors.New("不是本地工作区文件")
	}
	referenced, err := repository.LocalWorkspaceStorageObjectReferenced(id)
	if err != nil {
		return err
	}
	if referenced {
		return nil
	}
	filePath, err := localStoragePath(object.ObjectKey)
	if err != nil {
		return err
	}
	if err := os.Remove(filePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return repository.DeleteStorageObjectRecord(id)
}

func DownloadLocalStorageObject(object model.StorageObject, rangeHeader string) (DownloadedStorageObject, error) {
	if object.ProviderID != "local" || object.CreatedBy != LocalWorkspaceID {
		return DownloadedStorageObject{}, errors.New("不是本地工作区文件")
	}
	filePath, err := localStoragePath(object.ObjectKey)
	if err != nil {
		return DownloadedStorageObject{}, err
	}
	file, err := os.Open(filePath)
	if err != nil {
		return DownloadedStorageObject{}, err
	}
	stat, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return DownloadedStorageObject{}, err
	}
	size := stat.Size()
	stream := storageObjectStream{
		Body:          file,
		StatusCode:    200,
		ContentLength: size,
		AcceptRanges:  true,
	}
	if byteRange, ok := parseStorageByteRange(rangeHeader, size); ok {
		if _, err := file.Seek(byteRange.offset, io.SeekStart); err != nil {
			_ = file.Close()
			return DownloadedStorageObject{}, err
		}
		stream.Body = &readCloser{Reader: io.LimitReader(file, byteRange.length), Closer: file}
		stream.StatusCode = 206
		stream.ContentLength = byteRange.length
		stream.ContentRange = fmt.Sprintf("bytes %d-%d/%d", byteRange.offset, byteRange.offset+byteRange.length-1, size)
	}
	if object.Bytes != size {
		object.Bytes = size
	}
	return downloadedStorageObject(object, stream), nil
}

type readCloser struct {
	io.Reader
	io.Closer
}

func uploadedLocalStorageObject(object model.StorageObject) UploadedStorageObject {
	return UploadedStorageObject{
		ID:         object.ID,
		URL:        "/api/files/" + object.ID + "/content",
		StorageKey: "server:" + object.ID,
		Bytes:      object.Bytes,
		MimeType:   object.MimeType,
	}
}

func localStoragePath(objectKey string) (string, error) {
	directory := strings.TrimSpace(config.Cfg.LocalFilesDir)
	if directory == "" {
		return "", errors.New("本地文件目录未配置")
	}
	cleanKey := filepath.Base(objectKey)
	if cleanKey == "." || cleanKey == "" || cleanKey != objectKey {
		return "", errors.New("本地文件路径无效")
	}
	return filepath.Join(directory, cleanKey), nil
}

func safeLocalExtension(filename string, contentType string) string {
	ext := strings.ToLower(filepath.Ext(filepath.Base(filename)))
	if len(ext) > 12 || strings.ContainsAny(ext, `/\\:`) {
		ext = ""
	}
	for _, char := range ext {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '.' && char != '-' && char != '_' {
			ext = ""
			break
		}
	}
	if ext != "" {
		return ext
	}
	return extensionForContentType(contentType)
}
