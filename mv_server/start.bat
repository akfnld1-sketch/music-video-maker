@echo off
chcp 65001 > nul
title 뮤직비디오 생성기 서버

echo.
echo  ╔══════════════════════════════════════╗
echo  ║    🎬 뮤직비디오 생성기 서버 시작    ║
echo  ╚══════════════════════════════════════╝
echo.

:: Node.js 확인
where node >nul 2>&1
if errorlevel 1 (
    echo  ❌ Node.js가 설치되어 있지 않아요!
    echo     https://nodejs.org 에서 설치해주세요.
    pause
    exit /b 1
)

:: ffmpeg 확인
where ffmpeg >nul 2>&1
if errorlevel 1 (
    if not exist "ffmpeg.exe" (
        echo  ⚠️  ffmpeg.exe를 찾을 수 없어요.
        echo     이 폴더에 ffmpeg.exe를 복사하거나
        echo     PATH에 ffmpeg를 등록해주세요.
        echo     다운로드: https://ffmpeg.org/download.html
        echo.
    ) else (
        echo  ✅ ffmpeg.exe 발견 (로컬)
    )
) else (
    echo  ✅ ffmpeg 발견 (PATH)
)

:: npm install (처음 한 번만)
if not exist "node_modules" (
    echo  📦 패키지 설치 중... (처음 한 번만)
    npm install
    if errorlevel 1 (
        echo  ❌ npm install 실패
        pause
        exit /b 1
    )
)

echo.
echo  🚀 서버 시작 중...
echo  브라우저가 자동으로 열립니다.
echo  (수동: http://localhost:3000)
echo.
echo  서버를 끄려면 이 창을 닫거나 Ctrl+C 를 누르세요.
echo.

:: 브라우저 자동 오픈 (2초 후)
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: 서버 실행
node server.js

pause
