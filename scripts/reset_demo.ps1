# Clears the demo pipeline output and starts a fresh live bridge.
#
#   .\scripts\reset_demo.ps1
#
# Deletes ONLY the three indices the bridge writes (alerts, incidents, logs-normalized).
# The raw winlogbeat-* indices are never touched. Run it from anywhere; keep the window
# open afterwards, because the bridge runs in it. Ctrl+C stops the bridge.

$ErrorActionPreference = "Stop"
$es = if ($env:ES_HOST) { $env:ES_HOST } else { "http://localhost:9200" }
$repo = Split-Path -Parent $PSScriptRoot

Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
    Where-Object { $_.CommandLine -match 'live_bridge' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "stopped old bridge (pid $($_.ProcessId))" }

foreach ($index in "alerts", "incidents", "logs-normalized") {
    $result = curl.exe -s -X DELETE "$es/$index"
    Write-Host "deleted $index : $result"
}

Set-Location $repo
Write-Host "starting the live bridge. Run the attack script now, then wait about 5 seconds."
python -m scripts.live_bridge
