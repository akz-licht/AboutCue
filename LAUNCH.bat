@echo off
title Qnote for EOS
echo.
echo ========================================
echo   Starting Qnote for EOS...
echo ========================================
echo.
echo Opening your default browser...
echo The app will be available at: http://localhost:5000
echo.
echo Press Ctrl+C to stop the server
echo.

start http://localhost:5000
node standalone-server.js

pause
