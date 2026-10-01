@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "PAUSE_ON_EXIT=1"
set "BUILD_BACKEND=1"
set "BUILD_FRONTEND=1"
if /I "%~1"=="--quiet" set "PAUSE_ON_EXIT=0"
if /I "%~2"=="--quiet" set "PAUSE_ON_EXIT=0"
if /I "%~1"=="--backend-only" set "BUILD_FRONTEND=0"
if /I "%~2"=="--backend-only" set "BUILD_FRONTEND=0"
if /I "%~1"=="--frontend-only" set "BUILD_BACKEND=0"
if /I "%~2"=="--frontend-only" set "BUILD_BACKEND=0"
set "GO_EXE="
for /f "delims=" %%G in ('where go 2^>nul') do if not defined GO_EXE set "GO_EXE=%%G"
if not defined GO_EXE if exist "%USERPROFILE%\scoop\shims\go.exe" set "GO_EXE=%USERPROFILE%\scoop\shims\go.exe"
if "%BUILD_BACKEND%"=="1" if not defined GO_EXE (
    echo [ERROR] Go is required to build the backend. Install Go or add it to PATH.
    if "%PAUSE_ON_EXIT%"=="1" pause
    exit /b 1
)
if "%BUILD_FRONTEND%"=="1" where node >nul 2>&1 || (
    echo [ERROR] Node.js is required to build the frontend.
    if "%PAUSE_ON_EXIT%"=="1" pause
    exit /b 1
)
if "%BUILD_FRONTEND%"=="1" if not exist "%ROOT%web\node_modules\next\dist\bin\next" (
    echo [ERROR] Frontend dependencies are missing. Install them once, then run this build script again.
    if "%PAUSE_ON_EXIT%"=="1" pause
    exit /b 1
)

pushd "%ROOT%"
if "%BUILD_BACKEND%"=="1" (
    if not exist "%ROOT%data\runtime" mkdir "%ROOT%data\runtime"
    echo Building Go backend...
    "%GO_EXE%" build -trimpath -ldflags "-s -w" -o "%ROOT%data\runtime\infinite-canvas.exe" .
    if errorlevel 1 (
        popd
        if "%PAUSE_ON_EXIT%"=="1" pause
        exit /b 1
    )
)

if "%BUILD_FRONTEND%"=="1" (
    echo Building production frontend...
    pushd "%ROOT%web"
    set "NEXT_TELEMETRY_DISABLED=1"
    node node_modules/next/dist/bin/next build
    if errorlevel 1 (
        popd
        popd
        if "%PAUSE_ON_EXIT%"=="1" pause
        exit /b 1
    )
    if not exist ".next\standalone\web\.next\static" mkdir ".next\standalone\web\.next\static"
    robocopy ".next\static" ".next\standalone\web\.next\static" /E /NFL /NDL /NJH /NJS >nul
    if errorlevel 8 (
        echo [ERROR] Could not copy production static assets.
        popd
        popd
        if "%PAUSE_ON_EXIT%"=="1" pause
        exit /b 1
    )
    if exist "public" xcopy "public\*" ".next\standalone\web\public\" /E /I /Y >nul
    popd
)
popd
echo Build complete. Daily launch will reuse these artifacts until source code changes.
if "%PAUSE_ON_EXIT%"=="1" pause
