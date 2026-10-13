@echo off
title Clinic Patient Records System
cd /d "%~dp0"

echo ========================================================
echo        Clinic Patient Records Management System
echo ========================================================
echo.
echo Starting server and launching browser...
echo Please keep this terminal window open while using the app.
echo.

if exist "runtime\node.exe" (
    "runtime\node.exe" dist\server.js
) else (
    node dist\server.js
)

pause
