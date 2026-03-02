/**
 * 뮤직비디오 생성기 - 서버 연동 레이어
 * 기존 브라우저 렌더링(Canvas+MediaRecorder)을 서버 API로 교체
 */

const API = 'http://localhost:3000';

// ── 서버 상태 확인 ──
async function checkServer() {
  try {
    const r = await fetch(`${API}/api/status`, { signal: AbortSignal.timeout(2000) });
    const d = await r.json();
    updateServerStatus(d);
    return d;
  } catch(e) {
    updateServerStatus({ ok: false, ffmpeg: null });
    return null;
  }
}

function updateServerStatus(d) {
  const badge = document.getElementById('serverStatusBadge');
  const ffBadge = document.getElementById('ffmpegStatusBtn');
  if (!badge) return;

  if (!d || !d.ok) {
    badge.innerHTML = '🔴 서버 오프라인';
    badge.style.cssText = 'background:#3a1010;color:#ff6666;padding:4px 10px;border-radius:12px;font-size:11px;';
    if (ffBadge) ffBadge.textContent = '❌ 서버 없음';
  } else if (!d.ffmpeg) {
    badge.innerHTML = '🟡 서버 OK · ffmpeg 없음';
    badge.style.cssText = 'background:#2a2000;color:#ffcc44;padding:4px 10px;border-radius:12px;font-size:11px;';
    if (ffBadge) ffBadge.textContent = '⚠️ ffmpeg 없음';
  } else {
    badge.innerHTML = '🟢 서버 · ffmpeg 준비됨';
    badge.style.cssText = 'background:#0a2a0a;color:#44ff88;padding:4px 10px;border-radius:12px;font-size:11px;';
    if (ffBadge) { ffBadge.textContent = '✅ ffmpeg 준비됨'; _ffmpegLoaded = true; }
  }
}

// ── 파일 업로드 ──
async function uploadFilesToServer(files) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  const r = await fetch(`${API}/api/upload`, { method: 'POST', body: fd });
  return (await r.json()).files; // [{id, name, url, ...}]
}

// ── 작업 진행 상태 폴링 ──
async function pollJob(jobId, onProgress) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`${API}/api/job/${jobId}`);
        const job = await r.json();
        onProgress(job);
        if (job.status === 'done') { clearInterval(timer); resolve(job); }
        if (job.status === 'error') { clearInterval(timer); reject(new Error(job.message)); }
      } catch(e) { clearInterval(timer); reject(e); }
    }, 400);
  });
}

// ────────────────────────────────────────────────────
// generate() 함수 - 서버 API 버전으로 완전 교체
// ────────────────────────────────────────────────────
async function generate() {
  if (isRunning) return;

  // ── 서버 온라인 체크 ──
  const status = await checkServer();
  if (!status) {
    alert('❌ 서버가 꺼져 있어요!\n\nstart.bat 또는 start.sh 를 먼저 실행해주세요.\n(server 폴더에서 node server.js)');
    return;
  }
  if (!status.ffmpeg) {
    alert('⚠️ ffmpeg.exe를 찾을 수 없어요!\n\nffmpeg.exe를 서버 폴더(mv_server/)에 복사해주세요.\n또는 PATH에 등록된 ffmpeg가 필요해요.');
    return;
  }

  if (images.length === 0) {
    alert('이미지 또는 MP4 영상을 먼저 추가해주세요!');
    return;
  }
  if (audioBuffer && (trimEnd - trimStart) < 1) {
    alert('구간을 1초 이상 선택해주세요!');
    return;
  }

  isRunning = true;
  document.getElementById('genBtn').disabled = true;
  document.getElementById('prog').classList.add('on');
  document.getElementById('result').classList.remove('on');
  _progStartTime = Date.now();
  setP(3, '📤 파일 업로드 중...', 1);
  await sleep(60);

  try {
    // ── 스텝 1: 파일 서버에 업로드 ──
    const filesToUpload = [];
    const fileMap = new Map(); // file → serverId

    // 이미지/영상 파일
    for (const im of images) {
      if (im.file && !im._serverId) filesToUpload.push(im.file);
    }
    // 오디오 파일
    const audioFile = songs[curIdx]?.file;
    if (audioFile && !audioFile._serverId) filesToUpload.push(audioFile);

    if (filesToUpload.length > 0) {
      setP(8, `📤 ${filesToUpload.length}개 파일 업로드 중...`, 1);
      const uploaded = await uploadFilesToServer(filesToUpload);
      uploaded.forEach((u, i) => { fileMap.set(filesToUpload[i], u.id); });
    }

    // serverId 캐싱
    images.forEach(im => {
      if (im.file && fileMap.has(im.file)) im._serverId = fileMap.get(im.file);
    });
    if (audioFile && fileMap.has(audioFile)) audioFile._serverId = fileMap.get(audioFile);

    setP(15, '⚙️ 서버에서 처리 중...', 2);

    // ── 스텝 2: 모드 판별 ──
    const allMp4       = images.every(im => im.type === 'video');
    const noAudio      = !audioBuffer;
    const noEffects    = !effectMasterOn;
    const useConcat    = allMp4 && noAudio && noEffects;

    let jobId, endpoint, payload;

    if (useConcat) {
      // ── 무손실 concat 모드 ──
      setP(20, '🔗 무손실 병합 모드 (stream copy)...', 2);
      endpoint = '/api/generate/concat';
      payload  = {
        clips: images.map(im => ({
          fileId:  im._serverId,
          trimIn:  im.trimIn  ?? 0,
          trimOut: im.trimOut ?? null,
        })),
        outputName: songs[curIdx]?.name || '무손실병합',
      };
    } else {
      // ── 완전 렌더링 모드 ──
      setP(20, '🎬 인코딩 모드 (고화질)...', 2);
      endpoint = '/api/generate/render';

      // 각 클립 길이 계산
      const audioServerId = audioFile?._serverId || null;
      const audioDur = audioBuffer ? (trimEnd - trimStart) : 0;

      const clipsPayload = images.map(im => {
        let duration = 3;
        if (im.type === 'video' && im._genVid?.duration) {
          const tin  = im.trimIn  ?? 0;
          const tout = im.trimOut ?? im._genVid.duration;
          duration = (tout - tin) / (im.speed || 1);
        } else if (im.type === 'image' && audioBuffer) {
          // BPM 기반 이미지 표시 시간
          const beatSec = 60 / audioBPM;
          const bpmIntervals = { fast: beatSec*4, normal: beatSec*8, slow: beatSec*16 };
          duration = imgSegDurations[images.indexOf(im)] || bpmIntervals.normal;
        }
        return {
          fileId:  im._serverId,
          type:    im.type,
          duration: parseFloat(duration.toFixed(3)),
          trimIn:   im.trimIn  ?? 0,
          trimOut:  im.trimOut ?? null,
          speed:    im.speed   || 1,
        };
      });

      payload = {
        audioFileId:    audioServerId,
        audioTrimStart: audioBuffer ? trimStart : 0,
        audioTrimEnd:   audioBuffer ? trimEnd   : 0,
        clips:          clipsPayload,
        resolution:     document.getElementById('resolution').value || '1920x1080',
        outputName:     songs[curIdx]?.name || images[0]?.file?.name?.replace(/\.[^.]+$/,'') || '뮤직비디오',
        quality:        _qualityKey || 'good',
      };
    }

    // ── 스텝 3: 서버에 작업 요청 ──
    const resp = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const { jobId: jid, error } = await resp.json();
    if (error) throw new Error(error);
    jobId = jid;

    // ── 스텝 4: 진행 상황 폴링 ──
    const job = await pollJob(jobId, (j) => {
      setP(j.progress || 20, j.message || '처리 중...', j.progress > 50 ? 4 : 3);
    });

    // ── 스텝 5: 완료 처리 ──
    setP(100, '🎉 완성!', 5);
    document.getElementById('progEta').textContent =
      `✅ 총 ${Math.round((Date.now()-_progStartTime)/1000)}초 소요 | 파일크기: ${job.message.match(/[\d.]+MB/)?.[0]||''}`;

    const fileUrl  = `${API}${job.outputUrl}`;
    const fileName = job.outputFile;

    // 영상 미리보기
    document.getElementById('resultVideo').src = fileUrl;

    // 다운로드 버튼
    const dl = document.getElementById('dlBtn');
    dl.href     = fileUrl;
    dl.download = fileName;
    dl.textContent = `⬇️ ${fileName} 다운로드`;
    dl.onclick  = null;

    // 로컬 저장 경로 안내
    showToast(`✅ 완료! outputs/ 폴더에도 자동 저장됨\n📁 ${fileName}`);

    document.getElementById('result').classList.add('on');
    document.getElementById('result').scrollIntoView({ behavior: 'smooth' });

    // 로컬 저장 경로 표시
    const savedPathEl = document.getElementById('savedPathInfo');
    if (savedPathEl) {
      savedPathEl.style.display = 'block';
      savedPathEl.innerHTML = `📁 로컬 자동 저장: <code>outputs/${fileName}</code>`;
    }

  } catch(e) {
    console.error('generate 오류:', e);
    setP(0, '❌ 오류: ' + e.message, 0);
    showToast('❌ 오류: ' + e.message);
    document.getElementById('prog').classList.remove('on');
  } finally {
    isRunning = false;
    document.getElementById('genBtn').disabled = false;
  }
}

// canUseConcatMode 재정의 - 서버 버전
function canUseConcatMode() {
  return images.length > 0
    && images.every(im => im.type === 'video')
    && !audioBuffer
    && !effectMasterOn;
}

// ── 페이지 로드 시 서버 상태 확인 ──
document.addEventListener('DOMContentLoaded', () => {
  // 서버 상태 배지 추가
  const genBtn = document.getElementById('genBtn');
  if (genBtn && !document.getElementById('serverStatusBadge')) {
    const badge = document.createElement('div');
    badge.id = 'serverStatusBadge';
    badge.style.cssText = 'text-align:center;margin-bottom:8px;font-size:11px;';
    badge.innerHTML = '⏳ 서버 확인 중...';
    genBtn.parentNode.insertBefore(badge, genBtn);

    // 로컬 저장 경로 안내
    const pathInfo = document.createElement('div');
    pathInfo.id = 'savedPathInfo';
    pathInfo.style.cssText = 'display:none;margin-top:10px;padding:8px 12px;background:#0a1a0a;border:1px solid #1a4a1a;border-radius:8px;font-size:12px;color:#88cc88;text-align:center;';
    document.getElementById('result').appendChild(pathInfo);
  }

  checkServer();
  setInterval(checkServer, 10000); // 10초마다 재확인

  // genBtn 텍스트 업데이트
  const origUpdateConcat = window._updateConcatIndicator;
  window._updateConcatIndicator = function() {
    if (origUpdateConcat) origUpdateConcat();
    const btn = document.getElementById('genBtn');
    if (!btn) return;
    if (canUseConcatMode()) {
      btn.textContent = '🔗 MP4 무손실 이어붙이기! (서버)';
      btn.style.background = 'linear-gradient(135deg,#00aa44,#007733)';
    } else {
      btn.textContent = '🎬 서버에서 고화질 MP4 생성!';
      btn.style.background = '';
    }
  };
});

// ffmpeg 경로 수동 설정
async function setFfmpegPath() {
  const p = prompt('ffmpeg.exe 전체 경로를 입력하세요:\n예) C:\\ffmpeg\\bin\\ffmpeg.exe');
  if (!p) return;
  try {
    const r = await fetch(`${API}/api/ffmpeg-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ffmpegPath: p }),
    });
    const d = await r.json();
    if (d.ok) { showToast('✅ ffmpeg 경로 설정 완료!'); checkServer(); }
    else showToast('❌ ' + d.error);
  } catch(e) { showToast('❌ 서버 연결 실패'); }
}
