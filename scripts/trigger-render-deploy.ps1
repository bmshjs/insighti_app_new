# Render Manual Deploy Hook (선택)
# Render Dashboard → insighti-app-new → Settings → Deploy Hook URL 복사 후:
#   $env:RENDER_DEPLOY_HOOK_URL = "https://api.render.com/deploy/srv-..."
param(
  [string]$DeployHookUrl = $env:RENDER_DEPLOY_HOOK_URL
)

if (-not $DeployHookUrl) {
  Write-Host "RENDER_DEPLOY_HOOK_URL 이 없습니다. main push 로 자동 배포되거나 Dashboard 에서 Manual Deploy 하세요."
  exit 1
}

Write-Host "Render 배포 트리거 중..."
$response = Invoke-WebRequest -Uri $DeployHookUrl -Method POST -UseBasicParsing
Write-Host "HTTP $($response.StatusCode)"
Write-Host $response.Content
