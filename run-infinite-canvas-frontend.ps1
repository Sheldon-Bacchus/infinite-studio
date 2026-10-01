param(
    [switch]$Production,
    [int]$FrontendPort = 43861
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$env:PORT = "$FrontendPort"
$env:HOSTNAME = "127.0.0.1"
$env:API_BASE_URL = "http://127.0.0.1:8081"
$env:NEXT_TELEMETRY_DISABLED = "1"
if ($Production) {
    Set-Location (Join-Path $root "web")
    & node .\node_modules\next\dist\bin\next start --hostname 127.0.0.1 --port $FrontendPort
} else {
    Set-Location (Join-Path $root "web")
    & node .\node_modules\next\dist\bin\next dev --webpack -H 127.0.0.1 -p $FrontendPort
}
