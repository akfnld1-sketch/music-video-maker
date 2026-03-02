/**
 * 뮤직비디오 생성기 - 로컬 서버 (Node.js + ffmpeg.exe)
 * localhost:3000 에서 실행
 */

const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const fs         = require('fs');
const { spawn, execSync } = require('child_process');

const app  = express();
const PORT = 3000;

// ── 디렉토리 설정 ──
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const TEMP_DIR   = path.join(__dirname, 'temp');

[UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── ffmpeg 경로 자동 탐색 ──
function findFfmpeg() {
  const candidates = [
    'ffmpeg',                                           // PATH에 있을 때
    'ffmpeg.exe',                                       // Windows PATH
    path.join(__dirname, 'ffmpeg.exe'),                 // 서버 폴더 옆
    path.join(__dirname, '..', 'ffmpeg.exe'),           // 상위 폴더
    'C:\\ffmpeg\\bin\\ffmpeg.exe',                      // 일반 설치 경로
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    '/usr/local/bin/ffmpeg',                            // Mac/Linux
    '/usr/bin/ffmpeg',
  ];
  for (const c of candidates) {
    try { execSync(`"${c}" -version`, { stdio: 'ignore', timeout: 3000 }); return c; }
    catch (e) {}
  }
  return null;
}

let FFMPEG_PATH = findFfmpeg();
console.log('🎬 ffmpeg 경로:', FFMPEG_PATH || '❌ 찾지 못함 - ffmpeg.exe를 서버 폴더에 넣어주세요');

// ── 미들웨어 ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/outputs', express.static(OUTPUT_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public'))); // 프론트엔드

// ── 파일 업로드 설정 ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    cb(null, `${uuidv4()}_${name}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB

// ────────────────────────────────────────────────────
// API: ffmpeg 상태 확인
// ────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  FFMPEG_PATH = findFfmpeg(); // 재탐색
  res.json({
    ok:      !!FFMPEG_PATH,
    ffmpeg:  FFMPEG_PATH || null,
    version: FFMPEG_PATH ? (() => {
      try { return execSync(`"${FFMPEG_PATH}" -version`, { timeout: 3000 }).toString().split('\n')[0]; }
      catch(e) { return null; }
    })() : null,
    outputDir: OUTPUT_DIR,
    uploadDir: UPLOAD_DIR,
  });
});

// ────────────────────────────────────────────────────
// API: 파일 업로드
// ────────────────────────────────────────────────────
app.post('/api/upload', upload.array('files', 50), (req, res) => {
  const files = req.files.map(f => ({
    id:       f.filename,
    name:     f.originalname,
    path:     f.path,
    size:     f.size,
    mimetype: f.mimetype,
    url:      `/uploads/${f.filename}`,
  }));
  res.json({ ok: true, files });
});

// ────────────────────────────────────────────────────
// 작업 진행 상태 저장소 (Server-Sent Events용)
// ────────────────────────────────────────────────────
const jobs = new Map(); // jobId → { status, progress, message, outputFile, error }

app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// SSE 진행 상황 스트림
app.get('/api/job/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const id = req.params.id;
  const send = () => {
    const job = jobs.get(id);
    if (job) {
      res.write(`data: ${JSON.stringify(job)}\n\n`);
      if (job.status === 'done' || job.status === 'error') { res.end(); return; }
    }
    setTimeout(send, 300);
  };
  send();
});

// ────────────────────────────────────────────────────
// 헬퍼: ffmpeg 실행 + 진행률 파싱
// ────────────────────────────────────────────────────
function runFfmpeg(args, jobId, totalDuration) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_PATH) return reject(new Error('ffmpeg를 찾을 수 없어요. ffmpeg.exe를 서버 폴더에 복사해주세요.'));

    console.log('🎬 ffmpeg 실행:', FFMPEG_PATH, args.join(' '));
    const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', chunk => {
      const txt = chunk.toString();
      stderr += txt;

      // 진행률 파싱: time=HH:MM:SS.xx
      const m = txt.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && totalDuration && jobs.has(jobId)) {
        const sec = parseInt(m[1])*3600 + parseInt(m[2])*60 + parseFloat(m[3]);
        const pct = Math.min(98, Math.round((sec / totalDuration) * 90) + 5);
        const job = jobs.get(jobId);
        job.progress = pct;
        job.message  = `⚙️ 인코딩 중... ${Math.floor(sec)}초 / ${Math.floor(totalDuration)}초`;
      }
    });

    proc.on('close', code => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg 오류 (코드 ${code}):\n${stderr.slice(-1000)}`));
    });
    proc.on('error', reject);
  });
}

// ────────────────────────────────────────────────────
// 모드 1: MP4 무손실 concat (-c copy)
// ────────────────────────────────────────────────────
app.post('/api/generate/concat', async (req, res) => {
  const { clips, outputName } = req.body;
  // clips: [{fileId, trimIn, trimOut}]

  if (!clips || clips.length === 0)
    return res.status(400).json({ error: '클립이 없어요' });

  const jobId  = uuidv4();
  const outName = (outputName || `뮤직비디오_${Date.now()}`).replace(/[^a-zA-Z0-9가-힣_-]/g,'_') + '.mp4';
  const outPath = path.join(OUTPUT_DIR, outName);

  jobs.set(jobId, { status: 'running', progress: 0, message: '🔗 무손실 병합 준비 중...', outputFile: null });
  res.json({ ok: true, jobId });

  (async () => {
    const job = jobs.get(jobId);
    try {
      if (!FFMPEG_PATH) throw new Error('ffmpeg를 찾을 수 없어요');

      const tempFiles = [];

      // 각 클립 트림 (stream copy)
      for (let i = 0; i < clips.length; i++) {
        const clip   = clips[i];
        const src    = path.join(UPLOAD_DIR, clip.fileId);
        const trimmed = path.join(TEMP_DIR, `${jobId}_clip${i}.mp4`);
        tempFiles.push(trimmed);

        job.progress = Math.round((i / clips.length) * 40);
        job.message  = `✂️ 클립 ${i+1}/${clips.length} 트림 중...`;

        const args = ['-y', '-i', src];
        if (clip.trimIn  > 0.01)  args.push('-ss', clip.trimIn.toFixed(3));
        if (clip.trimOut != null) args.push('-to', clip.trimOut.toFixed(3));
        args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', trimmed);

        await runFfmpeg(args, jobId, null);
      }

      // concat list 파일 생성
      const listPath = path.join(TEMP_DIR, `${jobId}_list.txt`);
      const listContent = tempFiles.map(f => `file '${f.replace(/\\/g,"\\\\").replace(/'/g,"'\\''")}' `).join('\n');
      fs.writeFileSync(listPath, listContent, 'utf8');
      tempFiles.push(listPath);

      job.progress = 50;
      job.message  = '🔗 클립 이어붙이기 중 (무손실)...';

      // concat
      await runFfmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        outPath
      ], jobId, null);

      // 임시파일 정리
      tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e){} });

      const stat = fs.statSync(outPath);
      job.status     = 'done';
      job.progress   = 100;
      job.message    = `✅ 완료! ${(stat.size/1024/1024).toFixed(1)}MB`;
      job.outputFile = outName;
      job.outputUrl  = `/outputs/${outName}`;
      job.outputPath = outPath;

      console.log('✅ concat 완료:', outPath);
    } catch (e) {
      console.error('❌ concat 오류:', e.message);
      job.status  = 'error';
      job.message = '❌ ' + e.message;
    }
  })();
});

// ────────────────────────────────────────────────────
// 모드 2: 음악 + 이미지/MP4 BPM 편집 (완전 인코딩)
// ────────────────────────────────────────────────────
app.post('/api/generate/render', async (req, res) => {
  const {
    audioFileId,          // 업로드된 오디오 파일 ID
    audioTrimStart,       // 오디오 시작 (초)
    audioTrimEnd,         // 오디오 끝 (초)
    clips,                // [{fileId, type:'image'|'video', duration, trimIn, trimOut, speed}]
    resolution,           // '1920x1080' | '1080x1920' 등
    outputName,
    quality,              // 'draft'|'good'|'high'
  } = req.body;

  if (!clips || clips.length === 0)
    return res.status(400).json({ error: '클립이 없어요' });

  const jobId   = uuidv4();
  const outName = (outputName || `뮤직비디오_${Date.now()}`).replace(/[^a-zA-Z0-9가-힣_-]/g,'_') + '.mp4';
  const outPath = path.join(OUTPUT_DIR, outName);

  jobs.set(jobId, { status: 'running', progress: 0, message: '🎬 렌더링 준비 중...', outputFile: null });
  res.json({ ok: true, jobId });

  (async () => {
    const job = jobs.get(jobId);
    try {
      if (!FFMPEG_PATH) throw new Error('ffmpeg를 찾을 수 없어요');

      const [W, H] = (resolution || '1920x1080').split('x').map(Number);
      const audioDur = audioTrimEnd - audioTrimStart;

      // CRF 품질 설정
      const crfMap = { draft: 28, good: 20, high: 15 };
      const crf = crfMap[quality] || 20;

      const tempFiles = [];

      // ── 스텝 1: 각 클립을 동일 해상도로 리인코딩 ──
      job.progress = 5;
      job.message  = '🎞️ 클립 정규화 중...';

      const normalizedClips = [];
      for (let i = 0; i < clips.length; i++) {
        const clip    = clips[i];
        const src     = path.join(UPLOAD_DIR, clip.fileId);
        const outClip = path.join(TEMP_DIR, `${jobId}_norm${i}.mp4`);
        tempFiles.push(outClip);

        job.progress = 5 + Math.round((i / clips.length) * 30);
        job.message  = `🎞️ 클립 ${i+1}/${clips.length} 정규화 중...`;

        const clipDur = clip.duration || 3;
        const speed   = clip.speed || 1;

        let vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`;

        if (clip.type === 'image') {
          // 이미지 → 지정 시간 동안 영상으로 변환
          await runFfmpeg([
            '-y',
            '-loop', '1', '-i', src,
            '-t', clipDur.toFixed(3),
            '-vf', vf,
            '-r', '30',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
            '-pix_fmt', 'yuv420p',
            '-an',
            outClip
          ], jobId, clipDur);
        } else {
          // 비디오 클립
          const args = ['-y'];
          if (clip.trimIn > 0.01)  args.push('-ss', clip.trimIn.toFixed(3));
          args.push('-i', src);
          if (clip.trimOut != null) args.push('-t', (clip.trimOut - (clip.trimIn||0)).toFixed(3));
          else args.push('-t', clipDur.toFixed(3));

          // 속도 조정 + 리사이즈
          let vfFull = vf;
          if (speed !== 1) vfFull = `setpts=${(1/speed).toFixed(4)}*PTS,` + vfFull;

          args.push(
            '-vf', vfFull,
            '-r', '30',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
            '-pix_fmt', 'yuv420p',
            '-an',
            outClip
          );
          await runFfmpeg(args, jobId, clipDur);
        }

        normalizedClips.push(outClip);
      }

      // ── 스텝 2: 클립 이어붙이기 ──
      job.progress = 40;
      job.message  = '🔗 클립 합치는 중...';

      const concatVideo = path.join(TEMP_DIR, `${jobId}_concat_video.mp4`);
      tempFiles.push(concatVideo);

      const listPath = path.join(TEMP_DIR, `${jobId}_list.txt`);
      tempFiles.push(listPath);
      fs.writeFileSync(listPath,
        normalizedClips.map(f => `file '${f.replace(/\\/g,'\\\\').replace(/'/g,"'\\''")}' `).join('\n'),
        'utf8'
      );

      await runFfmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy',
        concatVideo
      ], jobId, null);

      // ── 스텝 3: 오디오 믹싱 ──
      job.progress = 70;
      job.message  = '🎵 음악 합치는 중...';

      if (audioFileId) {
        const audioSrc = path.join(UPLOAD_DIR, audioFileId);

        await runFfmpeg([
          '-y',
          '-i', concatVideo,
          '-ss', (audioTrimStart || 0).toFixed(3),
          '-t', audioDur.toFixed(3),
          '-i', audioSrc,
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:v', 'copy',
          '-c:a', 'aac', '-b:a', '192k',
          '-shortest',
          '-movflags', '+faststart',
          outPath
        ], jobId, audioDur);
      } else {
        // 오디오 없음 - 비디오만
        fs.copyFileSync(concatVideo, outPath);
      }

      // 임시파일 정리
      tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e){} });

      const stat = fs.statSync(outPath);
      job.status     = 'done';
      job.progress   = 100;
      job.message    = `✅ 완료! ${(stat.size/1024/1024).toFixed(1)}MB`;
      job.outputFile = outName;
      job.outputUrl  = `/outputs/${outName}`;
      job.outputPath = outPath;

      console.log('✅ render 완료:', outPath);
    } catch (e) {
      console.error('❌ render 오류:', e.message);
      job.status  = 'error';
      job.message = '❌ ' + e.message;
    }
  })();
});

// ────────────────────────────────────────────────────
// API: 결과 파일 목록
// ────────────────────────────────────────────────────
app.get('/api/outputs', (req, res) => {
  try {
    const files = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.endsWith('.mp4'))
      .map(f => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, f));
        return { name: f, size: stat.size, mtime: stat.mtime, url: `/outputs/${f}` };
      })
      .sort((a,b) => b.mtime - a.mtime)
      .slice(0, 30);
    res.json({ ok: true, files });
  } catch(e) {
    res.json({ ok: true, files: [] });
  }
});

// ────────────────────────────────────────────────────
// API: ffmpeg 경로 수동 설정
// ────────────────────────────────────────────────────
app.post('/api/ffmpeg-path', (req, res) => {
  const { ffmpegPath } = req.body;
  try {
    execSync(`"${ffmpegPath}" -version`, { stdio: 'ignore', timeout: 3000 });
    FFMPEG_PATH = ffmpegPath;
    res.json({ ok: true, path: FFMPEG_PATH });
  } catch(e) {
    res.status(400).json({ error: '해당 경로에서 ffmpeg를 실행할 수 없어요' });
  }
});

// ────────────────────────────────────────────────────
// 서버 시작
// ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('🎬 뮤직비디오 생성기 서버 시작!');
  console.log(`   브라우저에서 열기: http://localhost:${PORT}`);
  console.log(`   출력 폴더: ${OUTPUT_DIR}`);
  console.log(`   ffmpeg: ${FFMPEG_PATH || '❌ 없음 - ffmpeg.exe를 서버 폴더에 넣어주세요'}`);
  console.log('');
});
