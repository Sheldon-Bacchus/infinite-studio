param([switch]$Mcp)
$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'src/index.ts'
$tsx = Join-Path $PSScriptRoot 'node_modules/tsx/dist/cli.mjs'
if (-not (Test-Path -LiteralPath $tsx)) { throw '缺少本地 tsx 依赖，请先安装 canvas-agent 依赖。' }
if ($Mcp) { & node $tsx $entry mcp } else { & node $tsx $entry }
exit $LASTEXITCODE
