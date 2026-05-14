# 하자 카테고리 DB 마이그레이션 (002) — npm 없이 Cursor 번들 Node로 실행 가능
# 사용: 프로젝트 루트에서
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-migrate-defect-categories.ps1

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$cursorNode = Join-Path $env:LOCALAPPDATA 'Programs\cursor\resources\app\resources\helpers\node.exe'
$nodeExe = $null
if (Test-Path $cursorNode) {
  $nodeExe = $cursorNode
}
elseif (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeExe = (Get-Command node).Source
}

if (-not $nodeExe) {
  Write-Host 'Node.js를 찾을 수 없습니다. https://nodejs.org 설치 후 다시 실행하세요.' -ForegroundColor Red
  exit 1
}

$pgPath = Join-Path $RepoRoot 'backend\node_modules\pg\package.json'
if (-not (Test-Path $pgPath)) {
  Write-Host 'backend/node_modules 가 없습니다. npm이 있으면 자동으로 설치합니다...' -ForegroundColor Yellow
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Push-Location (Join-Path $RepoRoot 'backend')
    npm install --no-fund --no-audit
    Pop-Location
  }
  else {
    Write-Host 'npm이 없습니다. Node가 설치된 터미널에서: cd backend && npm install' -ForegroundColor Red
    exit 1
  }
}

Write-Host "Node: $nodeExe" -ForegroundColor DarkGray
& $nodeExe (Join-Path $RepoRoot 'backend\scripts\run-defect-categories-migration.js')
exit $LASTEXITCODE
