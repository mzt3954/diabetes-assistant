@echo off
chcp 65001 >nul 2>&1
title Dify Demo Launcher

rem ====================================================================
rem  IMPORTANT: keep this file PURE ASCII.
rem  cmd.exe reads .cmd/.bat using the OEM code page (936 on zh-CN
rem  Windows). If this file contained non-ASCII bytes saved as UTF-8,
rem  they would be mis-decoded as GBK, which shifts the parser and
rem  breaks lines (e.g. "if errorlevel" / "node ..." get corrupted).
rem  All user-facing text is therefore kept in English on purpose.
rem  The Chinese output produced by the Node.js child process still
rem  renders correctly because of the "chcp 65001" above.
rem ====================================================================

rem Switch to this script's own folder, so no hard-coded Chinese
rem absolute path is needed (avoids encoding problems entirely).
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

rem One-click start: real local Dify first, auto fallback to contract stub.
node tools\dify-local-start.js %*

echo.
echo Press any key to close this window...
pause >nul
