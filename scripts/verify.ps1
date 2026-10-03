# scripts/verify.ps1 -- the single gate for every autonomous run.
# Runs: pytest -> contrast -> frontend gates -> Electron tests (npm test).
# Exit code is non-zero if any stage fails.
#
# The Electron stage is self-contained (frontend/test/harness): Playwright's
# global setup builds a fresh fixture tree in a temp folder, starts the
# backend on FILEPLUS_PORT with FILEPLUS_ENV=test and FILEPLUS_ROOT pointing at
# it, gives Electron a throwaway profile, and its teardown stops the backend
# and deletes the folder. This script no longer starts a backend of its own,
# and no longer rebuilds the dev sandbox (FilePlusTestSandbox\_gen) -- tests
# never read it. Logs of the run: artifacts\logs\{backend,main,renderer}.log.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# The test backend runs on 9877, not the default 9876, so verify can run
# alongside a developer's already-running instance without a bind conflict.
# The harness reads FILEPLUS_PORT (default 9877 there too) and hands it to the
# backend it starts and to the Electron app (main.js/preload.js apiPort()).
$env:FILEPLUS_PORT = '9877'

try {
  Get-Command py, npm -ErrorAction Stop | Out-Null
} catch {
  Write-Host 'py or npm not found on PATH' -ForegroundColor Red
  exit 1
}

Write-Host '== 1/4 pytest ==' -ForegroundColor Cyan
py -3 -m pytest -q
if ($LASTEXITCODE -ne 0) { Write-Host 'pytest failed' -ForegroundColor Red; exit 1 }

Write-Host '== 2/4 contrast ==' -ForegroundColor Cyan
py -3 scripts/contrast_check.py frontend/src/styles.css
if ($LASTEXITCODE -ne 0) { Write-Host 'contrast check failed' -ForegroundColor Red; exit 1 }

Write-Host '== 3/4 frontend gates ==' -ForegroundColor Cyan
if (Test-Path frontend/src/actions.js) {
  Write-Host 'frontend/src/actions.js must not exist (dead ACTIONS registry — see CLAUDE.md)' -ForegroundColor Red
  exit 1
}
$stubCalls = Select-String -Path frontend/src/*.js -Pattern 'stub(' -SimpleMatch
if ($stubCalls) { Write-Host 'stub( call left in frontend/src' -ForegroundColor Red; exit 1 }
# check_menu_cases: every cm-* menu action has a switch case, and every
# data-action in index.html / src templates reaches a case or IN_SCOPE_ACTIONS
# -- nothing clickable falls into the "not yet implemented" stub branch.
node scripts/check_menu_cases.js
if ($LASTEXITCODE -ne 0) { Write-Host 'check_menu_cases failed' -ForegroundColor Red; exit 1 }
node scripts/check_icons.js
if ($LASTEXITCODE -ne 0) { Write-Host 'check_icons failed' -ForegroundColor Red; exit 1 }
# check_motion: every duration/easing in styles.css is a --motion-*/--ease-*
# token (200 ms ceiling), every animation sits under the html[data-motion]
# switch, prefers-reduced-motion gates nothing, JS animates only via fpAnimate.
node scripts/check_motion.js
if ($LASTEXITCODE -ne 0) { Write-Host 'check_motion failed' -ForegroundColor Red; exit 1 }
# check_layers: one z-index scale (--z-* tokens on :root, in order); every
# z-index in styles.css is on it; none in index.html or the JS (addendum §3).
node scripts/check_layers.js
if ($LASTEXITCODE -ne 0) { Write-Host 'check_layers failed' -ForegroundColor Red; exit 1 }

# filetypes parity: frontend/src/filetypes.js is generated from
# backend/filetypes.py (scripts/build_filetypes.py); tests/test_filetypes.py
# ::test_generated_js_is_current checks the same thing inside pytest, but a
# stale generated file is easy to miss in a long pytest tail -- this gate
# puts it front and centre in the frontend-gates stage instead.
$filetypesTmpDir = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Force $filetypesTmpDir | Out-Null
$filetypesTmp = Join-Path $filetypesTmpDir 'filetypes-parity.js'
try {
  py -3 scripts/build_filetypes.py $filetypesTmp
  if ($LASTEXITCODE -ne 0) { Write-Host 'build_filetypes.py failed' -ForegroundColor Red; exit 1 }
  # Compare with line endings normalised: git autocrlf checks the committed
  # file out with CRLF while the generator writes LF (pytest compares in text
  # mode for the same reason).
  $filetypesGen = ([IO.File]::ReadAllText($filetypesTmp)) -replace "`r`n", "`n"
  $filetypesCur = ([IO.File]::ReadAllText((Join-Path $root 'frontend/src/filetypes.js'))) -replace "`r`n", "`n"
  if ($filetypesGen -cne $filetypesCur) {   # case-sensitive: -ne ignores case
    Write-Host 'frontend/src/filetypes.js is stale -- run: py -3 scripts/build_filetypes.py' -ForegroundColor Red
    exit 1
  }
} finally {
  # Remove the temp file even when build_filetypes.py itself failed partway
  # (e.g. wrote a partial file before erroring) -- not just on the success path.
  Remove-Item $filetypesTmp -ErrorAction SilentlyContinue
}
Write-Host 'check_filetypes_parity: ok (frontend/src/filetypes.js matches backend/filetypes.py)' -ForegroundColor Green

Write-Host '== 4/4 electron tests (harness starts its own backend) ==' -ForegroundColor Cyan
$code = 1
Push-Location (Join-Path $root 'frontend')
try {
  # Electron-based dev shells export ELECTRON_RUN_AS_NODE, which turns Electron into plain Node;
  # the harness also strips it, this is belt and braces.
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $global:LASTEXITCODE = 1  # so a non-terminating launch failure cannot inherit pytest's 0
  npm test
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($code -ne 0) { Write-Host 'electron tests failed -- see artifacts\logs and artifacts\test-results' -ForegroundColor Red; exit $code }
Write-Host 'verify: all green' -ForegroundColor Green
exit 0
