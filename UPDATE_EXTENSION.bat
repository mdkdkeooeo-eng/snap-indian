@echo off
title Snapchat Filter Extension Updater
color 0E

echo ========================================
echo   Snapchat Filter Extension Updater
echo ========================================
echo.
echo This will download and install the latest
echo version from GitHub.
echo.
echo Your settings will be preserved!
echo.
pause

powershell -ExecutionPolicy Bypass -File "%~dp0update.ps1"


