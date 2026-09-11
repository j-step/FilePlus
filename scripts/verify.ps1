# scripts/verify.ps1 — the single gate for every autonomous run.
# Runs: pytest -> start backend -> Electron smoke test -> stop backend.
# Exit code is non-zero if any stage fails.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== 1/3 pytest ==' -ForegroundColor Cyan
py -3 -m pytest -q
if ($LASTEXITCODE -ne 0) { Write-Host 'pytest failed' -ForegroundColor Red; exit 1 }

Write-Host '== 2/3 backend ==' -ForegroundColor Cyan
$backend = Start-Process -FilePath 'py' -ArgumentList '-3', '-m', 'backend.api' `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9876/health' -TimeoutSec 1
    if ($r.StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
  Write-Host 'backend did not answer /health within 20 s' -ForegroundColor Red
  if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
  exit 1
}

Write-Host '== 3/3 electron smoke ==' -ForegroundColor Cyan
$code = 1
try {
  Push-Location (Join-Path $root 'frontend')
  # Electron-based dev shells export ELECTRON_RUN_AS_NODE, which turns Electron into plain Node;
  # the smoke test also strips it, this is belt and braces.
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  npm test
  $code = $LASTEXITCODE
  Pop-Location
} finally {
  if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
}

if ($code -ne 0) { Write-Host 'smoke test failed' -ForegroundColor Red; exit $code }
Write-Host 'verify: all green' -ForegroundColor Green
exit 0
