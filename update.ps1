# Snapchat Filter Extension Auto-Updater
# Downloads latest version from GitHub and updates all files

$repoUrl = "https://github.com/mdkdkeooeo-eng/snap-indian/archive/refs/heads/main.zip"
$extensionPath = $PSScriptRoot
$tempZip = "$env:TEMP\snap-filter-update.zip"
$tempExtract = "$env:TEMP\snap-filter-update"

Write-Host "=== Snapchat Filter Extension Updater ===" -ForegroundColor Yellow
Write-Host ""

# Backup current settings
Write-Host "1. Backing up current settings..." -ForegroundColor Cyan
$settingsBackup = $null
if (Test-Path "$extensionPath\settings_backup.json") {
    $settingsBackup = Get-Content "$extensionPath\settings_backup.json" -Raw
}

# Download latest version
Write-Host "2. Downloading latest version from GitHub..." -ForegroundColor Cyan
try {
    # Remove old temp files
    if (Test-Path $tempZip) { Remove-Item $tempZip -Force }
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
    
    # Download zip
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $repoUrl -OutFile $tempZip -UseBasicParsing
    Write-Host "   Downloaded successfully!" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Failed to download - $_" -ForegroundColor Red
    Write-Host "   Please check your internet connection and try again." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Extract zip
Write-Host "3. Extracting files..." -ForegroundColor Cyan
try {
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
    Write-Host "   Extracted successfully!" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Failed to extract - $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Find the extracted folder (GitHub adds repo name to folder)
$extractedFolder = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
if (-not $extractedFolder) {
    Write-Host "   ERROR: Could not find extracted folder" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# List of files to update (skip user-specific files)
$filesToUpdate = @(
    "background.js",
    "content.js",
    "panel.html",
    "panel.js",
    "popup.html",
    "popup.js",
    "manifest.json"
)

# Update files
Write-Host "4. Updating extension files..." -ForegroundColor Cyan
$updatedCount = 0
foreach ($file in $filesToUpdate) {
    $sourcePath = Join-Path $extractedFolder.FullName $file
    $destPath = Join-Path $extensionPath $file
    
    if (Test-Path $sourcePath) {
        try {
            Copy-Item -Path $sourcePath -Destination $destPath -Force
            Write-Host "   Updated: $file" -ForegroundColor Green
            $updatedCount++
        } catch {
            Write-Host "   FAILED: $file - $_" -ForegroundColor Red
        }
    } else {
        Write-Host "   Skipped (not in update): $file" -ForegroundColor Gray
    }
}

# Also update any new files that don't exist yet
Write-Host "5. Checking for new files..." -ForegroundColor Cyan
$allSourceFiles = Get-ChildItem -Path $extractedFolder.FullName -File
foreach ($sourceFile in $allSourceFiles) {
    $destPath = Join-Path $extensionPath $sourceFile.Name
    if (-not (Test-Path $destPath)) {
        # Skip certain files
        if ($sourceFile.Name -notmatch "^(\.git|README|LICENSE|\.md|upload|UPLOAD|HOW_TO|INSTALL|SSH_|EASIEST|QUICK|Windows PowerShell)") {
            try {
                Copy-Item -Path $sourceFile.FullName -Destination $destPath -Force
                Write-Host "   Added new file: $($sourceFile.Name)" -ForegroundColor Green
                $updatedCount++
            } catch {
                Write-Host "   FAILED to add: $($sourceFile.Name)" -ForegroundColor Red
            }
        }
    }
}

# Cleanup
Write-Host "6. Cleaning up..." -ForegroundColor Cyan
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "   Done!" -ForegroundColor Green

# Summary
Write-Host ""
Write-Host "=== Update Complete ===" -ForegroundColor Yellow
Write-Host "Updated $updatedCount files" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Reload the extension in Chrome/Edge:" -ForegroundColor Yellow
Write-Host "1. Go to chrome://extensions/ or edge://extensions/" -ForegroundColor White
Write-Host "2. Find 'Snapchat Friend Filter'" -ForegroundColor White
Write-Host "3. Click the refresh/reload icon" -ForegroundColor White
Write-Host "4. Refresh the Snapchat web page" -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to exit"

