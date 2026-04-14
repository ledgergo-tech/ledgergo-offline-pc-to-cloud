@echo off
title LEDGERGO - Data Backup
cd /d "%~dp0"
set BACKUP_DIR=backups
if not exist %BACKUP_DIR% mkdir %BACKUP_DIR%
set TIMESTAMP=%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%_%TIME:~0,2%%TIME:~3,2%
set TIMESTAMP=%TIMESTAMP: =0%
set FOLDER_NAME=backup_%TIMESTAMP%
mkdir %BACKUP_DIR%\%FOLDER_NAME%
xcopy /s /e /i data %BACKUP_DIR%\%FOLDER_NAME% >nul
echo.
echo ==========================================
echo   Data Backup Successful!
echo ==========================================
echo   Backup saved to: %BACKUP_DIR%\%FOLDER_NAME%
echo ==========================================
echo.
pause
