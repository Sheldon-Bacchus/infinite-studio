param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$BackupPath
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$serviceRoot = Join-Path $repositoryRoot "workspace-service"

if (-not (Test-Path -LiteralPath $BackupPath -PathType Container)) {
    throw "备份目录不存在：$BackupPath"
}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "未找到 Go；未执行备份校验。"
}

$backupRoot = (Resolve-Path -LiteralPath $BackupPath).Path
Push-Location -LiteralPath $serviceRoot
try {
    & go run . -verify-backup $backupRoot
    if ($LASTEXITCODE -ne 0) {
        throw "备份校验失败，workspace-service 退出代码：$LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
