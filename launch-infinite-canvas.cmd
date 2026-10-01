@echo off
setlocal
title Infinite Canvas Launcher
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0launch-infinite-canvas.ps1" %*
exit /b %errorlevel%
