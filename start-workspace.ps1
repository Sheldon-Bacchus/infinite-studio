$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceRoot = Join-Path $repositoryRoot "workspace-service"
$webRoot = Join-Path $repositoryRoot "studio\web"
$dataRoot = "E:\all-agent-workspace\infinite-studio-data"
$manifestPath = Join-Path $dataRoot "workspace.json"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "固定数据根缺少 workspace.json；启动脚本不会登记、迁移或初始化现有数据库。"
}
if (-not (Test-Path -LiteralPath (Join-Path $webRoot "node_modules") -PathType Container)) {
    throw "studio/web/node_modules 不存在；启动脚本不会安装或升级依赖。"
}

$legacyListener = Get-NetTCPConnection -State Listen -LocalPort 43862 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($legacyListener) {
    $legacyOwner = Get-CimInstance Win32_Process -Filter "ProcessId = $($legacyListener.OwningProcess)"
    Write-Host "旧入口 43862 由 PID $($legacyListener.OwningProcess) ($($legacyOwner.Name)) 使用；保持运行。"
}

foreach ($port in @(43863, 8086)) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        throw "固定端口 $port 已由 PID $($listener.OwningProcess) ($($owner.Name)) 使用；不会停止该进程或改用其他端口。"
    }
}

$previousToken = $env:LOCAL_WORKSPACE_ACCESS_TOKEN
$previousMode = $env:VITE_STORAGE_MODE
$tokenBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($tokenBytes) } finally { $random.Dispose() }
$env:LOCAL_WORKSPACE_ACCESS_TOKEN = [Convert]::ToBase64String($tokenBytes)
$env:VITE_STORAGE_MODE = "local-workspace"
$service = $null

try {
    $service = Start-Process -FilePath "go" -ArgumentList @("run", ".", "-data-root", $dataRoot) -WorkingDirectory $serviceRoot -WindowStyle Hidden -PassThru
    Push-Location $webRoot
    try {
        & npm run dev
        if ($LASTEXITCODE -ne 0) { throw "Vite exited with code $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($service -and -not $service.HasExited) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $service.Id /T /F | Out-Null
    }
    $env:LOCAL_WORKSPACE_ACCESS_TOKEN = $previousToken
    $env:VITE_STORAGE_MODE = $previousMode
    [Array]::Clear($tokenBytes, 0, $tokenBytes.Length)
}
