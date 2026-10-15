'use strict';

// 오른쪽 위 ⋮ 메뉴: 설명, 자막, 화질 (유튜브 숏츠 앱의 더보기 메뉴와 같은 구성)
// 멈춘 화면의 공유 버튼(링크 복사)과 Shorts 로고(유튜브 앱으로 열기)

const CAPTION_STORAGE_KEY = 'shorts-shuffle:captions';

// ===== DOM =====
const moreBtn = document.getElementById('moreBtn');
const menuSheet = document.getElementById('menuSheet');
const menuDesc = document.getElementById('menuDesc');
const menuCaptions = document.getElementById('menuCaptions');
const menuCaptionsValue = document.getElementById('menuCaptionsValue');
const menuQuality = document.getElementById('menuQuality');
const menuQualityValue = document.getElementById('menuQualityValue');

const descSheet = document.getElementById('descSheet');
const descStatus = document.getElementById('descStatus');
const descContent = document.getElementById('descContent');

const captionSheet = document.getElementById('captionSheet');
const captionList = document.getElementById('captionList');
const captionStatus = document.getElementById('captionStatus');

const qualitySheet = document.getElementById('qualitySheet');
const qualityCurrent = document.getElementById('qualityCurrent');

// 설명은 YouTube Data API 로 가져오므로 키가 없으면 메뉴에서 뺀다
menuDesc.closest('li').hidden = !hasApiKey;

moreBtn.addEventListener('click', () => {
  menuCaptionsValue.textContent = captionLabel || '사용 안함';
  menuQualityValue.textContent = currentQualityLabel();
  openSheet(menuSheet);
});

menuDesc.addEventListener('click', openDescription);
menuCaptions.addEventListener('click', openCaptions);
menuQuality.addEventListener('click', () => {
  qualityCurrent.textContent = currentQualityLabel();
  openSheet(qualitySheet);
});

// ===== 설명 =====
async function openDescription() {
  openSheet(descSheet);
  const videoId = currentVideoId;
  descContent.hidden = true;
  setStatus(descStatus, '불러오는 중...');
  try {
    const d = await fetchVideoDetails(videoId);
    if (videoId !== currentVideoId) return;
    document.getElementById('descTitle').textContent = d.title;
    document.getElementById('descChannel').textContent = d.channelTitle;
    document.getElementById('descLikes').textContent = d.likeCount != null ? formatCount(d.likeCount) : '-';
    document.getElementById('descViews').textContent = d.viewCount != null ? formatCount(d.viewCount) : '-';
    const date = new Date(d.publishedAt);
    document.getElementById('descDate').textContent = `${date.getMonth() + 1}월 ${date.getDate()}일`;
    document.getElementById('descYear').textContent = `${date.getFullYear()}년`;
    document.getElementById('descText').textContent = d.description;
    const avatar = document.getElementById('descAvatar');
    avatar.removeAttribute('src');
    fetchChannelAvatar(d.channelId).then((url) => { if (url) avatar.src = url; }).catch(() => {});
    descSheet.querySelector('.sheet-body').scrollTop = 0;
    descContent.hidden = false;
    setStatus(descStatus, '');
  } catch (err) {
    if (videoId === currentVideoId) setStatus(descStatus, apiErrorMessage(err));
  }
}

// ===== 자막 =====
// 유튜브 플레이어의 captions 모듈로 켜고 끈다 (공식 문서에는 없지만 IFrame 플레이어가 제공하는 기능)
// - 켜기: loadModule('captions') 후 setOption('captions', 'track', { languageCode })
// - 끄기: unloadModule('captions')
// 고른 언어는 다음 영상에도 그대로 적용한다 (그 언어 자막이 없는 영상에서는 끈다)
let captionLang = null;   // null = 사용 안함
let captionLabel = null;  // 메뉴에 보여줄 이름 (예: 한국어)
let captionAppliedFor = null;

try {
  const saved = JSON.parse(localStorage.getItem(CAPTION_STORAGE_KEY) || 'null');
  if (saved) ({ lang: captionLang, label: captionLabel } = saved);
} catch {
  // 저장된 값이 없거나 저장소를 쓸 수 없으면 자막은 꺼진 상태로 시작한다
}

function saveCaptionPreference() {
  try {
    localStorage.setItem(CAPTION_STORAGE_KEY, JSON.stringify(captionLang ? { lang: captionLang, label: captionLabel } : null));
  } catch {
    // 저장이 막혀도 이번 실행 동안은 그대로 동작한다
  }
}

// app.js 에서 영상이 재생되기 시작할 때마다 호출한다
function applyCaptionPreference(videoId) {
  if (captionAppliedFor === videoId) return; // 일시정지 후 다시 재생할 때는 건너뛴다
  captionAppliedFor = videoId;
  if (!captionLang) {
    player.unloadModule('captions');
    return;
  }
  player.loadModule('captions');
  player.setOption('captions', 'track', { languageCode: captionLang });
  // 고른 언어의 자막이 없는 영상이면 플레이어가 다른 언어를 띄우므로 끈다
  setTimeout(() => {
    if (currentVideoId !== videoId) return;
    const tracks = player.getOption('captions', 'tracklist') || [];
    if (!tracks.some((t) => t.languageCode === captionLang)) player.unloadModule('captions');
  }, 1500);
}

// 자막 목록은 captions 모듈이 켜져 있어야 읽을 수 있다.
// 잠깐 켜서 목록만 읽은 뒤 원래 설정대로 되돌린다 (그동안 자막은 이 창에 가려져 보이지 않는다)
function readCaptionTracks() {
  return new Promise((resolve) => {
    player.loadModule('captions');
    setTimeout(() => {
      const tracks = player.getOption('captions', 'tracklist') || [];
      captionAppliedFor = null;
      applyCaptionPreference(currentVideoId);
      resolve(tracks);
    }, 1200);
  });
}

async function openCaptions() {
  openSheet(captionSheet);
  captionList.replaceChildren();
  setStatus(captionStatus, '불러오는 중...');
  const videoId = currentVideoId;
  const tracks = await readCaptionTracks();
  if (videoId !== currentVideoId) return;

  captionList.append(captionOption('사용 안함', null));
  tracks.forEach((t) => captionList.append(captionOption(t.displayName || t.languageName, t.languageCode)));
  setStatus(captionStatus, tracks.length ? '' : '이 영상에는 자막이 없어요');
}

function captionOption(label, lang) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'option-item' + (lang === captionLang ? ' selected' : '');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    captionLang = lang;
    captionLabel = lang ? label : null;
    saveCaptionPreference();
    captionAppliedFor = null;
    applyCaptionPreference(currentVideoId);
    closeSheet();
  });
  li.append(btn);
  return li;
}

// ===== 화질 =====
// 유튜브가 외부 플레이어의 화질 변경(setPlaybackQuality)을 막아 두어서 현재 화질만 보여준다
const QUALITY_LABELS = {
  tiny: '144p', small: '240p', medium: '360p', large: '480p',
  hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '2160p (4K)', highres: '4K 이상',
};

function currentQualityLabel() {
  const q = player?.getPlaybackQuality?.();
  return QUALITY_LABELS[q] ? `자동 (${QUALITY_LABELS[q]})` : '자동';
}

// ===== 공유 (링크 복사) =====
const shareSheet = document.getElementById('shareSheet');
const shareLink = document.getElementById('shareLink');
const shareCopy = document.getElementById('shareCopy');

function shortsUrl(videoId) {
  return `https://youtube.com/shorts/${videoId}`;
}

ytShareHit.addEventListener('click', () => {
  shareLink.textContent = shortsUrl(currentVideoId);
  shareCopy.textContent = '링크 복사';
  openSheet(shareSheet);
});

shareCopy.addEventListener('click', async () => {
  const url = shareLink.textContent;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // 클립보드 API 를 못 쓰는 브라우저는 예전 방식으로 복사한다
    const input = document.createElement('textarea');
    input.value = url;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  shareCopy.textContent = '✓ 복사됨';
  setTimeout(closeSheet, 700);
});

// ===== Shorts 로고 → 유튜브 앱으로 열기 =====
// 안드로이드: intent 주소로 유튜브 앱을 직접 연다 (앱이 없으면 웹으로)
// 아이폰: youtube:// 주소로 앱을 연다
// PC: 새 탭에서 유튜브 웹으로 연다
ytLogoHit.addEventListener('click', () => {
  const url = shortsUrl(currentVideoId);
  const path = url.replace('https://', '');
  player.pauseVideo();
  if (/Android/i.test(navigator.userAgent)) {
    location.href = `intent://${path}#Intent;scheme=https;package=com.google.android.youtube;`
      + `S.browser_fallback_url=${encodeURIComponent(url)};end`;
  } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    location.href = `youtube://${path}`;
  } else {
    window.open(url, '_blank', 'noopener');
  }
});
