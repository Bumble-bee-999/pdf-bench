@echo off
REM ---------------------------------------------------------------------
REM  Publishes PDF Bench to GitHub and starts the Windows release build.
REM  Double-click this file. The only thing you do is sign in when your
REM  browser opens. Safe to run again if anything goes wrong part-way.
REM ---------------------------------------------------------------------
setlocal
set "OWNER=Bumble-bee-999"
set "REPO=pdf-bench"
set "NOREPLY=324920039+Bumble-bee-999@users.noreply.github.com"
set "PATH=%PATH%;%ProgramFiles%\Git\cmd;%ProgramFiles%\GitHub CLI"
cd /d "%~dp0"

echo.
echo === 1/5  Checking tools ===
where git >nul 2>nul
if errorlevel 1 (
  echo Installing Git for Windows...
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
)
where gh >nul 2>nul
if errorlevel 1 (
  echo Installing the GitHub command-line tool...
  winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
)
where git >nul 2>nul
if errorlevel 1 goto :needgit
where gh >nul 2>nul
if errorlevel 1 goto :needgh

echo.
echo === 2/5  Signing in to GitHub ===
gh auth status >nul 2>nul
if errorlevel 1 (
  echo A browser window will open. Sign in to GitHub and approve the request.
  gh auth login --hostname github.com --git-protocol https --web
)
gh auth status >nul 2>nul
if errorlevel 1 goto :noauth
gh auth setup-git >nul 2>nul

set "ME="
for /f "delims=" %%i in ('gh api user --jq .login') do set "ME=%%i"
if /I not "%ME%"=="%OWNER%" (
  echo.
  echo You are signed in as "%ME%", but this project is set up for "%OWNER%".
  echo Sign in as %OWNER%  ^(run: gh auth logout  and start again^), or change
  echo OWNER at the top of this file and the URLs in package.json and README.md.
  pause
  exit /b 1
)

echo.
echo === 3/5  Committing the source ===
if not exist ".git" git init -b main
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git -c user.name="Bumblebee" -c user.email="%NOREPLY%" commit -m "PDF Bench 1.0" || goto :fail
) else (
  echo Nothing new to commit.
)

echo.
echo === 4/5  Creating the repository and pushing ===
gh repo view %OWNER%/%REPO% >nul 2>nul
if errorlevel 1 (
  gh repo create %OWNER%/%REPO% --public --description "Free, offline, open-source PDF workbench for Windows" --source . --remote origin --push || goto :fail
) else (
  echo The repository already exists; pushing to it.
  git remote get-url origin >nul 2>nul
  if errorlevel 1 git remote add origin https://github.com/%OWNER%/%REPO%.git
  git push -u origin main || goto :fail
)

echo.
echo Pushed. The automatic tests are now running at:
echo   https://github.com/%OWNER%/%REPO%/actions
start "" "https://github.com/%OWNER%/%REPO%/actions"
echo.
echo === 5/5  Release ===
echo When the "Test" run shows a green tick, press any key here to build the
echo Windows installer. To stop instead, just close this window - nothing is
echo lost, and you can run this file again later.
pause >nul

git tag v1.0.0 >nul 2>nul
git push origin v1.0.0 || goto :fail
echo.
echo The installer is being built (about 10 minutes). When it finishes it
echo appears on the Releases page:
echo   https://github.com/%OWNER%/%REPO%/releases
start "" "https://github.com/%OWNER%/%REPO%/releases"
pause
exit /b 0

:needgit
echo Git could not be installed automatically. Install it from https://git-scm.com and run this again.
pause
exit /b 1
:needgh
echo The GitHub tool could not be installed automatically. Install it from https://cli.github.com and run this again.
pause
exit /b 1
:noauth
echo Sign-in did not complete. Run this file again and approve the request in the browser.
pause
exit /b 1
:fail
echo.
echo Something failed - scroll up for the message. You can fix it and run this file again.
pause
exit /b 1
