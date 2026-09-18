@echo off
chcp 65001 >nul 2>&1
title Dify Demo Launcher

rem 切换到脚本所在目录（避免硬编码含中文的绝对路径，规避编码问题）
cd /d "%~dp0"

echo.
echo ====================================================================
echo   Demo Launcher - Diabetes Assistant
echo ====================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH.
    echo         Install Node.js 18+ from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

rem 一键启动：优先真实本地 Dify，失败自动降级到契约桩
node tools\dify-local-start.js %*

echo.
echo Press any key to close this window...
pause >nul
