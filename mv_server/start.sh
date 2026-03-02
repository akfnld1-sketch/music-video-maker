#!/bin/bash
echo ""
echo " ╔══════════════════════════════════════╗"
echo " ║    🎬 뮤직비디오 생성기 서버 시작    ║"
echo " ╚══════════════════════════════════════╝"
echo ""

# Node.js 확인
if ! command -v node &> /dev/null; then
    echo " ❌ Node.js가 없어요. https://nodejs.org 에서 설치해주세요."
    exit 1
fi

# ffmpeg 확인
if ! command -v ffmpeg &> /dev/null; then
    echo " ⚠️  ffmpeg가 없어요."
    echo "    Mac: brew install ffmpeg"
    echo "    Ubuntu: sudo apt install ffmpeg"
fi

# npm install
if [ ! -d "node_modules" ]; then
    echo " 📦 패키지 설치 중..."
    npm install
fi

echo " 🚀 서버 시작!"
echo " 브라우저: http://localhost:3000"
echo ""

# 브라우저 열기
sleep 1 && (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) &

node server.js
