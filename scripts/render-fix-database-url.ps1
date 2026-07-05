# Render DATABASE_URL 수정 + 재배포 (Render API)
# 사용법:
#   $env:RENDER_API_KEY = "rnd_..."
#   .\scripts\render-fix-database-url.ps1
#
# 또는:
#   .\scripts\render-fix-database-url.ps1 -ApiKey "rnd_..." -ServiceName "insighti-app-new"

param(
  [string]$ApiKey = $env:RENDER_API_KEY,
  [string]$ServiceName = "insighti-app-new",
  [string]$Region = "singapore"
)

$ErrorActionPreference = "Stop"

function Get-NormalizedDatabaseUrl([string]$RawUrl) {
  if (-not $RawUrl) { return $null }
  $url = $RawUrl.Trim()
  if ($url -match '@(dpg-[a-z0-9]+-[a-z])(/|:)') {
    $short = $Matches[1]
    $full = "$short.$Region-postgres.render.com"
    $url = $url -replace [regex]::Escape($short), $full
  }
  return $url
}

if (-not $ApiKey) {
  Write-Host "RENDER_API_KEY 가 필요합니다."
  Write-Host "Render Dashboard → Account Settings → API Keys 에서 발급 후:"
  Write-Host '  $env:RENDER_API_KEY = "rnd_..."'
  Write-Host "  .\scripts\render-fix-database-url.ps1"
  exit 1
}

$headers = @{
  Authorization = "Bearer $ApiKey"
  Accept        = "application/json"
  "Content-Type" = "application/json"
}

Write-Host "Render 서비스 목록 조회 중..."
$cursor = ""
$serviceId = $null
$serviceUrl = $null
do {
  $uri = "https://api.render.com/v1/services?limit=100"
  if ($cursor) { $uri += "&cursor=$cursor" }
  $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
  foreach ($item in $resp) {
    $svc = $item.service
    if ($svc.name -eq $ServiceName -or $svc.serviceDetails.url -like "*$ServiceName*") {
      $serviceId = $svc.id
      $serviceUrl = $svc.serviceDetails.url
      break
    }
  }
  $cursor = $resp[-1].cursor
} while (-not $serviceId -and $cursor)

if (-not $serviceId) {
  Write-Host "서비스 '$ServiceName' 을(를) 찾지 못했습니다."
  exit 1
}

Write-Host "대상 서비스: $ServiceName ($serviceId) -> $serviceUrl"

Write-Host "환경 변수 조회 중..."
$envResp = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/env-vars?limit=100" -Headers $headers -Method GET
$envMap = @{}
foreach ($row in $envResp) {
  $envMap[$row.envVar.key] = $row.envVar.value
}

$currentDb = $envMap["DATABASE_URL"]
if (-not $currentDb) {
  Write-Host "DATABASE_URL 이 서비스에 없습니다. Render PostgreSQL 연결을 확인하세요."
  exit 1
}

$normalizedDb = Get-NormalizedDatabaseUrl $currentDb
Write-Host "현재 DB host: $(([uri]$currentDb).Host)"
Write-Host "수정 DB host: $(([uri]$normalizedDb).Host)"

$body = @(
  @{ key = "DATABASE_URL"; value = $normalizedDb }
  @{ key = "RENDER_REGION"; value = $Region }
) | ConvertTo-Json -Depth 3

Write-Host "환경 변수 업데이트 중..."
Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/env-vars" -Headers $headers -Method PUT -Body $body | Out-Null

Write-Host "재배포 트리거 중..."
$deploy = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/deploys" -Headers $headers -Method POST -Body '{"clearCache":"clear"}'
Write-Host "Deploy ID: $($deploy.id) status=$($deploy.status)"

Write-Host ""
Write-Host "완료. 배포 후 확인:"
Write-Host "  curl https://$ServiceName.onrender.com/health"
Write-Host '  curl "https://'$ServiceName'.onrender.com/health?db=1"'
