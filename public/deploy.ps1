$token = "vck_48YnbvuxUmq8paFxKSsdLShyDE13tpR5Vytvdpr0jrKTfYqDsP1uaux5"
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

$indexContent = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content "C:\Users\user\.gemini\antigravity\scratch\ledgergo\index.html" -Raw)))
$styleContent = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content "C:\Users\user\.gemini\antigravity\scratch\ledgergo\style.css" -Raw)))
$appContent   = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content "C:\Users\user\.gemini\antigravity\scratch\ledgergo\app_v22.js" -Raw)))

$bodyObj = [ordered]@{
    name   = "ledgergo-offline-pc-to-cloud"
    target = "production"
    files  = @(
        [ordered]@{ file = "index.html"; data = $indexContent; encoding = "base64" }
        [ordered]@{ file = "style.css";  data = $styleContent; encoding = "base64" }
        [ordered]@{ file = "app_v22.js"; data = $appContent;   encoding = "base64" }
    )
}

$body = $bodyObj | ConvertTo-Json -Depth 10 -Compress

Write-Host "Deploying to Vercel..."
try {
    $response = Invoke-RestMethod -Uri "https://api.vercel.com/v13/deployments" -Method Post -Headers $headers -Body $body -TimeoutSec 60
    Write-Host "SUCCESS!"
    $url = $response.url
    Write-Host "Live URL: https://$url"
    Write-Host "Status: $($response.readyState)"
    Write-Host "ID: $($response.id)"
} catch {
    Write-Host "FAILED:"
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}
