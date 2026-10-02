param([ValidateSet('All','Api','Web')][string]$Mode = 'All')
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '.recovery/studio'
$dataRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'infinite-studio-data'
if (-not (Test-Path (Join-Path $source 'go.mod'))) {
    $recoveryRoot = Join-Path $PSScriptRoot '.recovery'
    New-Item -ItemType Directory -Path $recoveryRoot -Force | Out-Null
    $archive = Join-Path $recoveryRoot 'studio-source.tar'
    & git -C $PSScriptRoot archive --format=tar "--output=$archive" 7b42105 studio
    if ($LASTEXITCODE -ne 0) { throw '无法读取已保存的片场提交 7b42105。' }
    & tar -xf $archive -C $recoveryRoot
    if ($LASTEXITCODE -ne 0) { throw '片场源码恢复失败。' }
}
New-Item -ItemType Directory -Path (Join-Path $dataRoot 'files') -Force | Out-Null
if ($Mode -eq 'Api') {
    $env:HOST='127.0.0.1'; $env:PORT='8086'; $env:STORAGE_DRIVER='sqlite'
    $env:DATABASE_DSN=Join-Path $dataRoot 'workspace.sqlite'
    $env:LOCAL_FILES_DIR=Join-Path $dataRoot 'files'
    Set-Location -LiteralPath $source
    & go run .
    exit $LASTEXITCODE
}
if ($Mode -eq 'Web') {
    $env:API_BASE_URL='http://127.0.0.1:8086'
    Set-Location -LiteralPath (Join-Path $source 'web')
    if (-not (Test-Path 'node_modules/next')) {
        & bun install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
    }
    & bunx next dev --webpack -H 127.0.0.1 -p 43862
    exit $LASTEXITCODE
}
foreach ($service in @(@{Mode='Api';Port=8086},@{Mode='Web';Port=43862})) {
    if (Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue) {
        throw "端口 $($service.Port) 已占用；未复用或终止未知进程。"
    }
}
foreach ($service in @('Api','Web')) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Mode',$service)
}
Write-Host '片场工作台：http://127.0.0.1:43862/xiaji'
Write-Host "本地数据：$dataRoot"
Write-Host '43863 是新画布基底实验入口，两者尚未合并。'
