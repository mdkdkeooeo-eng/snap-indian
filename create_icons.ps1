# Create placeholder icons for the extension
Add-Type -AssemblyName System.Drawing

$sizes = @(16, 48, 128)

foreach ($size in $sizes) {
    # Create bitmap
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Yellow background (Snapchat color #FFFC00)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 252, 0))
    $graphics.FillRectangle($brush, 0, 0, $size, $size)
    
    # Add "S" letter
    $font = New-Object System.Drawing.Font('Arial', [int]($size * 0.6), [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = 'Center'
    $format.LineAlignment = 'Center'
    
    $graphics.DrawString('S', $font, $textBrush, [int]($size/2), [int]($size/2), $format)
    
    # Save
    $bmp.Save("icon$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
    
    # Cleanup
    $graphics.Dispose()
    $bmp.Dispose()
    $brush.Dispose()
    $textBrush.Dispose()
    $font.Dispose()
    
    Write-Host "Created icon$size.png" -ForegroundColor Green
}

Write-Host "`nAll icons created successfully!" -ForegroundColor Cyan



