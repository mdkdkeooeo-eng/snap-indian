# Simple upload script for root user
Write-Host "Uploading extension files to 207.231.108.4 as root..." -ForegroundColor Green
Write-Host ""
Write-Host "You'll be prompted for the root password." -ForegroundColor Yellow
Write-Host ""

# Change to script directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Upload files
scp manifest.json background.js content.js popup.html popup.js root@207.231.108.4:/root/

# Upload icons if they exist
if (Test-Path "icon16.png") { scp icon16.png root@207.231.108.4:/root/ }
if (Test-Path "icon48.png") { scp icon48.png root@207.231.108.4:/root/ }
if (Test-Path "icon128.png") { scp icon128.png root@207.231.108.4:/root/ }

Write-Host ""
Write-Host "Upload complete!" -ForegroundColor Green

