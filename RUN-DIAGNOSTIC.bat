@echo off
title Qnote for EOS - Diagnostic
echo.
echo ========================================
echo   Qnote for EOS - Diagnostic Tool
echo ========================================
echo.
echo Checking Node.js installation...
node --version
echo.
echo Checking if port 5000 is available...
netstat -ano | findstr :5000
echo.
echo Checking project files...
if exist standalone-server.js (
    echo [OK] standalone-server.js found
) else (
    echo [ERROR] standalone-server.js NOT FOUND
)
if exist package.json (
    echo [OK] package.json found
) else (
    echo [ERROR] package.json NOT FOUND
)
if exist public\index.html (
    echo [OK] public\index.html found
) else (
    echo [ERROR] public\index.html NOT FOUND
)
if exist data (
    echo [OK] data folder exists
) else (
    echo [ERROR] data folder NOT FOUND
)
echo.
echo Diagnostic complete.
echo.
pause
