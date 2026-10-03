@echo off
REM ---------------------------------------------------------------
REM  Builds PDF Bench into a Windows installer and a portable .exe.
REM  Requires Node.js 20 or newer: https://nodejs.org
REM  Output lands in the release\ folder.
REM ---------------------------------------------------------------
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

echo Installing dependencies...
call npm install || goto :failed

echo Building the application...
call npm run build || goto :failed

echo Packaging for Windows...
call npx electron-builder --win --x64 || goto :failed

echo.
echo Done. Look in the release folder:
echo   "PDF Bench-1.0.0-x64.exe"       installer
echo   "PDF Bench-1.0.0-portable.exe"  single-file portable build
pause
exit /b 0

:failed
echo.
echo The build failed. Scroll up for the error.
pause
exit /b 1
