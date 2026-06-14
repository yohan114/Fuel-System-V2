@echo off
title Stop Fuel System Server
echo Finding and stopping process running on port 6600...
set "pid="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :6600 ^| findstr LISTENING') do set "pid=%%a"
if defined pid (
    echo Killing process PID: %pid%...
    taskkill /f /pid %pid%
    echo Server stopped successfully.
) else (
    echo No active process found listening on port 6600.
)
timeout /t 3
