@echo off
chcp 65001 >nul 2>nul
title Cosmic - One Click Start
color 0A

cd /d "%~dp0"

echo.
echo ========================================
echo   Cosmic Split Agent - Starting...
echo ========================================
echo.

echo [1/5] Checking Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)
node -v
echo OK
echo.

echo [2/5] Checking root dependencies...
if not exist "node_modules\express" (
    echo Installing root dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)
echo OK
echo.

echo [3/5] Checking client dependencies...
if not exist "client\node_modules\vite" (
    echo Installing client dependencies...
    pushd client
    call npm install
    popd
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install client dependencies
        pause
        exit /b 1
    )
)
echo OK
echo.

echo [4/5] Checking .env config...
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo Created .env from .env.example
        echo Please edit .env to add your API key
    )
)
echo OK
echo.

echo [5/5] Killing existing processes on ports 3001 and 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":3001 .*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":5173 .*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
:: IPv6 checks
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"\[::\]:3001 .*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"\[::\]:5173 .*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
echo OK
echo.

echo ========================================
echo   Starting services...
echo   Frontend (Dev): http://localhost:5173
echo   Frontend (Statics) / Backend: http://localhost:3001
echo   Press Ctrl+C to stop
echo ========================================
echo.

timeout /t 5 /nobreak >nul
start http://localhost:5173

npm run dev

echo.
echo Service stopped.
pause
