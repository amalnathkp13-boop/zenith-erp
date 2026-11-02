# ============================================================================
#  ZetaERP POS — QZ Tray seamless-printing setup
#  Run this ON THE MACHINE THAT DOES THE BILLING (where the cashier prints),
#  in an ADMIN PowerShell  (right-click PowerShell -> Run as administrator).
#
#  What it does:
#   1. Checks whether QZ Tray is installed and its local port is listening.
#   2. Installs our signing certificate as QZ Tray's trusted "authcert.override"
#      so signed print requests from erp.zetaclantech.com print SILENTLY
#      (no QZ prompt, no browser print dialog).
#   3. Restarts QZ Tray so the new trust takes effect.
#
#  The certificate is PUBLIC (safe to copy around). The private key never
#  leaves the server.
# ============================================================================

$ErrorActionPreference = 'Stop'
Write-Host "=== ZetaERP QZ Tray trust setup ===" -ForegroundColor Cyan

# --- 0. locate the certificate (expected next to this script, in Downloads) ---
$certSrc = Join-Path $PSScriptRoot 'digital-certificate.txt'
if (-not (Test-Path $certSrc)) { $certSrc = Join-Path $env:USERPROFILE 'Downloads\digital-certificate.txt' }
if (-not (Test-Path $certSrc)) {
    Write-Host "ERROR: digital-certificate.txt not found next to this script or in Downloads." -ForegroundColor Red
    Write-Host "       Put digital-certificate.txt in the same folder as this script, then re-run." -ForegroundColor Red
    exit 1
}
Write-Host "Certificate found: $certSrc"

# --- 1. locate QZ Tray install ---
$candidates = @(
    "C:\Program Files\QZ Tray",
    "C:\Program Files (x86)\QZ Tray",
    "$env:LOCALAPPDATA\Programs\QZ Tray"
)
$install = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $install) {
    Write-Host "QZ Tray does NOT appear to be installed on this machine." -ForegroundColor Yellow
    Write-Host "  -> Install QZ Tray first (https://qz.io/download/), start it, then re-run this script." -ForegroundColor Yellow
    exit 1
}
Write-Host "QZ Tray install: $install"

# --- 2. check whether QZ Tray is currently listening (8181 secure / 8182 insecure) ---
$listening = $false
foreach ($port in 8181,8182) {
    try { if ((Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded) { $listening = $true } } catch {}
}
if ($listening) { Write-Host "QZ Tray is running and reachable locally. GOOD." -ForegroundColor Green }
else { Write-Host "QZ Tray is installed but NOT currently listening — it will be (re)started below." -ForegroundColor Yellow }

# --- 3. install the cert into QZ's auth folder ---
$authDir = Join-Path $install 'auth'
if (-not (Test-Path $authDir)) { New-Item -ItemType Directory -Path $authDir | Out-Null }
$certDst = Join-Path $authDir 'digital-certificate.txt'
Copy-Item $certSrc $certDst -Force
Write-Host "Cert copied to: $certDst"

# --- 4. set authcert.override in qz-tray.properties (idempotent) ---
$props = Join-Path $install 'qz-tray.properties'
$overrideLine = 'authcert.override=' + ($certDst -replace '\\','/')
if (Test-Path $props) {
    $lines = Get-Content $props | Where-Object { $_ -notmatch '^\s*authcert\.override\s*=' }
    $lines + $overrideLine | Set-Content $props -Encoding ascii
} else {
    $overrideLine | Set-Content $props -Encoding ascii
}
Write-Host "qz-tray.properties set: $overrideLine"

# --- 5. restart QZ Tray so the trust takes effect ---
Write-Host "Restarting QZ Tray..." -ForegroundColor Cyan
Get-Process | Where-Object { $_.Name -match 'qz-tray' -or ($_.Path -and $_.Path -like "$install*") } | ForEach-Object { try { $_.Kill() } catch {} }
Start-Sleep -Seconds 2
$exe = Get-ChildItem $install -Filter 'qz-tray.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) { Start-Process $exe.FullName; Write-Host "Launched $($exe.FullName)" }
else { Write-Host "Could not find qz-tray.exe — start QZ Tray manually from the Start menu." -ForegroundColor Yellow }

Start-Sleep -Seconds 6
$ok = $false
foreach ($port in 8181,8182) { try { if ((Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded) { $ok = $true } } catch {} }
Write-Host ""
if ($ok) {
    Write-Host "DONE. QZ Tray is running and now trusts the ZetaERP cert." -ForegroundColor Green
    Write-Host "Reload the POS Terminal page, make a test sale, and the receipt should print SILENTLY." -ForegroundColor Green
} else {
    Write-Host "Setup applied, but QZ Tray is not listening yet. Start it from the Start menu, then test a print." -ForegroundColor Yellow
}
