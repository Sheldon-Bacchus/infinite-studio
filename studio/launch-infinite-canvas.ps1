param(
    [switch]$Production,
    [switch]$Development,
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$useProduction = $Production -or -not $Development
$frontendPort = 43861
if ($Production -and $Development) {
    throw "Choose either -Production or -Development, not both."
}
$root = $PSScriptRoot

# 本地画布只有一个真源：无论当前目录、.env 或启动方式如何，启动器都固定到
# 同一个本机后端、SQLite 数据库和媒体目录，避免再次出现两个浏览器各自落盘。
$env:HOST = "127.0.0.1"
$env:PORT = "8081"
$env:STORAGE_DRIVER = "sqlite"
$env:DATABASE_DSN = [System.IO.Path]::GetFullPath((Join-Path $root "data\infinite-canvas.db"))
$env:LOCAL_FILES_DIR = [System.IO.Path]::GetFullPath((Join-Path $root "data\files"))

$runtimeDir = Join-Path $root "data\runtime"
$backendExe = Join-Path $runtimeDir "infinite-canvas.exe"
$frontendServer = Join-Path $root "web\.next\standalone\web\server.js"
$agentEntry = Join-Path $root "canvas-agent\index.mjs"
$buildId = Join-Path $root "web\.next\BUILD_ID"

function Get-LatestWriteTime($paths) {
    $files = foreach ($item in $paths) {
        if (Test-Path -LiteralPath $item -PathType Container) {
            Get-ChildItem -LiteralPath $item -File -Recurse -ErrorAction SilentlyContinue
        } elseif (Test-Path -LiteralPath $item -PathType Leaf) {
            Get-Item -LiteralPath $item
        }
    }
    $latest = $files | Measure-Object -Property LastWriteTimeUtc -Maximum
    return $latest.Maximum
}

function Test-TcpPort([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync("127.0.0.1", $port)
        return $task.Wait(250) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-TcpPort([int]$port, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPort $port) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Test-CanvasPage {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/canvas" -TimeoutSec 2 -UseBasicParsing
        return $response.StatusCode -eq 200 -and $response.Content.Length -gt 1000 -and $response.Content.Contains("/_next/static/")
    } catch {
        return $false
    }
}

function Test-CanvasDevelopmentServer {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/canvas" -TimeoutSec 2 -UseBasicParsing
        return $response.StatusCode -eq 200 -and $response.Content.Contains("next-dev")
    } catch {
        return $false
    }
}

function Test-FrontendLoopbackBinding {
    $listeners = @(Get-NetTCPConnection -LocalPort $frontendPort -State Listen -ErrorAction SilentlyContinue)
    return $listeners.Count -gt 0 -and @($listeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }).Count -eq 0
}

function Test-CanvasLocalApiBridge {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/api/local/canvas/projects" -TimeoutSec 2 -UseBasicParsing
        $payload = $response.Content | ConvertFrom-Json
        return $response.StatusCode -eq 200 -and $payload.code -eq 0
    } catch {
        return $false
    }
}

function Test-CanvasReady {
    return (Test-CanvasPage) -and (Test-CanvasLocalApiBridge)
}

function Get-PortOwner([int]$port) {
    $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) { return $null }
    $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction SilentlyContinue
    $parent = if ($details) { Get-CimInstance Win32_Process -Filter "ProcessId=$($details.ParentProcessId)" -ErrorAction SilentlyContinue }
    return [PSCustomObject]@{
        Pid = $process.Id
        ParentPid = $details.ParentProcessId
        Process = $process.ProcessName
        Path = $process.Path
        CommandLine = $details.CommandLine
        ParentCommandLine = $parent.CommandLine
        StartedAtUtc = if ($details.CreationDate) { $details.CreationDate.ToUniversalTime() } else { $null }
    }
}

function Test-FrontendBuildIsNewerThanServer {
    $owner = Get-PortOwner $frontendPort
    if (-not $owner) { return $false }
    $build = Get-Item -LiteralPath $buildId -ErrorAction SilentlyContinue
    if (-not $build) { return $false }
    if (-not $owner.StartedAtUtc) { return $true }
    return $owner.StartedAtUtc -le $build.LastWriteTimeUtc
}

function Stop-OwnStaleFrontend {
    $owner = Get-PortOwner $frontendPort
    if (-not $owner) { return $false }
    $commandLine = "{0}`n{1}" -f [string]$owner.CommandLine, [string]$owner.ParentCommandLine
    $isOwnProcess = $commandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    # 某些 Windows 权限上下文不会返回 Node 的 CommandLine；此时只有当
    # 当前页面明确是本项目时，才允许按 node 进程处理，避免误杀别的服务。
    $isCanvasNode = $owner.Process -eq "node" -and (Test-CanvasPage)
    if (-not ($isOwnProcess -or $isCanvasNode)) {
        throw "Port $frontendPort is occupied by another service; refusing to stop it. Stop that service or choose another port."
    }
    $parentCommandLine = [string]$owner.ParentCommandLine
    if ($owner.ParentPid -and $parentCommandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and $parentCommandLine -match "(?i)next.*\b(dev|start)\b") {
        Stop-Process -Id $owner.ParentPid -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline -and (Test-TcpPort $frontendPort)) { Start-Sleep -Milliseconds 200 }
    if (Test-TcpPort $frontendPort) { throw "The old Infinite Canvas frontend on port $frontendPort did not stop." }
    Write-Host "Replaced the stale Infinite Canvas frontend on port $frontendPort so it uses the unified 8081 backend."
    return $true
}

function Test-BackendService {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8081/api/health" -TimeoutSec 2 -UseBasicParsing
        return $response.StatusCode -eq 200 -and $response.Content.Trim() -eq "ok"
    } catch {
        return $false
    }
}

function Start-VisiblePowerShellCommand([string]$title, [string]$command, [string]$workingDirectory) {
    $powershell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
    $escapedTitle = $title.Replace("'", "''")
    $script = "`$Host.UI.RawUI.WindowTitle = '$escapedTitle'; $command"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    Start-Process -FilePath $powershell -WorkingDirectory $workingDirectory -WindowStyle Normal -ArgumentList @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-EncodedCommand", $encoded
    ) | Out-Null
}

function Start-SourceCanvasAgent {
    $owner = Get-PortOwner 3210
    if (Test-TcpPort 3210) {
        if (-not $owner) { throw "Port 3210 is occupied, but its owner could not be identified; refusing to replace it." }
        $commandLine = "{0}`n{1}" -f [string]$owner.CommandLine, [string]$owner.ParentCommandLine
        $isRepositoryAgent = $commandLine.IndexOf($agentEntry, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            ([string]$owner.CommandLine -match "(?i)\s+(?:\.?[\\/])?canvas-agent[\\/]index\.mjs(?:\s|$)")
        if ($isRepositoryAgent) {
            Write-Host "Reusing the repository Canvas Agent on 127.0.0.1:3210."
            return
        }
        if ($owner.Process -ne "node" -or $commandLine -notmatch "(?i)canvas-agent") {
            throw "Port 3210 is occupied by an unrecognized process; refusing to stop it."
        }
        Write-Host "Replacing the old Canvas Agent on 3210 with this repository's source runtime."
        Stop-Process -Id $owner.Pid -Force -ErrorAction Stop
        $releaseDeadline = (Get-Date).AddSeconds(5)
        while ((Get-Date) -lt $releaseDeadline -and (Test-TcpPort 3210)) { Start-Sleep -Milliseconds 200 }
        if (Test-TcpPort 3210) {
            throw "The previous Canvas Agent did not release port 3210."
        }
    }

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw "Node.js is required to start the repository Canvas Agent." }
    $nodePath = $node.Source.Replace("'", "''")
    $entryPath = $agentEntry.Replace("'", "''")
    Start-VisiblePowerShellCommand "Infinite Canvas Agent :3210" "& '$nodePath' '$entryPath'" $root
    if (-not (Wait-TcpPort 3210 12)) {
        throw "The repository Canvas Agent did not become ready on 127.0.0.1:3210; inspect its visible terminal."
    }
    $owner = Get-PortOwner 3210
    $commandLine = if ($owner) { "{0}`n{1}" -f [string]$owner.CommandLine, [string]$owner.ParentCommandLine } else { "" }
    if ($commandLine.IndexOf($agentEntry, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Port 3210 became active, but it is not owned by the repository Canvas Agent."
    }
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $root ".env"))) {
        Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination (Join-Path $root ".env")
    }
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

    $goFiles = Get-ChildItem -LiteralPath $root -Filter "*.go" -File -Recurse | Where-Object { $_.FullName -notmatch "[\\/](web|integrations|data|node_modules|vendor|\.git)[\\/]" } | ForEach-Object { $_.FullName }
    $backendInputs = @((Join-Path $root "go.mod"), (Join-Path $root "go.sum")) + $goFiles
    $backendSourceTime = Get-LatestWriteTime $backendInputs
    $backendNeedsBuild = -not (Test-Path -LiteralPath $backendExe) -or ((Get-Item -LiteralPath $backendExe -ErrorAction SilentlyContinue).LastWriteTimeUtc -lt $backendSourceTime)

    $frontendInputs = @(
        (Join-Path $root "web\src"),
        (Join-Path $root "web\public"),
        (Join-Path $root "web\package.json"),
        (Join-Path $root "web\bun.lock"),
        (Join-Path $root "web\next.config.ts"),
        (Join-Path $root "web\postcss.config.mjs"),
        (Join-Path $root "web\tsconfig.json")
    )
    $frontendNeedsBuild = $false
    if ($useProduction) {
        $frontendSourceTime = Get-LatestWriteTime $frontendInputs
        $frontendStatic = Join-Path $root "web\.next\standalone\web\.next\static"
        $frontendNeedsBuild = -not (Test-Path -LiteralPath $frontendServer) -or -not (Test-Path -LiteralPath $buildId) -or -not (Test-Path -LiteralPath $frontendStatic) -or ((Get-Item -LiteralPath $buildId -ErrorAction SilentlyContinue).LastWriteTimeUtc -lt $frontendSourceTime)
    }

    $needsFrontendBuild = $useProduction -and $frontendNeedsBuild
    if ($backendNeedsBuild -and $needsFrontendBuild) {
        Write-Host "Detected missing or changed build output; building once before launch..."
        & (Join-Path $root "build-infinite-canvas.cmd") --quiet
        if ($LASTEXITCODE -ne 0) { throw "Build failed; see the build output above." }
    } elseif ($backendNeedsBuild) {
        Write-Host "Backend source changed; rebuilding the backend..."
        & (Join-Path $root "build-infinite-canvas.cmd") --backend-only --quiet
        if ($LASTEXITCODE -ne 0) { throw "Backend build failed; see the build output above." }
    } elseif ($needsFrontendBuild) {
        Write-Host "Frontend source changed; rebuilding the frontend..."
        & (Join-Path $root "build-infinite-canvas.cmd") --frontend-only --quiet
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed; see the build output above." }
    }

    if (Test-TcpPort 8081) {
        if (-not (Test-BackendService)) { throw "Port 8081 is occupied, but it is not the Infinite Canvas backend; refusing to reuse it." }
    } else {
        $backendPath = $backendExe.Replace("'", "''")
        Start-VisiblePowerShellCommand "Infinite Canvas Backend :8081" "& '$backendPath'" $root
        $backendDeadline = (Get-Date).AddSeconds(25)
        while ((Get-Date) -lt $backendDeadline -and -not (Test-BackendService)) { Start-Sleep -Milliseconds 250 }
        if (-not (Test-BackendService)) { throw "Backend did not become healthy on 127.0.0.1:8081; inspect the visible backend terminal." }
    }

    $canvasReady = Test-CanvasReady
    $isDevelopmentServer = Test-CanvasDevelopmentServer
    $frontendLoopback = Test-FrontendLoopbackBinding
    $frontendBuildIsNewerThanServer = $useProduction -and (Test-FrontendBuildIsNewerThanServer)
    if ($useProduction -and $canvasReady -and ($isDevelopmentServer -or $frontendBuildIsNewerThanServer)) {
        Stop-OwnStaleFrontend | Out-Null
        $canvasReady = $false
        if ($frontendBuildIsNewerThanServer) {
            Write-Host "The frontend build changed after the running server started; reloading the server against the current build."
        }
    }

    if ($canvasReady -and -not $frontendLoopback) {
        Stop-OwnStaleFrontend | Out-Null
        $canvasReady = $false
        Write-Host "Replaced the project frontend listener with a loopback-only server on 127.0.0.1:$frontendPort."
    }

    if (-not $canvasReady) {
        if (Test-TcpPort $frontendPort) { Stop-OwnStaleFrontend | Out-Null }
        $frontendScript = (Join-Path $root "run-infinite-canvas-frontend.ps1").Replace("'", "''")
        $frontendCommand = "& '$frontendScript' -FrontendPort $frontendPort"
        if ($useProduction) { $frontendCommand += " -Production" }
        Start-VisiblePowerShellCommand "Infinite Canvas Web :$frontendPort" $frontendCommand $root
        $deadline = (Get-Date).AddSeconds(40)
        while ((Get-Date) -lt $deadline -and -not (Test-CanvasReady)) { Start-Sleep -Milliseconds 350 }
        if (-not (Test-CanvasReady)) { throw "Frontend did not become ready on localhost:$frontendPort or its API bridge is not using 127.0.0.1:8081; inspect the visible frontend terminal." }
    } elseif ($isDevelopmentServer) {
        Write-Host "An existing Next.js development server is using port $frontendPort; reusing it without stopping it."
    } else {
        Write-Host "An existing production frontend using the unified 8081 backend is using port $frontendPort; reusing it without stopping it."
    }

    Start-SourceCanvasAgent

    if (-not $NoOpen) {
        try {
            Start-Process "http://localhost:$frontendPort/canvas"
        } catch {
            Write-Host "Canvas is ready at http://localhost:$frontendPort/canvas; automatic browser launch was blocked."
        }
    }

    Write-Host "Infinite Canvas is ready: Web http://localhost:$frontendPort, API http://127.0.0.1:8081, Canvas Agent http://127.0.0.1:3210."
    Write-Host "Newly started services keep visible terminal windows; already-running services are reused."
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}
