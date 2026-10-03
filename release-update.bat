@echo off
setlocal
cd /d "%~dp0"
echo.
echo  PDF Bench - publish an update
echo  ------------------------------
set VERSION=v1.0.1
git add -A
git -c user.name="Bumblebee" -c user.email=324920039+Bumble-bee-999@users.noreply.github.com commit -m "Add startup diagnostics and log file (%VERSION%)"
git push origin main
if errorlevel 1 goto :fail
echo.
echo  Code pushed. Wait for the Test run to turn green on the Actions page:
start "" https://github.com/Bumble-bee-999/pdf-bench/actions
echo.
pause
git tag %VERSION%
git push origin %VERSION%
if errorlevel 1 goto :fail
echo.
echo  Release %VERSION% started. When the Release run is green, the files appear here:
start "" https://github.com/Bumble-bee-999/pdf-bench/releases
goto :end
:fail
echo.
echo  Something went wrong. Copy the text above and send it to Claude.
:end
echo.
pause
