@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "PORT=5173"
set "URL=http://localhost:%PORT%/"
set "NODE_EXE="

where node >nul 2>&1
if not errorlevel 1 set "NODE_EXE=node"

if not defined NODE_EXE (
  for %%P in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LocalAppData%\Programs\nodejs\node.exe"
    "%ProgramFiles%\cursor\resources\app\resources\helpers\node.exe"
    "%LocalAppData%\Programs\cursor\resources\app\resources\helpers\node.exe"
  ) do (
    if exist "%%~P" (
      set "NODE_EXE=%%~P"
      goto :run
    )
  )
)

:run
if defined NODE_EXE (
  echo Arrancando FireGochi con Node...
  "%NODE_EXE%" server.mjs
  goto :end
)

where python >nul 2>&1
if not errorlevel 1 (
  echo Node.js no esta instalado. Arrancando con Python...
  start "" "%URL%"
  python -m http.server %PORT%
  goto :end
)

where py >nul 2>&1
if not errorlevel 1 (
  echo Node.js no esta instalado. Arrancando con Python...
  start "" "%URL%"
  py -m http.server %PORT%
  goto :end
)

echo.
echo No se encontro Node.js ni Python.
echo Instala Node.js desde https://nodejs.org y vuelve a abrir firegochi.bat
echo.
:end
pause
