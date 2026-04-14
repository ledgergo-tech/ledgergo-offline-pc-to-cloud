@echo off
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>nul
echo LEDGERGO stopped on port 3000.
pause
