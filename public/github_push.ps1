# GitHub API se files push karna
# Pehle aapko GitHub Personal Access Token chahiye
# https://github.com/settings/tokens/new par jaakar token banayein

param(
    [string]$GithubToken = ""
)

if (-not $GithubToken) {
    Write-Host "ERROR: GitHub token required!"
    Write-Host "Please run: .\github_push.ps1 -GithubToken 'your_token_here'"
    Write-Host ""
    Write-Host "Get token from: https://github.com/settings/tokens/new"
    Write-Host "Select scope: repo (full control)"
    exit 1
}

$owner = "ledgergo-tech"
$repo = "ledgergo-offline-pc-to-cloud"
$branch = "main"
$headers = @{
    Authorization = "Bearer $GithubToken"
    "Content-Type" = "application/json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$files = @{
    "public/index.html" = "C:\Users\user\.gemini\antigravity\scratch\ledgergo\index.html"
    "public/style.css"  = "C:\Users\user\.gemini\antigravity\scratch\ledgergo\style.css"
    "public/app_v22.js" = "C:\Users\user\.gemini\antigravity\scratch\ledgergo\app_v22.js"
}

foreach ($filePath in $files.Keys) {
    $localPath = $files[$filePath]
    Write-Host "Uploading $filePath ..."
    
    # Get current file SHA (needed for update)
    try {
        $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/contents/$filePath" -Headers $headers
        $sha = $existing.sha
    } catch {
        $sha = $null
    }
    
    $content = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content $localPath -Raw -Encoding UTF8)))
    
    $body = @{
        message = "deploy: update $filePath with latest fixes"
        content = $content
        branch  = $branch
    }
    if ($sha) { $body.sha = $sha }
    
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/contents/$filePath" -Method Put -Headers $headers -Body ($body | ConvertTo-Json -Compress)
        Write-Host "SUCCESS: $filePath updated!"
    } catch {
        Write-Host "FAILED: $filePath - $($_.ErrorDetails.Message)"
    }
}

Write-Host ""
Write-Host "Done! Vercel will auto-deploy in 1-2 minutes."
Write-Host "URL: https://ledgergo-offline-pc-to-cloud.vercel.app"
