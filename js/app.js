'use strict';

// ===== 설정 =====
const SWIPE_DISTANCE = 80;   // 이 거리(px) 이상 끌면 다음/이전 영상으로 넘어간다
const FLICK_SPEED = 0.5;     // 짧게 튕겨도 넘어가는 속도 (px/ms)
const TAP_MAX_MOVE = 10;     // 이보다 적게 움직이면 탭으로 본다
const TAP_MAX_TIME = 300;    // ms
const SLIDE_MS = 250;        // style.css 의 --slide-duration 과 맞춘다

// ===== 상태 =====
let videoIds = VIDEO_IDS.slice(); // 현재 재생 대상 (기본 목록 또는 불러온 재생목록/채널)
let queue = [];          // 재생 순서 (섞은 묶음을 계속 이어 붙인다)
let pos = 0;             // queue 에서 현재 재생 중인 위치
let player = null;
let muted = true;        // 모바일 자동재생은 음소거 상태에서만 허용된다
let animating = false;
let errorStreak = 0;     // 연속으로 재생에 실패한 횟수

// ===== DOM =====
const frame = document.getElementById('frame');
const touchLayer = document.getElementById('touchLayer');
const soundBtn = document.getElementById('soundBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const centerIcon = document.getElementById('centerIcon');
const hint = document.getElementById('hint');
const toast = document.getElementById('toast');

// ===== 재생 순서 =====
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 새로 섞은 묶음을 queue 뒤에 붙인다. 묶음 경계에서 같은 영상이 연달아 나오지 않게 한다.
function extendQueue() {
  const batch = shuffle(videoIds);
  if (batch.length > 1 && batch[0] === queue[queue.length - 1]) {
    [batch[0], batch[1]] = [batch[1], batch[0]];
  }
  queue = queue.concat(batch);
}

function resetQueue() {
  queue = [];
  pos = 0;
  extendQueue();
}

// 재생 대상을 새 목록으로 바꾸고 첫 영상부터 다시 섞어서 재생한다
function setVideos(ids) {
  videoIds = ids.slice();
  errorStreak = 0;
  resetQueue();
  if (player) {
    loadCurrent();
    slide(1);
  }
}

// ===== YouTube 플레이어 =====
window.onYouTubeIframeAPIReady = function () {
  resetQueue();
  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    videoId: queue[pos],
    playerVars: {
      autoplay: 1,
      mute: 1,
      playsinline: 1,   // iOS 에서 전체화면으로 튀지 않고 페이지 안에서 재생
      controls: 0,
      disablekb: 1,
      fs: 0,
      rel: 0,
      iv_load_policy: 3,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
};

function onPlayerReady() {
  player.mute();
  player.playVideo();
  updateSoundBtn();
  updateVideoInfo(queue[pos]);
  restoreSavedSource();
}

function onPlayerStateChange(e) {
  if (e.data === YT.PlayerState.PLAYING) {
    errorStreak = 0;
  } else if (e.data === YT.PlayerState.ENDED) {
    // 댓글/불러오기 창을 보는 중에는 다음 영상으로 넘기지 않고 처음부터 반복한다
    if (isSheetOpen()) {
      player.seekTo(0);
      player.playVideo();
    } else {
      go(1);
    }
  }
}

function onPlayerError() {
  errorStreak++;
  if (errorStreak >= videoIds.length) {
    showToast('재생할 수 있는 영상이 없어요');
    return;
  }
  showToast('재생할 수 없는 영상이라 건너뛰었어요');
  // 넘기는 애니메이션 중에 에러가 나면 go()가 무시되므로 애니메이션이 끝난 뒤 넘긴다
  setTimeout(() => go(1), animating ? SLIDE_MS * 2 : 0);
}

function loadCurrent() {
  player.loadVideoById(queue[pos]);
  if (muted) player.mute();
  else player.unMute();
  updateVideoInfo(queue[pos]);
}

// ===== 이동 =====
// dir: 1 = 다음 영상, -1 = 이전 영상
function go(dir) {
  if (!player || animating) return;
  if (dir < 0 && pos === 0) {
    snapBack();
    showToast('첫 번째 영상이에요');
    return;
  }
  pos += dir;
  if (pos >= queue.length) extendQueue();
  // 터치 이벤트 안에서 바로 불러와야 모바일 브라우저가 재생을 허용한다
  loadCurrent();
  slide(dir);
  hideHint();
}

// 현재 화면을 밀어내고 반대편에서 새 화면이 들어오는 애니메이션
function slide(dir) {
  animating = true;
  frame.classList.remove('no-transition');
  frame.style.transform = `translateY(${-dir * 100}%)`;
  setTimeout(() => {
    frame.classList.add('no-transition');
    frame.style.transform = `translateY(${dir * 100}%)`;
    void frame.offsetHeight; // 위치를 먼저 반영시킨 뒤 다시 애니메이션을 켠다
    frame.classList.remove('no-transition');
    frame.style.transform = 'translateY(0)';
    setTimeout(() => { animating = false; }, SLIDE_MS);
  }, SLIDE_MS);
}

function snapBack() {
  frame.classList.remove('no-transition');
  frame.style.transform = 'translateY(0)';
}

function togglePlay() {
  if (!player) return;
  if (player.getPlayerState() === YT.PlayerState.PLAYING) {
    player.pauseVideo();
    flashIcon('❚❚');
  } else {
    player.playVideo();
    flashIcon('▶');
  }
}

// ===== 소리 =====
function toggleSound() {
  if (!player) return;
  muted = !muted;
  if (muted) player.mute();
  else player.unMute();
  updateSoundBtn();
  showToast(muted ? '소리를 껐어요' : '소리를 켰어요');
}

function updateSoundBtn() {
  soundBtn.textContent = muted ? '🔇' : '🔊';
  soundBtn.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
}

// ===== 터치 / 마우스 스와이프 =====
let dragging = false;
let startY = 0;
let startTime = 0;
let deltaY = 0;

touchLayer.addEventListener('pointerdown', (e) => {
  if (animating) return;
  dragging = true;
  startY = e.clientY;
  startTime = performance.now();
  deltaY = 0;
  frame.classList.add('no-transition');
  touchLayer.setPointerCapture(e.pointerId);
});

touchLayer.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  deltaY = e.clientY - startY;
  frame.style.transform = `translateY(${deltaY}px)`;
});

touchLayer.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  frame.classList.remove('no-transition');

  const distance = Math.abs(deltaY);
  const elapsed = performance.now() - startTime;

  if (distance < TAP_MAX_MOVE && elapsed < TAP_MAX_TIME) {
    snapBack();
    togglePlay();
    return;
  }

  const isFlick = distance > 30 && distance / elapsed > FLICK_SPEED;
  if (distance > SWIPE_DISTANCE || isFlick) {
    go(deltaY < 0 ? 1 : -1); // 위로 밀면 다음, 아래로 밀면 이전
  } else {
    snapBack();
  }
});

touchLayer.addEventListener('pointercancel', () => {
  dragging = false;
  snapBack();
});

// ===== PC 테스트용: 키보드 / 마우스 휠 =====
document.addEventListener('keydown', (e) => {
  // 입력창에 타이핑 중이거나 아래 창(댓글/불러오기)이 열려 있으면 영상 조작을 하지 않는다
  if (e.target.matches('input, textarea') || isSheetOpen()) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(-1);
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'm' || e.key === 'M') toggleSound();
});

let lastWheel = 0;
touchLayer.addEventListener('wheel', (e) => {
  e.preventDefault();
  const now = performance.now();
  if (Math.abs(e.deltaY) < 30 || now - lastWheel < 600) return;
  lastWheel = now;
  go(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

// ===== 버튼 =====
soundBtn.addEventListener('click', toggleSound);

shuffleBtn.addEventListener('click', () => {
  if (!player || animating) return;
  resetQueue();
  loadCurrent();
  slide(1);
  showToast('새로 섞었어요');
});

// ===== 안내 UI =====
function hideHint() {
  hint.classList.add('hidden');
}
setTimeout(hideHint, 5000);

function flashIcon(symbol) {
  centerIcon.textContent = symbol;
  centerIcon.classList.remove('show');
  void centerIcon.offsetWidth; // 애니메이션을 처음부터 다시 재생
  centerIcon.classList.add('show');
}

let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}
