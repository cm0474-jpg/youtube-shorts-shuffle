'use strict';

// ===== 설정 =====
const SWIPE_DISTANCE = 80;   // 이 거리(px) 이상 끌면 다음/이전 영상으로 넘어간다
const FLICK_SPEED = 0.5;     // 짧게 튕겨도 넘어가는 속도 (px/ms)
const TAP_MAX_MOVE = 10;     // 이보다 적게 움직이면 탭으로 본다
const TAP_MAX_TIME = 300;    // ms
const SLIDE_MS = 250;        // style.css 의 --slide-duration 과 맞춘다

// ===== 상태 =====
let videoIds = [];       // 재생 대상 (시작 화면에서 불러온 채널/재생목록의 영상)
let queue = [];          // 재생 순서 (섞은 묶음을 계속 이어 붙인다)
let pos = 0;             // queue 에서 현재 재생 중인 위치
let player = null;       // 첫 목록을 불러온 뒤에 만든다
let ytReady = false;     // YouTube IFrame API 스크립트 로드 완료 여부
let muted = true;        // 모바일 자동재생은 음소거 상태에서만 허용된다
let animating = false;
let errorStreak = 0;     // 연속으로 재생에 실패한 횟수

// ===== DOM =====
const frame = document.getElementById('frame');
const touchLayer = document.getElementById('touchLayer');
const soundBtn = document.getElementById('soundBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const centerIcon = document.getElementById('centerIcon');
const ytShareHit = document.getElementById('ytShareHit');
const ytLogoHit = document.getElementById('ytLogoHit');

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

// 재생 대상을 새 목록으로 바꾸고 섞어서 처음부터 재생한다
function setVideos(ids) {
  videoIds = ids.slice();
  errorStreak = 0;
  resetQueue();
  if (player) loadCurrent();
  else createPlayer();
}

// ===== YouTube 플레이어 =====
window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
  // API 스크립트보다 목록을 먼저 불러온 경우 여기서 플레이어를 만든다
  if (videoIds.length && !player) createPlayer();
};

function createPlayer() {
  if (!ytReady) return;
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
}

function onPlayerReady() {
  player.mute();
  player.playVideo();
  updateSoundBtn();
  updateVideoInfo(queue[pos]);
}

function onPlayerStateChange(e) {
  updateTouchLayer(e.data);
  if (e.data === YT.PlayerState.PLAYING) {
    errorStreak = 0;
    applyCaptionPreference(queue[pos]);
  } else if (e.data === YT.PlayerState.ENDED) {
    // 댓글 창이나 시작 화면을 보는 중에는 다음 영상으로 넘기지 않고 처음부터 반복한다
    if (isOverlayOpen()) {
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
    // 목록 전체가 재생되지 않으면 시작 화면으로 돌아가서 다른 링크를 넣게 한다
    showStartScreen('이 목록에는 재생할 수 있는 영상이 없어요');
    return;
  }
  // 재생할 수 없는 영상(퍼가기 금지 등)은 조용히 건너뛴다.
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
    snapBack(); // 첫 영상에서 아래로 밀면 제자리로 튕겨 돌아온다
    return;
  }
  pos += dir;
  if (pos >= queue.length) extendQueue();
  // 터치 이벤트 안에서 바로 불러와야 모바일 브라우저가 재생을 허용한다
  loadCurrent();
  slide(dir);
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
}

function updateSoundBtn() {
  soundBtn.textContent = muted ? '🔇' : '🔊';
  soundBtn.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
}

// ===== 멈춘 화면의 유튜브 버튼 자리 =====
// 영상이 멈추면 유튜브가 영상 위에 자체 버튼(왼쪽 아래 공유, 오른쪽 아래 Shorts 로고)을 띄운다.
// 그 버튼들은 플레이어(iframe) 안에 있어서 동작을 바꿀 수 없으므로, 멈춰 있는 동안에는
// 같은 자리에 투명한 버튼을 올려서 우리 기능(링크 복사, 유튜브 앱으로 열기)을 연결한다 (menu.js).
function updateTouchLayer(state) {
  const paused = state === YT.PlayerState.PAUSED || state === YT.PlayerState.CUED;
  ytShareHit.hidden = !paused;
  ytLogoHit.hidden = !paused;
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
  // 입력창에 타이핑 중이거나 댓글 창/시작 화면이 열려 있으면 영상 조작을 하지 않는다
  if (e.target.matches('input, textarea') || isOverlayOpen()) return;
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
});

// ===== 재생/일시정지 아이콘 =====
function flashIcon(symbol) {
  centerIcon.textContent = symbol;
  centerIcon.classList.remove('show');
  void centerIcon.offsetWidth; // 애니메이션을 처음부터 다시 재생
  centerIcon.classList.add('show');
}

// ===== PWA: 서비스 워커 등록 (홈 화면에 추가, 빠른 실행) =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
