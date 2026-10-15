'use strict';

// 오른쪽 버튼(좋아요 수, 댓글, 영상 불러오기)과 아래에서 올라오는 창(댓글, 영상 불러오기)
// YouTube Data API 키가 있을 때만 보인다.

const SOURCE_STORAGE_KEY = 'shorts-shuffle:source';

// ===== DOM =====
const likeAction = document.getElementById('likeAction');
const likeCount = document.getElementById('likeCount');
const commentBtn = document.getElementById('commentBtn');
const commentCount = document.getElementById('commentCount');
const sourceBtn = document.getElementById('sourceBtn');
const sheetBackdrop = document.getElementById('sheetBackdrop');

const commentsSheet = document.getElementById('commentsSheet');
const commentsTitle = document.getElementById('commentsTitle');
const commentsList = document.getElementById('commentsList');
const commentsStatus = document.getElementById('commentsStatus');
const commentsMore = document.getElementById('commentsMore');

const sourceSheet = document.getElementById('sourceSheet');
const sourceCurrent = document.getElementById('sourceCurrent');
const sourceForm = document.getElementById('sourceForm');
const sourceInput = document.getElementById('sourceInput');
const sourceSubmit = document.getElementById('sourceSubmit');
const sourceStatus = document.getElementById('sourceStatus');
const sourceReset = document.getElementById('sourceReset');

let currentVideoId = null;
let openedSheet = null;

if (hasApiKey) {
  likeAction.hidden = false;
  commentBtn.hidden = false;
  sourceBtn.hidden = false;
}

// ===== 좋아요 수 / 댓글 수 =====
// app.js 에서 영상이 바뀔 때마다 호출한다
function updateVideoInfo(videoId) {
  currentVideoId = videoId;
  if (!hasApiKey) return;
  renderCounts(statsCache.get(videoId));
  if (!statsCache.has(videoId)) {
    fetchStats([videoId])
      .then(() => {
        if (currentVideoId === videoId) renderCounts(statsCache.get(videoId));
      })
      .catch(() => {});
  }
}

function renderCounts(stats) {
  // 채널이 좋아요 수를 숨긴 영상은 숫자 대신 글자로 보여준다
  likeCount.textContent = stats?.likeCount != null ? formatCount(stats.likeCount) : '좋아요';
  commentCount.textContent = stats?.commentCount != null ? formatCount(stats.commentCount) : '댓글';
}

// ===== 아래에서 올라오는 창 =====
function openSheet(sheet) {
  closeSheet();
  openedSheet = sheet;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  sheetBackdrop.classList.add('show');
}

function closeSheet() {
  if (!openedSheet) return;
  openedSheet.classList.remove('open');
  openedSheet.setAttribute('aria-hidden', 'true');
  sheetBackdrop.classList.remove('show');
  openedSheet = null;
  sourceInput.blur(); // 모바일 키보드 닫기
}

function isSheetOpen() {
  return openedSheet !== null;
}

sheetBackdrop.addEventListener('click', closeSheet);
document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeSheet));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

function setStatus(el, message) {
  el.textContent = message;
}

// ===== 댓글 =====
let commentsVideoId = null;   // 지금 댓글 창에 불러온 영상
let commentsNextToken = null; // 다음 페이지 토큰

commentBtn.addEventListener('click', openComments);
commentsMore.addEventListener('click', loadMoreComments);

function openComments() {
  openSheet(commentsSheet);
  if (commentsVideoId === currentVideoId) return; // 같은 영상이면 이미 불러온 댓글을 그대로 보여준다

  commentsVideoId = currentVideoId;
  commentsNextToken = null;
  commentsList.replaceChildren();
  commentsSheet.querySelector('.sheet-body').scrollTop = 0;
  const stats = statsCache.get(currentVideoId);
  commentsTitle.textContent = stats?.commentCount != null
    ? `댓글 ${stats.commentCount.toLocaleString('ko-KR')}개`
    : '댓글';
  loadMoreComments();
}

async function loadMoreComments() {
  const videoId = commentsVideoId;
  commentsMore.hidden = true;
  setStatus(commentsStatus, '불러오는 중...');
  try {
    const { comments, nextPageToken } = await fetchComments(videoId, commentsNextToken || undefined);
    if (videoId !== commentsVideoId) return; // 그사이 다른 영상의 댓글 창을 열었으면 버린다
    comments.forEach((c) => commentsList.append(renderComment(c)));
    commentsNextToken = nextPageToken || null;
    commentsMore.hidden = !commentsNextToken;
    setStatus(commentsStatus, commentsList.children.length ? '' : '아직 댓글이 없어요');
  } catch (err) {
    if (videoId !== commentsVideoId) return;
    setStatus(commentsStatus, apiErrorMessage(err));
    commentsVideoId = null; // 창을 다시 열면 재시도한다
  }
}

// 댓글 내용은 textContent 로만 넣는다 (innerHTML 을 쓰면 댓글에 든 코드가 실행될 수 있다)
function renderComment(c) {
  const li = document.createElement('li');
  li.className = 'comment';

  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.src = c.avatar;
  avatar.alt = '';
  avatar.loading = 'lazy';
  avatar.referrerPolicy = 'no-referrer';
  avatar.addEventListener('error', () => { avatar.style.visibility = 'hidden'; });

  const body = document.createElement('div');
  body.className = 'comment-body';

  const meta = document.createElement('div');
  meta.className = 'comment-meta';
  const author = document.createElement('strong');
  author.textContent = c.author;
  const time = document.createElement('span');
  time.textContent = formatTimeAgo(c.publishedAt);
  meta.append(author, time);

  const text = document.createElement('p');
  text.className = 'comment-text';
  text.textContent = c.text;

  const foot = document.createElement('div');
  foot.className = 'comment-foot';
  foot.textContent = `👍 ${formatCount(c.likeCount)}` + (c.replyCount ? ` · 답글 ${c.replyCount}개` : '');

  body.append(meta, text, foot);
  li.append(avatar, body);
  return li;
}

// ===== 영상 불러오기 (재생목록 / 채널) =====
sourceBtn.addEventListener('click', () => openSheet(sourceSheet));

sourceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loadSource(sourceInput.value);
});

sourceReset.addEventListener('click', () => {
  setVideos(VIDEO_IDS);
  saveSource(null);
  sourceInput.value = '';
  setStatus(sourceStatus, '');
  updateSourceCurrent('기본 목록', VIDEO_IDS.length);
  closeSheet();
  showToast('기본 목록으로 되돌렸어요');
});

// silent: 앱을 열 때 저장된 목록을 자동으로 불러오는 경우 (실패해도 기본 목록을 계속 재생한다)
async function loadSource(text, { silent = false } = {}) {
  const source = parseSource(text);
  if (!source) {
    setStatus(sourceStatus, '재생목록 링크나 채널 링크를 입력해 주세요');
    return;
  }

  sourceSubmit.disabled = true;
  setStatus(sourceStatus, '불러오는 중...');
  try {
    const { ids, label } = await fetchVideosFromSource(source);
    if (!ids.length) throw Object.assign(new Error('no videos'), { reason: 'empty' });
    await fetchStats(ids).catch(() => {}); // 좋아요/댓글 수를 미리 받아 두면 넘길 때 바로 보인다
    setVideos(ids);
    saveSource(text.trim());
    updateSourceCurrent(label, ids.length);
    setStatus(sourceStatus, '');
    closeSheet();
    showToast(`${label} ${ids.length}개를 섞어서 재생해요`);
  } catch (err) {
    setStatus(sourceStatus, apiErrorMessage(err));
    if (silent) showToast('저장된 목록을 불러오지 못해 기본 목록을 재생해요');
  } finally {
    sourceSubmit.disabled = false;
  }
}

function updateSourceCurrent(label, count) {
  sourceCurrent.textContent = `지금 재생 중: ${label} (${count}개)`;
}

// 마지막으로 불러온 링크는 이 브라우저에만 저장해 두고 다음에 열 때 다시 불러온다
function saveSource(text) {
  try {
    if (text) localStorage.setItem(SOURCE_STORAGE_KEY, text);
    else localStorage.removeItem(SOURCE_STORAGE_KEY);
  } catch {
    // 시크릿 모드 등에서 저장이 막혀도 앱은 그대로 동작한다
  }
}

function readSavedSource() {
  try {
    return localStorage.getItem(SOURCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

// app.js 에서 플레이어가 준비되면 호출한다
function restoreSavedSource() {
  if (!hasApiKey) return;
  updateSourceCurrent('기본 목록', VIDEO_IDS.length);
  const saved = readSavedSource();
  if (saved) {
    sourceInput.value = saved;
    loadSource(saved, { silent: true });
  } else {
    fetchStats(videoIds).then(() => updateVideoInfo(currentVideoId)).catch(() => {});
  }
}
