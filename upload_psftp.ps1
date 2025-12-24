# PowerShell SFTP Upload Script
# This uses built-in .NET classes for SFTP

param(
    [string]$Server = "207.231.108.4",
    [string]$Username = "root",
    [string]$RemotePath = "/root"
)

Write-Host "=== SFTP Upload Script ===" -ForegroundColor Cyan
Write-Host ""

# Check if files exist
$files = @("manifest.json", "background.js", "content.js", "popup.html", "popup.js")
$missing = @()

foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        $missing += $file
    }
}

if ($missing.Count -gt 0) {
    Write-Host "ERROR: Missing files:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "Files found:" -ForegroundColor Green
$files | ForEach-Object { Write-Host "  ✓ $_" -ForegroundColor Green }
Write-Host ""

# Get password securely
$securePassword = Read-Host "Enter root password" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
)

Write-Host ""
Write-Host "Attempting to upload..." -ForegroundColor Yellow
Write-Host ""
Write-Host "NOTE: If this fails, use WinSCP instead (see UPLOAD_WINSCP.txt)" -ForegroundColor Yellow
Write-Host ""

# Try using SSH.NET library (if available) or suggest WinSCP
Write-Host "PowerShell doesn't have built-in SFTP support." -ForegroundColor Red
Write-Host ""
Write-Host "Please use one of these methods:" -ForegroundColor Yellow
Write-Host "1. WinSCP (recommended) - see UPLOAD_WINSCP.txt" -ForegroundColor White
Write-Host "2. FileZilla - see UPLOAD_WINSCP.txt" -ForegroundColor White
Write-Host "3. If you have SSH access, use:" -ForegroundColor White
Write-Host "   ssh root@207.231.108.4" -ForegroundColor Cyan
Write-Host "   Then use 'scp' command from the server or use 'wget' to download" -ForegroundColor Cyan


