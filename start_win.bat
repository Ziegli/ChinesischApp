@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

REM In den Ordner der Batch wechseln
cd /d "%~dp0"

echo Checking Node & npm...
where node >nul 2>&1
IF ERRORLEVEL 1 (
  echo [X] Node.js not found. Please install Node 18+ from https://nodejs.org/
  pause
  exit /b 1
)
where npm >nul 2>&1
IF ERRORLEVEL 1 (
  echo [X] npm not found. Please install Node.js with npm.
  pause
  exit /b 1
)

echo Installing dependencies (if needed)...
call npm install --no-audit --no-fund

REM Standard-Port (kann per ENV PORT ueberschrieben werden)
IF "%PORT%"=="" SET PORT=5173

echo Starting dev server on port %PORT% ...
start "" "http://localhost:%PORT%"
call npm run dev -- --port %PORT%

ENDLOCAL
