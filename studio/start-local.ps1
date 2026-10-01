param(
    [ValidateSet("Start", "Stop")]
    [string]$Action = "Start",
    [ValidateSet("All", "Api", "Web")]
    [string]$Mode = "All",
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$launcherScript = [System.IO.Path]::GetFullPath($PSCommandPath)
$webRoot = Join-Path $projectRoot "web"
$logRoot = Join-Path $projectRoot "data\logs\quick-start"
$apiPort = 8086
$webPort = 43862
$apiUrl = "http://127.0.0.1:$apiPort/api/health"
$webUrl = "http://127.0.0.1:$webPort/xiaji"
$pidFiles = @{
    Api = Join-Path $logRoot "api.pid"
    Web = Join-Path $logRoot "web.pid"
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if ($Mode -eq "Api") {
    Set-Content -LiteralPath $pidFiles.Api -Value $PID -NoNewline
    $env:HOST = "127.0.0.1"
    $env:PORT = [string]$apiPort
    $env:STORAGE_DRIVER = "sqlite"
    $env:DATABASE_DSN = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "data\infinite-canvas.db"))
    $env:LOCAL_FILES_DIR = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "data\files"))
    Set-Location -LiteralPath $projectRoot
    & go run .
    exit $LASTEXITCODE
}

if ($Mode -eq "Web") {
    Set-Content -LiteralPath $pidFiles.Web -Value $PID -NoNewline
    $env:API_BASE_URL = "http://127.0.0.1:$apiPort"
    Set-Location -LiteralPath $webRoot
    & bunx next dev --webpack -H 127.0.0.1 -p $webPort
    exit $LASTEXITCODE
}

function Test-HttpReady([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Get-ListeningProcessId([int]$Port) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { return [int]$listener.OwningProcess }
    return $null
}

function Test-StartedByThisProject([int]$ProcessId, [string]$ServiceMode) {
    for ($depth = 0; $ProcessId -gt 0 -and $depth -lt 12; $depth++) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        if (-not $process) { return $false }
        if ($process.CommandLine -and
            $process.CommandLine.IndexOf($launcherScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $process.CommandLine -match ("-Mode\s+" + [regex]::Escape($ServiceMode) + "\b")) {
            return $true
        }
        $ProcessId = [int]$process.ParentProcessId
    }
    return $false
}

function Wait-HttpReady([string]$Url, [int]$TimeoutSeconds = 120) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpReady $Url) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Start-LocalService([string]$ServiceMode, [int]$Port, [string]$ReadyUrl, [string]$LogName) {
    if (Test-HttpReady $ReadyUrl) {
        $runningPid = Get-ListeningProcessId $Port
        if ($runningPid -and (Test-StartedByThisProject $runningPid $ServiceMode)) {
            Write-Host "$ServiceMode 已由本仓库启动器运行：$ReadyUrl"
            return
        }
        throw "$ReadyUrl 有服务响应，但无法确认它由本仓库的 start-local.ps1 启动；为避免连错项目，未复用。"
    }

    $owner = Get-ListeningProcessId $Port
    if ($owner) {
        throw "端口 $Port 已被进程 $owner 占用，但不是本项目可确认的服务；未覆盖该进程。"
    }

    $powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Mode $ServiceMode"
    $stdout = Join-Path $logRoot "$LogName.stdout.log"
    $stderr = Join-Path $logRoot "$LogName.stderr.log"
    Start-Process -FilePath $powershellExe -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null

    if (-not (Wait-HttpReady $ReadyUrl)) {
        throw "$ServiceMode 启动超时。查看日志：$stdout；$stderr"
    }
    Write-Host "$ServiceMode 已启动：$ReadyUrl"
}

function Stop-LocalServices {
    foreach ($serviceMode in @("Web", "Api")) {
        $pidFile = $pidFiles[$serviceMode]
        if (-not (Test-Path -LiteralPath $pidFile)) { continue }

        $servicePid = 0
        if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw), [ref]$servicePid)) {
            Write-Warning "PID 文件无效，未停止 $serviceMode：$pidFile"
            continue
        }

        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $servicePid" -ErrorAction SilentlyContinue
        if (-not $process) {
            Remove-Item -LiteralPath $pidFile -Force
            continue
        }

        if ($process.Name -ne "powershell.exe" -or $process.CommandLine.IndexOf($launcherScript, [System.StringComparison]::OrdinalIgnoreCase) -lt 0 -or $process.CommandLine -notmatch ("-Mode\s+" + [regex]::Escape($serviceMode) + "\b")) {
            Write-Warning "PID $servicePid 不属于本仓库启动器，未停止 $serviceMode。"
            continue
        }

        & taskkill.exe /PID $servicePid /T /F | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Remove-Item -LiteralPath $pidFile -Force
            Write-Host "$serviceMode 已停止。"
        }
    }
}

if ($Action -eq "Stop") {
    Stop-LocalServices
    exit 0
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "未找到 Go。安装 Go 后重新运行本脚本。"
}
if (-not (Get-Command bunx -ErrorAction SilentlyContinue)) {
    throw "未找到 Bun/bunx。安装 Bun 后重新运行本脚本。"
}
if (-not (Test-Path -LiteralPath (Join-Path $webRoot "node_modules"))) {
    Push-Location -LiteralPath $webRoot
    try {
        & bun install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "bun install 失败，退出代码：$LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

Start-LocalService "Api" $apiPort $apiUrl "api"
Start-LocalService "Web" $webPort $webUrl "web"

if (-not $NoOpen) { Start-Process $webUrl }
Write-Host "无限片场已就绪：网页 $webUrl；API http://127.0.0.1:$apiPort；数据位于本仓库 data 目录。"
