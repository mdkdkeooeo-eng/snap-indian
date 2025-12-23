# PowerShell script to create a ZIP file of the extension
$sourceDir = Get-Location
$zipFile = Join-Path $sourceDir "snapchat-filter-extension.zip"

# Files to include
$filesToInclude = @(
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    "icon16.png",
    "icon48.png",
    "icon128.png"
)

# Create ZIP
Compress-Archive -Path $filesToInclude -DestinationPath $zipFile -Force

Write-Host "ZIP file created: $zipFile"
Write-Host "Files included:"
$filesToInclude | ForEach-Object { Write-Host "  - $_" }

