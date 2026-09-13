# scripts/verify.ps1 — the single gate for every autonomous run.
# Runs: fixtures -> pytest -> contrast -> frontend gates -> start backend ->
# Electron smoke test -> stop backend.
# Exit code is non-zero if any stage fails.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# verify runs its own backend on 9877, not the default 9876, so it can run
# alongside a developer's already-running instance without a bind conflict
# or verify wrongly refusing to start ("port already in use"). backend/api.py
# reads this via config.FILEPLUS_PORT; the Electron app (started by npm test,
# below) reads it via main.js/preload.js's apiPort() bridge, and
# frontend/test/smoke.spec.js reads it directly from process.env.
$env:FILEPLUS_PORT = '9877'
$backendPort = $env:FILEPLUS_PORT
$healthUrl = "http://127.0.0.1:$backendPort/health"

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
      Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1 | Out-Null
      $stillUp = $true
    } catch {
      $stillUp = $false
      break
    }
  }
  if ($stillUp) {
    Write-Host "backend still listening on $backendPort after stop" -ForegroundColor Red
    $script:teardownFailed = $true
  }
}

Write-Host '== 1/6 fixtures ==' -ForegroundColor Cyan
py -3 scripts/gen_sandbox.py
if ($LASTEXITCODE -ne 0) { Write-Host 'sandbox generation failed' -ForegroundColor Red; exit 1 }

Write-Host '== 2/6 pytest ==' -ForegroundColor Cyan
py -3 -m pytest -q
if ($LASTEXITCODE -ne 0) { Write-Host 'pytest failed' -ForegroundColor Red; exit 1 }

Write-Host '== 3/6 contrast ==' -ForegroundColor Cyan
py -3 scripts/contrast_check.py frontend/src/styles.css
if ($LASTEXITCODE -ne 0) { Write-Host 'contrast check failed' -ForegroundColor Red; exit 1 }

Write-Host '== 4/6 frontend gates ==' -ForegroundColor Cyan
if (Test-Path frontend/src/actions.js) {
  Write-Host 'frontend/src/actions.js must not exist (dead ACTIONS registry — see CLAUDE.md)' -ForegroundColor Red
  exit 1
}
$stubCalls = Select-String -Path frontend/src/*.js -Pattern 'stub(' -SimpleMatch
if ($stubCalls) { Write-Host 'stub( call left in frontend/src' -ForegroundColor Red; exit 1 }
$stubScreens = (Select-String -Path frontend/src/app.js -Pattern 'showToast\(STUB_SCREENS' -SimpleMatch).Count
if ($stubScreens -ne 0) { Write-Host 'showToast(STUB_SCREENS still referenced in app.js' -ForegroundColor Red; exit 1 }
node scripts/check_menu_cases.js
if ($LASTEXITCODE -ne 0) { Write-Host 'check_menu_cases failed' -ForegroundColor Red; exit 1 }
node scripts/check_icons.js
if ($LASTEXITCODE -ne 0) { Write-Host 'check_icons failed' -ForegroundColor Red; exit 1 }

Write-Host '== 5/6 backend ==' -ForegroundColor Cyan

try {
  Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1 | Out-Null
  Write-Host "port $backendPort already in use; stop that backend first (verify never kills a process it did not start)" -ForegroundColor Red
  exit 1
} catch { }

New-Item -ItemType Directory -Force (Join-Path $root 'artifacts') | Out-Null
# Fresh DB every run -- otherwise state (tags/history/undo rows) from an
# earlier run, including a failed one, leaks into this run's screenshots and
# history assertions.
Remove-Item (Join-Path $root 'artifacts\verify.db*') -ErrorAction SilentlyContinue
# keep verify off the developer's real fileplus.db; load_dotenv does not override an existing env var
$env:FILEPLUS_DB_PATH = Join-Path $root 'artifacts\verify.db'
# belt and braces: the smoke run never unlocks writes outside the sandbox
$env:WRITE_UNLOCKED = 'false'
# fixed dev token: inherited by the backend (Start-Process below) and by
# npm test (Electron reads it via main.js, the smoke test via process.env)
$env:FILEPLUS_API_TOKEN = 'fileplus-dev-token'

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
    $r = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1
    if ($r.StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
  Write-Host 'backend did not answer /health within 60 s' -ForegroundColor Red
  Stop-Backend $backend
  exit 1
}

Write-Host '== 6/6 electron smoke ==' -ForegroundColor Cyan
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
