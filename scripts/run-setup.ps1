$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== Online Exam System — quick setup ===" -ForegroundColor Cyan

Set-Location (Join-Path $ProjectRoot "backend")
Write-Host "Installing npm packages..."
npm install
if ($LASTEXITCODE -ne 0) { exit 1 }

Set-Location $ProjectRoot

Write-Host "`nTesting database connection..."
npm run db:test
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nConnection failed. Run the full Windows setup as Administrator:" -ForegroundColor Yellow
    Write-Host "  npm run setup"
    exit 1
}

Write-Host "`nApplying database schema..."
npm run db:apply
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "`nStarting server..."
npm start
