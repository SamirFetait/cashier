@echo off
setlocal EnableExtensions

cd /d "%~dp0"

rem Usage:
rem   build.bat            Local build only (installer in frontend\dist\).
rem   build.bat publish    Build AND upload the release to GitHub (SamirFetait/cashier-releases).
rem                        Needs GH_TOKEN with Contents read/write on that repo.
rem                        See RELEASE.md for the full release checklist.
rem Per-repo release token: .env.release next to this script (git-ignored) holds the line
rem GH_TOKEN=<token>. It wins over a machine-wide GH_TOKEN, which may belong to another
rem GitHub account (that fails with 403).
if exist "%~dp0.env.release" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0.env.release") do (
    if /i "%%A"=="GH_TOKEN" set "GH_TOKEN=%%B"
  )
  echo Using the release token from .env.release.
)

set "FRONTEND_NPM_SCRIPT=package"
if /i "%~1"=="publish" (
  set "FRONTEND_NPM_SCRIPT=release"
  if "%GH_TOKEN%"=="" (
    echo GH_TOKEN is not set. Put a line GH_TOKEN=your-token in .env.release next to build.bat - see RELEASE.md.
    exit /b 1
  )
)

pushd frontend
call npm run %FRONTEND_NPM_SCRIPT%
if errorlevel 1 (
  echo Electron build failed.
  popd
  exit /b 1
)
popd

echo Build finished successfully.
