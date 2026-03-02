# 🎬 뮤직비디오 생성기 - 로컬 서버 버전

브라우저 단독 방식에서 **Node.js + ffmpeg 로컬 서버** 방식으로 업그레이드!

## 📁 폴더 구조

```
mv_server/
├── server.js          ← Node.js 서버 (핵심 엔진)
├── start.bat          ← Windows 실행 (더블클릭)
├── start.sh           ← Mac/Linux 실행
├── package.json
├── ffmpeg.exe         ← ⭐ 여기에 복사! (Windows)
├── public/
│   ├── index.html     ← 브라우저 UI
│   └── style.css
├── uploads/           ← 업로드 임시 저장 (자동 생성)
├── outputs/           ← 완성된 MP4 자동 저장 ⭐
└── temp/              ← 처리 중 임시파일 (자동 생성)
```

---

## 🚀 설치 및 실행

### 1단계: Node.js 설치
- https://nodejs.org → LTS 버전 다운로드 & 설치

### 2단계: ffmpeg 설치

**Windows:**
1. https://ffmpeg.org/download.html → Windows 빌드 다운로드
2. 압축 해제 후 `ffmpeg.exe`를 이 폴더(`mv_server/`)에 복사
   - 또는 `C:\ffmpeg\bin\ffmpeg.exe`에 설치 후 PATH 등록

**Mac:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt install ffmpeg
```

### 3단계: 서버 시작

**Windows:**
→ `start.bat` 더블클릭

**Mac/Linux:**
```bash
chmod +x start.sh
./start.sh
```

**또는 직접:**
```bash
npm install      # 처음 한 번만
node server.js
```

### 4단계: 브라우저에서 사용
→ http://localhost:3000 접속

---

## 🎬 사용 방법

### 모드 1: MP4 무손실 병합 (초고속)
- MP4 파일만 올린 경우 자동으로 이 모드 사용
- `-c copy` 스트림 복사 → **화질 손실 없음, 1초 완료**
- 이펙트/음악 없는 순수 병합

### 모드 2: 음악 + 이미지/영상 인코딩
- 음악 파일 + 이미지/MP4 조합
- BPM에 맞춰 클립 길이 자동 계산
- 지정 해상도(4K/2K/FHD/HD)로 리인코딩
- 최종 결과물: **고화질 MP4** (H264)

---

## 📂 결과물 위치

완성된 MP4는 두 곳에서 받을 수 있어요:

1. **브라우저 다운로드** - 다운로드 버튼 클릭
2. **로컬 자동 저장** - `mv_server/outputs/` 폴더에 자동 저장

---

## ⚙️ 품질 설정

| 프리셋    | CRF | 용도           |
|-----------|-----|----------------|
| ⚡ 빠른    | 28  | 빠른 확인용    |
| ✨ 일반    | 20  | 일반 사용 (기본)|
| 💎 고품질  | 15  | 최고화질 배포용 |

---

## ❓ 문제 해결

**서버가 안 켜져요**
→ Node.js 설치 확인: `node --version`

**ffmpeg를 못 찾아요**
→ `ffmpeg.exe`를 `mv_server/` 폴더에 직접 복사
→ 또는 브라우저에서 ffmpeg 경로 수동 설정 버튼 사용

**포트 3000이 사용 중이에요**
→ `server.js` 첫 부분의 `PORT = 3000`을 `3001`로 변경

**업로드가 안돼요 (파일 너무 큼)**
→ `server.js`의 `fileSize: 500 * 1024 * 1024` 값 증가 (바이트 단위)
