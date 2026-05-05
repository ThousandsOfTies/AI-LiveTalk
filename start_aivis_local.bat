@echo off
setlocal
echo ======================================================
echo  AivisSpeech Local Launcher (for AI-LiveTalk)
echo ======================================================
echo.

set EXE_PATH="C:\Program Files\AivisSpeech\AivisSpeech-Engine\run.exe"

if exist %EXE_PATH% (
    echo Starting AivisSpeech with CORS enabled...
    %EXE_PATH% --cors_policy_mode all
) else (
    echo [ERROR] AivisSpeech not found at: %EXE_PATH%
    echo Please check your installation path.
    pause
)

endlocal
