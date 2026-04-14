@echo off
title LEDGERGO Offline PC
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js not found.
  echo Please install Node.js first, then run this file again.
  echo Download from: https://nodejs.org/
  echo.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause
