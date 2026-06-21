# InsightI 로컬 개발 실행 (백엔드 + 점검원 웹앱)
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$cursorNode = Join-Path $env:LOCALAPPDATA 'Programs\cursor\resources\app\resources\helpers\node.exe'
$nodeExe = $null
if (Test-Path $cursorNode) {
  $nodeExe = $cursorNode
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeExe = (Get-Command node).Source
}

if (-not $nodeExe) {
  Write-Host 'Node.js를 찾을 수 없습니다. https://nodejs.org 설치 후 다시 실행하세요.' -ForegroundColor Red
  exit 1
}

$pgPath = Join-Path $RepoRoot 'backend\node_modules\pg\package.json'
if (-not (Test-Path $pgPath)) {
  Write-Host 'backend 의존성 설치 중...' -ForegroundColor Yellow
  Push-Location (Join-Path $RepoRoot 'backend')
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    npm install --legacy-peer-deps
  } else {
    Write-Host 'npm이 PATH에 없습니다. backend 폴더에서 npm install 을 먼저 실행하세요.' -ForegroundColor Red
    Pop-Location
    exit 1
  }
  Pop-Location
}

Write-Host 'DB 연결 확인 중...' -ForegroundColor Cyan
Push-Location (Join-Path $RepoRoot 'backend')
& $nodeExe scripts/create-inspector-household.js
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'DB 연결 실패. backend/.env 의 DATABASE_URL 을 Render External Database URL 로 갱신하세요.' -ForegroundColor Red
  Write-Host 'Render Blueprint(render.yaml) 재배포 후 대시보드에서 URL을 복사해 넣으면 됩니다.' -ForegroundColor Yellow
  Pop-Location
  exit 1
}
Pop-Location

Write-Host '백엔드 시작 (http://127.0.0.1:3000)...' -ForegroundColor Green
$backendJob = Start-Job -ScriptBlock {
  param($NodeExe, $BackendDir)
  Set-Location $BackendDir
  & $NodeExe server.js 2>&1
} -ArgumentList $nodeExe, (Join-Path $RepoRoot 'backend')

Start-Sleep -Seconds 3

Write-Host '웹앱 시작 (http://127.0.0.1:8080/inspector.html)...' -ForegroundColor Green
$webJob = Start-Job -ScriptBlock {
  param($NodeExe, $Repo)
  Set-Location $Repo
  & $NodeExe scripts/serve-webapp.js 2>&1
} -ArgumentList $nodeExe, $RepoRoot

Start-Sleep -Seconds 2

try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health?db=1' -TimeoutSec 15
  Write-Host ('백엔드 상태: ' + ($health | ConvertTo-Json -Compress)) -ForegroundColor Cyan
} catch {
  Write-Host ('백엔드 health 확인 실패: ' + $_.Exception.Message) -ForegroundColor Yellow
}

Write-Host ''
Write-Host '점검원 화면: http://127.0.0.1:8080/inspector.html' -ForegroundColor Green
Write-Host '종료: Ctrl+C 또는 Stop-Job -Id ' $backendJob.Id ',' $webJob.Id -ForegroundColor DarkGray

try {
  while ($true) {
    Start-Sleep -Seconds 5
    if ($backendJob.State -eq 'Failed' -or $webJob.State -eq 'Failed') {
      Write-Host '백그라운드 작업이 종료되었습니다.' -ForegroundColor Red
      Receive-Job $backendJob, $webJob
      break
    }
  }
} finally {
  Stop-Job $backendJob, $webJob -ErrorAction SilentlyContinue
  Remove-Job $backendJob, $webJob -Force -ErrorAction SilentlyContinue
}
