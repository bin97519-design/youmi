@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-youmi.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Check runtime-logs for details.
)
pause
