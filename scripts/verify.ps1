# scripts/verify.ps1 — the single gate for every autonomous run.
# Runs: pytest -> start backend -> Electron smoke test -> stop backend.
# Exit code is non-zero if any stage fails.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

try {
  Get-Command py, npm -ErrorAction Stop | Out-Null
} catch {
  Write-Host 'py or npm not found on PATH' -ForegroundColor Red
  exit 1
}

function Stop-Backend {
  param($proc)
  if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
  $stillUp = $false
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9876/health' -TimeoutSec 1 | Out-Null
      $stillUp = $true
    } catch {
      $stillUp = $false
      break
    }
  }
  if ($stillUp) {
    Write-Host 'backend still listening on 9876 after stop' -ForegroundColor Red
    $script:teardownFailed = $true
  }
}

Write-Host '== 1/3 pytest ==' -ForegroundColor Cyan
py -3 -m pytest -q
if ($LASTEXITCODE -ne 0) { Write-Host 'pytest failed' -ForegroundColor Red; exit 1 }

Write-Host '== 2/3 backend ==' -ForegroundColor Cyan

try {
  Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9876/health' -TimeoutSec 1 | Out-Null
  Write-Host 'port 9876 already in use; stop that backend first (verify never kills a process it did not start)' -ForegroundColor Red
  exit 1
} catch { }

New-Item -ItemType Directory -Force (Join-Path $root 'artifacts') | Out-Null
# keep verify off the developer's real fileplus.db; load_dotenv does not override an existing env var
$env:FILEPLUS_DB_PATH = Join-Path $root 'artifacts\verify.db'

$script:teardownFailed = $false
$backend = Start-Process -FilePath 'py' -ArgumentList '-3', '-m', 'backend.api' `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  if ($backend.HasExited) {
    Write-Host 'backend process exited during startup' -ForegroundColor Red
    exit 1
  }
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9876/health' -TimeoutSec 1
    if ($r.StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
  Write-Host 'backend did not answer /health within 60 s' -ForegroundColor Red
  Stop-Backend $backend
  exit 1
}

Write-Host '== 3/3 electron smoke ==' -ForegroundColor Cyan
$code = 1
try {
  Push-Location (Join-Path $root 'frontend')
  # Electron-based dev shells export ELECTRON_RUN_AS_NODE, which turns Electron into plain Node;
  # the smoke test also strips it, this is belt and braces.
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $global:LASTEXITCODE = 1  # so a non-terminating launch failure cannot inherit pytest's 0
  npm test
  $code = $LASTEXITCODE
  Pop-Location
} finally {
  Stop-Backend $backend
}

if ($code -ne 0) { Write-Host 'smoke test failed' -ForegroundColor Red; exit $code }
if ($script:teardownFailed) { exit 1 }
Write-Host 'verify: all green' -ForegroundColor Green
exit 0
