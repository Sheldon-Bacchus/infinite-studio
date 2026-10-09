//go:build !windows

package works

// RootLock 在非 Windows 平台上的空定义
type RootLock struct{}

func acquireRootFileLock(lockPath string) (*RootLock, error) {
	return nil, ErrUnsupportedPlatform
}

func (l *RootLock) Release() error {
	return nil
}

func moveFileNoReplace(srcPath, destPath string) error {
	return ErrUnsupportedPlatform
}

func replaceFileOnly(replacementPath, replacedPath string) error {
	return ErrUnsupportedPlatform
}

func checkNoReparsePoint(path string) error {
	return ErrUnsupportedPlatform
}

func isWindows() bool {
	return false
}
