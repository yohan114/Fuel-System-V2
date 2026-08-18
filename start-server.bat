@echo off
title Fuel System Server
cd /d "d:\new testing fuel server"
echo Checking if port 3300 is already in use...
netstat -aon | findstr :3300 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo Port 3300 is already in use! The server might already be running.
    timeout /t 5 >nul
    exit /b
)
echo Starting Fuel System Server on port 3300...
npm run start
