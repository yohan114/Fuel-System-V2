@echo off
title Fuel System Server
cd /d "D:\Yohan\Fuel System"
echo Checking if port 6600 is already in use...
netstat -aon | findstr :6600 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo Port 6600 is already in use! The server might already be running.
    timeout /t 5 >nul
    exit /b
)
echo Starting Fuel System Server on port 6600...
npm run start
