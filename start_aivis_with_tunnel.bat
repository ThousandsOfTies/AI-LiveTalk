@echo off
setlocal
echo ======================================================
echo  AivisSpeech Tunnel Launcher (for AI-LiveTalk)
echo ======================================================
echo.

set EXE_PATH="C:\Program Files\AivisSpeech\AivisSpeech-Engine\run.exe"

if not exist %EXE_PATH% (
    echo [ERROR] AivisSpeech not found at: %EXE_PATH%
    pause
    exit /b
)

echo Starting AivisSpeech Engine in background...
start "AivisSpeech Engine" %EXE_PATH% --cors_policy_mode all

echo.
echo ======================================================
echo  Select Tunnel Method (for Mobile/External Access)
echo ======================================================
echo  1: localhost.run (Recommended - Persistent with SSH Key)
echo  2: Pinggy.io     (SSH based)
echo  3: Cloudflare    (Requires cloudflared)
echo  4: Ngrok         (Caution: Duplicate Header Issues)
echo  5: No Tunnel     (Exit)
echo ======================================================

if not "%1"=="" (
    set choice=%1
    goto skip_prompt
)

set /p choice="Enter choice (1-5): "

:skip_prompt
if "%choice%"=="1" goto lhr
if "%choice%"=="2" goto pinggy
if "%choice%"=="3" goto cf
if "%choice%"=="4" goto ngrok
if "%choice%"=="5" exit /b
goto end

:lhr
echo [localhost.run] Connecting...
echo Tip: Register your SSH key at https://admin.localhost.run/ for a persistent URL.
ssh -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" -R 80:localhost:10101 localhost.run
timeout /t 5
goto lhr

:pinggy
echo [Pinggy.io] Connecting...
ssh -o "ServerAliveInterval 30" -p 443 -R0:localhost:10101 a.pinggy.io
timeout /t 5
goto pinggy

:cf
echo [Cloudflare] Connecting...
cloudflared tunnel --url http://localhost:10101 --no-autoupdate
timeout /t 5
goto cf

:ngrok
echo [Ngrok] Connecting...
set /p NGROK_DOMAIN="Enter your ngrok domain: "
:ngrok_loop
ngrok http --domain=%NGROK_DOMAIN% 10101
timeout /t 5
goto ngrok_loop

:end
pause
endlocal
