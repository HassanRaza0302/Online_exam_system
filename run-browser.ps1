$backendPath = Join-Path $PSScriptRoot "backend"
$appUrl = "http://localhost:3011"
$chromePaths = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if (-not (Test-Path $backendPath)) {
  Write-Error "Backend folder not found at: $backendPath"
  exit 1
}

Set-Location $backendPath

if (-not (Test-Path (Join-Path $backendPath "node_modules"))) {
  Write-Host "Installing backend dependencies..."
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install failed."
    exit $LASTEXITCODE
  }
}

Write-Host "Opening $appUrl in your browser..."
$chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chromeExe) {
  Start-Process $chromeExe $appUrl
} else {
  Write-Host "Chrome not found, opening in default browser."
  Start-Process $appUrl
}

Write-Host "Starting backend server..."
npm start
