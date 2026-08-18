@echo off
title Stop Fuel System Server
echo Finding and stopping process running on port 3300...
set "pid="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3300 ^| findstr LISTENING') do set "pid=%%a"
if defined pid (
    echo Killing process PID: %pid%...
    taskkill /f /pid %pid%
    echo Server stopped successfully.
) else (
    echo No active process found listening on port 3300.
)
timeout /t 3
