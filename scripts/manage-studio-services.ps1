[CmdletBinding()]
param(
    [ValidateSet('Menu','Status','StartAll','StopAll','StartWeb','StopWeb','StartWorkspace','StopWorkspace','StartAgent','StopAgent','OpenCanvas','OpenWorks','Logs','SetDataRoot','OpenDataRoot','RunWeb','RunWorkspace','RunAgent')]
    [string]$Action = 'Menu',
    [string]$AcceptanceRoot = '',
    [string]$NewDataRoot = '',
    [string]$ManagerRoot = "$env:LOCALAPPDATA\infinite-studio\service-manager"
)

$ErrorActionPreference = 'Stop'
$DataConfigFile = Join-Path $ManagerRoot 'data-root.json'
if (-not $AcceptanceRoot) {
    $AcceptanceRoot = if (Test-Path -LiteralPath $DataConfigFile) { (Get-Content -LiteralPath $DataConfigFile -Raw | ConvertFrom-Json).DataRoot } else { 'C:\Users\ldc\AppData\Local\infinite-studio-works-acceptance-20261008-181916003' }
}
$RepoRoot = Split-Path -Parent $PSScriptRoot
$WebRoot = Join-Path $RepoRoot 'studio\web'
$ServiceRoot = Join-Path $RepoRoot 'workspace-service'
$AgentRoot = Join-Path $RepoRoot 'canvas-agent'
$WorkspaceRoot = Join-Path $AcceptanceRoot 'workspace-isolated'
$WorksRoot = Join-Path $AcceptanceRoot 'works'
$StateFile = Join-Path $ManagerRoot 'state.json'
$TokenFile = Join-Path $ManagerRoot 'workspace.token'
$LogRoot = Join-Path $ManagerRoot 'logs'
$Ports = @{ Web = 43863; Workspace = 8086; Agent = 17371 }

function Initialize-Manager { New-Item -ItemType Directory -Force -Path $ManagerRoot,$LogRoot | Out-Null }
function Get-Token {
    Initialize-Manager
    if (-not (Test-Path -LiteralPath $TokenFile)) {
        [guid]::NewGuid().ToString('N') | Set-Content -LiteralPath $TokenFile -Encoding ascii
    }
    return (Get-Content -LiteralPath $TokenFile -Raw).Trim()
}
function Get-State {
    if (Test-Path -LiteralPath $StateFile) { try { return Get-Content $StateFile -Raw | ConvertFrom-Json } catch {} }
    return [pscustomobject]@{ Processes = [pscustomobject]@{} }
}
function Save-State($state) { $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StateFile -Encoding utf8 }
function Get-PortOwner([int]$Port) {
    try {
        $lines = netstat.exe -ano -p tcp 2>$null
        if ($lines) {
            foreach ($l in $lines) {
                if ($l -match (':{0}\s+.*LISTENING\s+(\d+)' -f $Port)) {
                    return [pscustomobject]@{ OwningProcess = [int]$Matches[1]; LocalPort = $Port }
                }
            }
            return $null
        }
    } catch {}
    return (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}
function Get-ProcessTree([int]$RootProcessId) {
    $all = Get-CimInstance Win32_Process
    $ids = [System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add($RootProcessId)
    do { $changed = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $changed = $true } } } while ($changed)
    return $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}
function Test-RepoProcess($p) { $p -and (($p.ExecutablePath -like "$RepoRoot\*") -or ($p.CommandLine -like "*$RepoRoot*")) }
function Restore-ManagedRecord([string]$Name) {
    $owner = Get-PortOwner $Ports[$Name]
    if (-not $owner) { return }
    $currentId = [int]$owner.OwningProcess
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    while ($currentId -and $seen.Add($currentId)) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$currentId" -ErrorAction SilentlyContinue
        if (-not $processInfo) { return }
        if (($processInfo.CommandLine -like "*$ManagerRoot\Run$Name.cmd*") -or ($processInfo.CommandLine -like "*$PSCommandPath*" -and $processInfo.CommandLine -match "-Action\s+Run$Name\b" -and $processInfo.CommandLine -like "*$ManagerRoot*")) {
            $live = Get-Process -Id $currentId -ErrorAction Stop
            $state = Get-State
            $state.Processes | Add-Member -NotePropertyName $Name -NotePropertyValue ([pscustomobject]@{ LauncherPid=$currentId; StartedAt=$live.StartTime.ToUniversalTime().ToString('o'); Port=$Ports[$Name] }) -Force
            Save-State $state
            return
        }
        $currentId = [int]$processInfo.ParentProcessId
    }
}
function Start-Managed([string]$Name,[string]$WorkingDirectory,[string]$FilePath,[string[]]$ArgumentList) {
    $port = $Ports[$Name]; $owner = Get-PortOwner $port
    Restore-ManagedRecord $Name
    $existing = (Get-State).Processes.$Name
    if ($existing) {
        $launcher = Get-Process -Id $existing.LauncherPid -ErrorAction SilentlyContinue
        if ($launcher -and $launcher.StartTime.ToUniversalTime() -eq ([datetime]$existing.StartedAt).ToUniversalTime()) { Write-Host "$Name 已运行或正在启动。"; return }
    }
    if ($owner) { throw "端口 $port 被未托管进程占用（PID $($owner.OwningProcess)），拒绝接管。" }
    $out = Join-Path $LogRoot "$Name.out.log"; $err = Join-Path $LogRoot "$Name.err.log"
    Remove-Item -LiteralPath $err -Force -ErrorAction SilentlyContinue
    # 由 Windows 桌面 Shell 启动，服务不继承管理器终端的生命周期。
    $shell = New-Object -ComObject Shell.Application
    $shell.ShellExecute($FilePath, ($ArgumentList -join ' '), $WorkingDirectory, 'open', 0)
    $p = $null
    while (-not $p) {
        $candidate = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$PSCommandPath*" -and $_.CommandLine -match "-Action\s+Run$Name\b" -and $_.CommandLine -like "*$ManagerRoot*" } | Select-Object -First 1
        if ($candidate) { $p = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue }
        if (-not $p) { Start-Sleep -Milliseconds 300 }
    }
    $state = Get-State; if (-not $state.Processes) { $state.Processes = [pscustomobject]@{} }
    $state.Processes | Add-Member -NotePropertyName $Name -NotePropertyValue ([pscustomobject]@{ LauncherPid = $p.Id; StartedAt = $p.StartTime.ToUniversalTime().ToString('o'); Port = $port }) -Force
    Save-State $state; Write-Host "$Name 已启动，日志：$out / $err"
}
function Stop-Managed([string]$Name) {
    Restore-ManagedRecord $Name
    $state = Get-State; $entry = $state.Processes.$Name; if (-not $entry) { Write-Host "$Name 没有管理器记录。"; return }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.LauncherPid)" -ErrorAction SilentlyContinue
    if (-not $p) { $state.Processes.PSObject.Properties.Remove($Name); Save-State $state; Write-Host "$Name 已退出。"; return }
    $live = Get-Process -Id $entry.LauncherPid -ErrorAction Stop
    if ($live.StartTime.ToUniversalTime() -ne ([datetime]$entry.StartedAt).ToUniversalTime() -or ($p.CommandLine -notlike "*$PSCommandPath*" -and $p.CommandLine -notlike "*$ManagerRoot\Run$Name.cmd*")) { throw "$Name 的记录 PID 已失效或发生 PID 复用，拒绝停止。" }
    $tree = @(Get-ProcessTree ([int]$entry.LauncherPid))
    if ($tree | Where-Object { $_.CreationDate -lt $p.CreationDate }) { throw '进程树身份不一致，拒绝停止。' }
    while ($tree.Count) {
        $parents = @($tree | ForEach-Object { $_.ParentProcessId })
        $leaves = @($tree | Where-Object { $_.ProcessId -notin $parents })
        if (-not $leaves.Count) { throw '进程树关系异常，拒绝停止。' }
        foreach ($child in $leaves) {
            $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ProcessId)" -ErrorAction SilentlyContinue
            if ($current -and $current.CreationDate -eq $child.CreationDate) { Stop-Process -Id ([int]$child.ProcessId) -Force -ErrorAction SilentlyContinue }
        }
        $tree = @($tree | Where-Object { $_.ProcessId -notin $leaves.ProcessId })
    }
    $state.Processes.PSObject.Properties.Remove($Name); Save-State $state; Write-Host "$Name 已停止。"
}
function Start-Web { Start-Managed Web $WebRoot 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','RunWeb','-AcceptanceRoot',('"'+$AcceptanceRoot+'"'),'-ManagerRoot',('"'+$ManagerRoot+'"')) }
function Start-Workspace { Start-Managed Workspace $ServiceRoot 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','RunWorkspace','-AcceptanceRoot',('"'+$AcceptanceRoot+'"'),'-ManagerRoot',('"'+$ManagerRoot+'"')) }
function Start-Agent { Start-Managed Agent $AgentRoot 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','RunAgent','-ManagerRoot',('"'+$ManagerRoot+'"')) }
function Wait-Managed([string]$Name) {
    Write-Host "正在等待 $Name 就绪（Ctrl+C 可取消等待）…"
    while (-not (Get-PortOwner $Ports[$Name])) {
        $entry = (Get-State).Processes.$Name
        $launcher = if ($entry) { Get-Process -Id $entry.LauncherPid -ErrorAction SilentlyContinue }
        if (-not $launcher -or $launcher.StartTime.ToUniversalTime() -ne ([datetime]$entry.StartedAt).ToUniversalTime()) {
            $errorLog = Join-Path $LogRoot "$Name.err.log"
            if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Tail 20 | Out-Host }
            throw "$Name 启动失败，请查看以上日志。"
        }
        Start-Sleep -Milliseconds 300
    }
    Write-Host "$Name 已就绪。" -ForegroundColor Green
}
function Show-Status { foreach ($name in $Ports.Keys) { $o = Get-PortOwner $Ports[$name]; Write-Host ("{0}: {1}" -f $name, $(if ($o) { "运行中 PID $($o.OwningProcess)" } else { '未运行' })) } }
function Open-Page([string]$Mode,[string]$Path) { $config = Join-Path (Join-Path $env:USERPROFILE '.infinite-studio') 'canvas-agent.json'; if (-not (Test-Path $config)) { throw 'Agent 尚未启动，无法生成自动连接地址。' }; $c = Get-Content $config -Raw | ConvertFrom-Json; $url = "http://127.0.0.1:43863${Path}?mode=${Mode}#agentUrl=$([uri]::EscapeDataString($c.url))&agentToken=$([uri]::EscapeDataString($c.token))"; Start-Process $url }
function Show-Logs { Get-ChildItem $LogRoot -File | ForEach-Object { Start-Process notepad.exe $_.FullName } }
function Set-DataRoot([string]$Target) {
    if (-not $Target) { $Target = Read-Host '新的保存目录（绝对路径，需为空；现有数据会复制过去）' }
    if (-not [IO.Path]::IsPathRooted($Target) -or $Target -notmatch '^[A-Za-z]:[\\/]') { throw '请填写本地磁盘绝对路径。' }
    $targetPath = [IO.Path]::GetFullPath($Target).TrimEnd('\')
    $sourcePath = [IO.Path]::GetFullPath($AcceptanceRoot).TrimEnd('\')
    if ($targetPath -eq [IO.Path]::GetPathRoot($targetPath).TrimEnd('\') -or $targetPath -eq $sourcePath -or $targetPath.StartsWith($sourcePath+'\',[StringComparison]::OrdinalIgnoreCase) -or $sourcePath.StartsWith($targetPath+'\',[StringComparison]::OrdinalIgnoreCase)) { throw '保存目录不能是磁盘根目录或与当前目录重叠。' }
    if ((Test-Path -LiteralPath $targetPath) -and (Get-ChildItem -LiteralPath $targetPath -Force | Select-Object -First 1)) { throw '目标目录非空，拒绝覆盖；请选择空目录。' }
    $ancestor = $targetPath
    while ($ancestor) {
        if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '保存路径含目录链接，拒绝切换。' }
        $ancestor = Split-Path -Parent $ancestor
    }
    foreach ($folder in @($WorkspaceRoot,$WorksRoot)) {
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw "当前数据目录缺失：$folder" }
        if (((Get-Item -LiteralPath $folder -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-ChildItem -LiteralPath $folder -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })) { throw '当前数据含文件链接，拒绝复制。' }
    }
    $wasRunning = [bool](Get-PortOwner $Ports.Workspace)
    if ($wasRunning -and -not (Get-State).Processes.Workspace) { throw '工作区服务未托管，不能安全切换。' }
    if ($wasRunning) { Stop-Managed Workspace }
    try {
        if (Get-PortOwner $Ports.Workspace) { throw '工作区尚未停止，拒绝复制活动数据库。' }
        New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
        foreach ($folder in @($WorkspaceRoot,$WorksRoot)) {
            Copy-Item -LiteralPath $folder -Destination $targetPath -Recurse -Force -ErrorAction Stop
            foreach ($file in Get-ChildItem -LiteralPath $folder -Recurse -Force -File) {
                $copy = Join-Path (Join-Path $targetPath (Split-Path $folder -Leaf)) $file.FullName.Substring($folder.Length+1)
                if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash) { throw "复制校验失败：$copy" }
            }
        }
        [pscustomobject]@{ DataRoot=$targetPath } | ConvertTo-Json | Set-Content -LiteralPath $DataConfigFile -Encoding utf8
        $script:AcceptanceRoot = $targetPath
        $script:WorkspaceRoot = Join-Path $targetPath 'workspace-isolated'
        $script:WorksRoot = Join-Path $targetPath 'works'
        Write-Host "保存目录已改为 $targetPath；原数据保留在 $sourcePath。"
    } finally { if ($wasRunning) { Start-Workspace } }
}
function Invoke-ServiceProcess([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$Directory) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "$Name 启动程序不存在：$Executable" }
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogRoot "$Name.out.log") -RedirectStandardError (Join-Path $LogRoot "$Name.err.log") -PassThru
    $process.WaitForExit()
    $script:LASTEXITCODE = $process.ExitCode
    "$(Get-Date -Format o) $Name exited: PID=$($process.Id) exitCode=$($process.ExitCode)" | Add-Content -LiteralPath (Join-Path $LogRoot 'lifecycle.log') -Encoding utf8
}
function Invoke-Action([string]$value) {
    if ($value -notlike 'Run*' -and (Test-Path -LiteralPath $DataConfigFile)) {
        $script:AcceptanceRoot = (Get-Content -LiteralPath $DataConfigFile -Raw | ConvertFrom-Json).DataRoot
        $script:WorkspaceRoot = Join-Path $AcceptanceRoot 'workspace-isolated'
        $script:WorksRoot = Join-Path $AcceptanceRoot 'works'
    }
    if ($value -eq 'SetDataRoot') { Set-DataRoot $NewDataRoot; return }
    if ($value -eq 'OpenDataRoot') { Start-Process explorer.exe ('"'+$AcceptanceRoot+'"'); return }
    switch ($value) { 'Status' { Show-Status }; 'StartAll' { [void](Get-Token); Start-Workspace; Wait-Managed Workspace; Start-Web; Wait-Managed Web; Start-Agent; Wait-Managed Agent; Open-Page recent '/sudio'; Write-Host '全部服务已就绪，画布已打开。' -ForegroundColor Green }; 'StopAll' { Stop-Managed Agent; Stop-Managed Workspace; Stop-Managed Web }; 'StartWeb' { Start-Web }; 'StopWeb' { Stop-Managed Web }; 'StartWorkspace' { Start-Workspace }; 'StopWorkspace' { Stop-Managed Workspace }; 'StartAgent' { Start-Agent }; 'StopAgent' { Stop-Managed Agent }; 'OpenCanvas' { Open-Page recent '/sudio' }; 'OpenWorks' { Open-Page choose '/works' }; 'Logs' { Show-Logs }; 'RunWeb' { $oldMode=$env:VITE_STORAGE_MODE; $oldToken=$env:LOCAL_WORKSPACE_ACCESS_TOKEN; try { $env:VITE_STORAGE_MODE='local-workspace'; $env:LOCAL_WORKSPACE_ACCESS_TOKEN=Get-Token; Set-Location $WebRoot; $env:CI='true'; Invoke-ServiceProcess Web (Get-Command node.exe).Source @(('"'+(Join-Path $WebRoot 'node_modules\vite\bin\vite.js')+'"'),'--host','127.0.0.1','--port','43863','--strictPort') $WebRoot } finally { $env:VITE_STORAGE_MODE=$oldMode; $env:LOCAL_WORKSPACE_ACCESS_TOKEN=$oldToken } }; 'RunWorkspace' { $old=$env:LOCAL_WORKSPACE_ACCESS_TOKEN; try { $env:LOCAL_WORKSPACE_ACCESS_TOKEN=Get-Token; Set-Location $ServiceRoot; Invoke-ServiceProcess Workspace (Join-Path $ManagerRoot 'workspace-service.exe') @('-data-root',('"'+$WorkspaceRoot+'"'),'-works-root',('"'+$WorksRoot+'"')) $ServiceRoot } finally { $env:LOCAL_WORKSPACE_ACCESS_TOKEN=$old } }; 'RunAgent' { Set-Location $AgentRoot; Invoke-ServiceProcess Agent (Get-Command node.exe).Source @(('"'+(Join-Path $AgentRoot 'node_modules\tsx\dist\cli.mjs')+'"'),('"'+(Join-Path $AgentRoot 'src\index.ts')+'"')) $AgentRoot } }
}
Initialize-Manager
if ($Action -like 'Run*') {
    $serviceName = $Action.Substring(3)
    try {
        Invoke-Action $Action
        exit $LASTEXITCODE
    } catch { $_ | Out-String | Set-Content -LiteralPath (Join-Path $LogRoot "$serviceName.err.log") -Encoding utf8; exit 1 }
}
if ($Action -ne 'Menu') { try { Invoke-Action $Action } catch { Write-Error $_; exit 1 }; exit }
function Invoke-CurrentScript([string]$value) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Action $value -ManagerRoot $ManagerRoot
    if ($LASTEXITCODE -ne 0) { throw '操作失败，请查看以上错误。' }
}
try { Invoke-CurrentScript StartAll } catch { Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red }
while ($true) {
    Write-Host "`n无限片场服务管理器"
    Show-Status
    Write-Host '1 启动全部并打开画布   2 关闭全部服务   3 打开画布   4 查看日志   5 保存目录设置   0 退出菜单（服务继续运行）'
    $choice = Read-Host '选择'
    try {
        switch ($choice) {
            '1' { Invoke-CurrentScript StartAll }
            '2' { Invoke-CurrentScript StopAll }
            '3' { Invoke-CurrentScript OpenCanvas }
            '4' { Invoke-CurrentScript Logs }
            '5' { Write-Host "当前保存目录：$AcceptanceRoot"; Write-Host '1 打开目录   2 修改目录'; switch (Read-Host '选择') { '1' { Invoke-Action OpenDataRoot }; '2' { Invoke-Action SetDataRoot } } }
            '0' { exit }
            default { Write-Host '无效选择。' }
        }
    } catch { Write-Host "操作失败：$($_.Exception.Message)" -ForegroundColor Red }
}
