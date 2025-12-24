@echo off
echo Uploading extension files to 207.231.108.4...
echo.
echo You'll be prompted for the root password.
echo.
scp -r manifest.json background.js content.js popup.html popup.js icon*.png root@207.231.108.4:/root/
echo.
echo Upload complete!
pause



