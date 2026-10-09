//go:build windows

package works

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modKernel32      = windows.NewLazySystemDLL("kernel32.dll")
	procReplaceFileW = modKernel32.NewProc("ReplaceFileW")
)

// RootLock 持有基于 Windows 句柄的跨进程排他锁
type RootLock struct {
	handle windows.Handle
	path   string
}

// acquireRootFileLock 在 Windows 上打开或创建锁文件，并以共享模式 0（独占）持有句柄。
// 当进程崩溃或异常退出时，操作系统内核将自动回收句柄并释放独占锁。
func acquireRootFileLock(lockPath string) (*RootLock, error) {
	cleanPath := filepath.Clean(lockPath)
	// 预先审计锁路径及其祖先重解析点
	if err := checkNoReparsePoint(cleanPath); err != nil {
		return nil, err
	}

	dir := filepath.Dir(cleanPath)
	if err := checkNoReparsePoint(dir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("创建独占锁父目录失败: %w", err)
	}
	if err := checkNoReparsePoint(dir); err != nil {
		return nil, err
	}

	p16, err := windows.UTF16PtrFromString(cleanPath)
	if err != nil {
		return nil, fmt.Errorf("转换锁路径失败: %w", err)
	}

	// dwShareMode = 0 表示完全独占，不允许任何其他进程或句柄读写或删除
	handle, err := windows.CreateFile(
		p16,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0,
		nil,
		windows.OPEN_ALWAYS,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		if errors.Is(err, windows.ERROR_SHARING_VIOLATION) || errors.Is(err, windows.ERROR_ACCESS_DENIED) || err == windows.ERROR_SHARING_VIOLATION {
			return nil, fmt.Errorf("%w: 锁文件被其他进程占用 (%s)", ErrRootLocked, cleanPath)
		}
		return nil, fmt.Errorf("获取根独占锁句柄失败: %w", err)
	}

	// 再次校验已打开锁文件最终组件非重解析点
	if err := checkNoReparsePoint(cleanPath); err != nil {
		windows.CloseHandle(handle)
		return nil, err
	}

	return &RootLock{
		handle: handle,
		path:   cleanPath,
	}, nil
}

// Release 主动释放独占锁句柄
func (l *RootLock) Release() error {
	if l == nil || l.handle == windows.InvalidHandle {
		return nil
	}
	err := windows.CloseHandle(l.handle)
	l.handle = windows.InvalidHandle
	return err
}

// moveFileNoReplace 用于不可变记录与清单的发布。
// 绝不包含 MOVEFILE_REPLACE_EXISTING 标志；若目标已存在则由 Windows 内核直接拒绝，防止意外覆盖。
func moveFileNoReplace(srcPath, destPath string) error {
	// 审计源路径与目标路径及其祖先重解析点（包含最终组件）
	if err := checkNoReparsePoint(srcPath); err != nil {
		return err
	}
	if err := checkNoReparsePoint(destPath); err != nil {
		return err
	}

	src16, err := windows.UTF16PtrFromString(srcPath)
	if err != nil {
		return fmt.Errorf("转换源路径失败: %w", err)
	}
	dest16, err := windows.UTF16PtrFromString(destPath)
	if err != nil {
		return fmt.Errorf("转换目标路径失败: %w", err)
	}

	// MOVEFILE_WRITE_THROUGH 保证直接刷写至磁盘；不带 REPLACE_EXISTING
	if err := windows.MoveFileEx(src16, dest16, windows.MOVEFILE_WRITE_THROUGH); err != nil {
		return fmt.Errorf("发布不可变文件失败 (%s -> %s): %w", srcPath, destPath, err)
	}
	return nil
}

// replaceFileOnly 用于 work.json 权威头指针的单次替换。
// 必须在暂存文件 Sync() 刷盘后调用；使用合法 flags=0，失败时不进行盲目二次覆盖回退。
func replaceFileOnly(replacementPath, replacedPath string) error {
	// 审计替换源与目标及其祖先重解析点
	if err := checkNoReparsePoint(replacementPath); err != nil {
		return err
	}
	if err := checkNoReparsePoint(replacedPath); err != nil {
		return err
	}

	rep16, err := windows.UTF16PtrFromString(replacementPath)
	if err != nil {
		return fmt.Errorf("转换替换源路径失败: %w", err)
	}
	dest16, err := windows.UTF16PtrFromString(replacedPath)
	if err != nil {
		return fmt.Errorf("转换目标路径失败: %w", err)
	}

	// 目标必须已存在；目标丢失时不得隐式创建 head，必须直接返回错误拒绝隐式修复
	stat, statErr := os.Lstat(replacedPath)
	if statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			return fmt.Errorf("%w: 被替换目标不存在 (%s)", ErrCorruptData, replacedPath)
		}
		return fmt.Errorf("核验被替换目标状态失败: %w", statErr)
	}
	if stat.IsDir() {
		return fmt.Errorf("%w: 被替换目标是目录而非普通文件 (%s)", ErrCorruptData, replacedPath)
	}

	// 目标存在：单次调用 ReplaceFileW，flags 传 0
	r1, _, e1 := procReplaceFileW.Call(
		uintptr(unsafe.Pointer(dest16)),
		uintptr(unsafe.Pointer(rep16)),
		0, // lpBackupFileName = nil
		0, // dwReplaceFlags = 0
		0,
		0,
	)
	if r1 == 0 {
		if e1 != windows.ERROR_SUCCESS {
			return e1
		}
		return windows.GetLastError()
	}

	return nil
}

// checkNoReparsePoint 遍历指定路径及所有父目录直到卷根，拒绝包含符号链接、目录挂载点和 Junction。
// 仅允许路径不存在时继续向上检查祖先；若发生权限不足或 IO 错误必须准确拒绝，不得吞没错误。
func checkNoReparsePoint(path string) error {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("获取绝对路径失败: %w", err)
	}

	curr := filepath.Clean(absPath)
	for {
		p16, err := windows.UTF16PtrFromString(curr)
		if err != nil {
			return fmt.Errorf("转换 UTF16 失败 (%s): %w", curr, err)
		}

		attrs, err := windows.GetFileAttributes(p16)
		if err != nil {
			// 仅允许路径不存在的错误，继续检查祖先
			if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PATH_NOT_FOUND) {
				// 未创建路径，继续核验上层父目录
			} else {
				// 权限、IO、网络等错误一律拒绝，不能吞掉
				return fmt.Errorf("获取路径属性失败 (%s): %w", curr, err)
			}
		} else if attrs != windows.INVALID_FILE_ATTRIBUTES {
			if attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
				return fmt.Errorf("%w: %s", ErrReparsePointDetected, curr)
			}
		}

		parent := filepath.Dir(curr)
		if parent == curr {
			break
		}
		curr = parent
	}
	return nil
}

func isWindows() bool {
	return true
}
