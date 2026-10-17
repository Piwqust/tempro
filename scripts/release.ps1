# Build Tempro and (re)install it on this machine: one command after a code change.
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1            # build + install
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -NoBuild   # install the last build
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -BuildOnly # only build the installer
# Data (%LOCALAPPDATA%\Tempro\tempro.db, encrypted) is not touched: the installer only replaces the program.
# Run it from a normal terminal. From inside a packaged app (the Claude desktop app is one) Windows
# redirects AppData and HKCU writes into that app's private copy: the install would land there,
# invisible to Explorer, Task Scheduler and autostart. Use -BuildOnly there and install from outside.
param([switch]$NoBuild, [switch]$BuildOnly)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "app"
$task = "Tempro\Watchdog"
$exe = Join-Path $env:LOCALAPPDATA "Tempro\tempro.exe"

if (-not $NoBuild) {
    Push-Location $app
    try {
        Write-Host "1/4  frontend"
        bun run build
        if ($LASTEXITCODE) { throw "frontend build failed" }
        Write-Host "2/4  installer (release, a few minutes)"
        # tauri's own beforeBuildCommand would call bun through a shim that doesn't start here
        node node_modules/@tauri-apps/cli/tauri.js build --config '{\"build\":{\"beforeBuildCommand\":\"\"}}'
        if ($LASTEXITCODE) { throw "tauri build failed" }
    } finally { Pop-Location }
}

$setup = Get-ChildItem (Join-Path $app "src-tauri\target\release\bundle\nsis") -Filter "*-setup.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "no installer found; run without -NoBuild" }
if ($BuildOnly) { Write-Host "built $($setup.FullName)"; exit 0 }

Write-Host "3/4  install $($setup.Name)"
# the watchdog would start the old copy again while the installer replaces it
cmd /c "schtasks /Change /TN `"$task`" /DISABLE >nul 2>&1"  # absent on the first install: fine
Get-Process tempro -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
Start-Process $setup.FullName -ArgumentList "/S" -Wait
cmd /c "schtasks /Change /TN `"$task`" /ENABLE >nul 2>&1"

# a new icon under the same exe path stays hidden behind Explorer's icon cache
& (Join-Path $PSScriptRoot "refresh-icon.cmd")

Write-Host "4/4  start"
if (-not (Test-Path $exe)) { throw "installed exe not found at $exe" }
Start-Process $exe -ArgumentList "--minimized"
Write-Host "Tempro $((Get-Item $exe).VersionInfo.ProductVersion) installed and running in the tray."
