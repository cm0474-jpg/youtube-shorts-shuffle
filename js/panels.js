'use strict';

// 시작 화면(채널/재생목록 불러오기), 오른쪽 버튼(좋아요 수, 댓글), 아래에서 올라오는 댓글 창

// ===== DOM =====
const likeBtn = document.getElementById('likeBtn');
const dislikeBtn = document.getElementById('dislikeBtn');
const likeCount = document.getElementById('likeCount');
const commentBtn = document.getElementById('commentBtn');
const commentCount = document.getElementById('commentCount');
const sourceBtn = document.getElementById('sourceBtn');
const sheetBackdrop = document.getElementById('sheetBackdrop');

const commentsSheet = document.getElementById('commentsSheet');
const commentsList = document.getElementById('commentsList');
const commentsStatus = document.getElementById('commentsStatus');
const commentsMore = document.getElementById('commentsMore');

const startScreen = document.getElementById('startScreen');
const startBack = document.getElementById('startBack');
const sourceCurrent = document.getElementById('sourceCurrent');
const sourceInput = document.getElementById('sourceInput');
const sourceSubmit = document.getElementById('sourceSubmit');
const sourceStatus = document.getElementById('sourceStatus');

let currentVideoId = null;
let openedSheet = null;

if (hasApiKey) {
  likeBtn.hidden = false;
  commentBtn.hidden = false;
}

// ===== 좋아요 수 / 댓글 수 =====
// app.js 에서 영상이 바뀔 때마다 호출한다
function updateVideoInfo(videoId) {
  currentVideoId = videoId;
  if (!hasApiKey) return;
  renderCounts(statsCache.get(videoId));
  updateMyRating(videoId); // account.js: 로그인했으면 내가 누른 좋아요/싫어요를 표시한다
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

// 댓글 창이나 시작 화면이 영상을 가리고 있는지 (app.js 에서 스와이프/키보드 조작을 막을 때 쓴다)
function isOverlayOpen() {
  return openedSheet !== null || !startScreen.hidden;
}

sheetBackdrop.addEventListener('click', closeSheet);

// 유튜브 앱처럼 손잡이나 제목 줄을 아래로 끌어서 창을 닫는다
document.querySelectorAll('.sheet').forEach((sheet) => {
  let startY = null;
  let dragY = 0;
  sheet.querySelectorAll('.sheet-handle, .sheet-header').forEach((grip) => {
    grip.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return; // 닫기(✕) 버튼은 그냥 누르게 둔다
      startY = e.clientY;
      dragY = 0;
      sheet.style.transition = 'none';
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (startY === null) return;
      dragY = Math.max(0, e.clientY - startY);
      sheet.style.transform = `translateY(${dragY}px)`;
    });
    const end = () => {
      if (startY === null) return;
      startY = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dragY > 80) closeSheet();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });
});
document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeSheet));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (openedSheet) closeSheet();
  else if (!startScreen.hidden && videoIds.length) hideStartScreen();
});

function setStatus(el, message) {
  el.textContent = message;
}

// ===== 댓글 (유튜브 앱 댓글 창처럼: 인기순/최신순, 답글 펼치기) =====
const commentsCountLabel = document.getElementById('commentsCountLabel');
const commentChips = commentsSheet.querySelectorAll('.chip');

let commentsVideoId = null;   // 지금 댓글 창에 불러온 영상
let commentsOrder = 'relevance';
let commentsNextToken = null; // 다음 페이지 토큰

commentBtn.addEventListener('click', openComments);
commentsMore.addEventListener('click', loadMoreComments);

commentChips.forEach((chip) => chip.addEventListener('click', () => {
  if (chip.dataset.order === commentsOrder) return;
  commentsOrder = chip.dataset.order;
  commentsVideoId = null; // 정렬이 바뀌면 처음부터 다시 불러온다
  openComments();
}));

function openComments() {
  openSheet(commentsSheet);
  commentChips.forEach((chip) => {
    const selected = chip.dataset.order === commentsOrder;
    chip.classList.toggle('selected', selected);
    chip.setAttribute('aria-selected', String(selected));
  });
  if (commentsVideoId === currentVideoId) return; // 같은 영상이면 이미 불러온 댓글을 그대로 보여준다

  commentsVideoId = currentVideoId;
  commentsNextToken = null;
  commentsList.replaceChildren();
  commentsSheet.querySelector('.sheet-body').scrollTop = 0;
  const stats = statsCache.get(currentVideoId);
  commentsCountLabel.textContent = stats?.commentCount != null ? stats.commentCount.toLocaleString('ko-KR') : '';
  loadMoreComments();
}

async function loadMoreComments() {
  const videoId = commentsVideoId;
  const order = commentsOrder;
  commentsMore.hidden = true;
  setStatus(commentsStatus, '불러오는 중...');
  try {
    const { comments, nextPageToken } = await fetchComments(videoId, commentsNextToken || undefined, order);
    if (videoId !== commentsVideoId || order !== commentsOrder) return; // 그사이 다른 영상/정렬로 바뀌었으면 버린다
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
// isReply: 답글은 답글 버튼/답글 목록이 없다
function renderComment(c, { isReply = false } = {}) {
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

  // 유튜브 앱처럼 "@핸들 · 3개월 전" 을 회색으로 한 줄에
  const meta = document.createElement('div');
  meta.className = 'comment-meta';
  const author = document.createElement('span');
  author.className = 'comment-handle';
  author.textContent = c.author;
  const time = document.createElement('span');
  time.textContent = `· ${formatTimeAgo(c.publishedAt)}`;
  meta.append(author, time);

  const text = document.createElement('p');
  text.className = 'comment-text';
  text.textContent = c.text;

  // 좋아요 수 (남의 댓글에 좋아요 누르기는 YouTube Data API 가 지원하지 않아서 숫자만 보여준다)
  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  const likes = document.createElement('span');
  likes.className = 'comment-likes';
  likes.innerHTML = icon('like');
  likes.append(c.likeCount ? formatCount(c.likeCount) : '');
  actions.append(likes);

  body.append(meta, text, actions);
  if (!isReply) {
    const thread = replyThread(c);
    if (hasLogin) actions.append(thread.replyButton);
    body.append(...thread.nodes);
  }
  li.append(avatar, body);
  return li;
}

// 댓글 아래의 답글 부분: 답글 쓰기 칸, "답글 N개" 펼치기, 답글 목록, 답글 더보기
function replyThread(c) {
  let replyCount = c.replyCount || 0;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'replies-toggle';
  const list = document.createElement('ul');
  list.className = 'reply-list';
  list.hidden = true;
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'replies-toggle';
  more.hidden = true;
  more.innerHTML = `${icon('expand')}<span>답글 더보기</span>`;

  let loaded = false;
  let nextToken = null;
  const setToggle = (open) => {
    toggle.hidden = !replyCount;
    toggle.innerHTML = `${icon(open ? 'collapse' : 'expand')}<span></span>`;
    toggle.querySelector('span').textContent = open ? '답글 숨기기' : `답글 ${replyCount.toLocaleString('ko-KR')}개`;
  };
  setToggle(false);

  const loadReplies = async () => {
    more.hidden = true;
    try {
      const { replies, nextPageToken } = await fetchReplies(c.id, nextToken || undefined);
      replies.forEach((r) => list.append(renderComment(r, { isReply: true })));
      nextToken = nextPageToken || null;
      more.hidden = !nextToken;
    } catch {
      loaded = false; // 다음에 펼칠 때 다시 시도한다
    }
  };

  toggle.addEventListener('click', async () => {
    const open = list.hidden;
    list.hidden = !open;
    setToggle(open);
    if (!open) {
      more.hidden = true;
      return;
    }
    if (!loaded) {
      loaded = true;
      await loadReplies();
    } else {
      more.hidden = !nextToken;
    }
  });
  more.addEventListener('click', loadReplies);

  // 답글 쓰기 (로그인 필요)
  const replyButton = document.createElement('button');
  replyButton.type = 'button';
  replyButton.className = 'comment-reply-btn';
  replyButton.innerHTML = icon('comment');
  replyButton.setAttribute('aria-label', '답글 달기');

  const form = createComposer('답글 추가...', async (textValue) => {
    const reply = await postReply(c.id, textValue);
    replyCount += 1;
    list.hidden = false;
    setToggle(true);
    list.append(renderComment(reply, { isReply: true }));
  });
  form.element.classList.add('reply-composer');
  form.element.hidden = true;

  replyButton.addEventListener('click', () => {
    // 로그인 창은 버튼을 누른 순간에 띄워야 브라우저가 막지 않는다
    getAccessToken()
      .then(() => {
        form.element.hidden = false;
        form.input.focus();
      })
      .catch(() => {});
  });
  form.onCancel = () => { form.element.hidden = true; };

  return { replyButton, nodes: [form.element, toggle, list, more] };
}

// 댓글/답글 입력칸: [내 프로필] [입력칸] [보내기]. onSubmit 이 끝나면 칸을 비운다
function createComposer(placeholder, onSubmit) {
  const element = document.createElement('form');
  element.className = 'composer';
  const avatarSlot = document.createElement('span');
  avatarSlot.className = 'composer-avatar';
  fillAvatar(avatarSlot, currentUser());
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 10000;
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'composer-send';
  send.disabled = true;
  send.setAttribute('aria-label', '보내기');
  send.innerHTML = icon('send');
  const status = document.createElement('p');
  status.className = 'composer-status';
  element.append(avatarSlot, input, send, status);

  const composer = { element, input, onCancel: null };
  input.addEventListener('input', () => { send.disabled = !input.value.trim(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && composer.onCancel) {
      e.stopPropagation();
      composer.onCancel();
    }
  });
  element.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    send.disabled = true;
    status.textContent = '';
    try {
      await onSubmit(value);
      input.value = '';
      composer.onCancel?.();
    } catch (err) {
      status.textContent = apiErrorMessage(err);
      send.disabled = false;
    }
  });
  return composer;
}

// 내 프로필 사진 (없으면 사람 모양 아이콘)
function fillAvatar(slot, user) {
  if (user?.avatar) {
    const img = document.createElement('img');
    img.src = user.avatar;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    slot.replaceChildren(img);
  } else {
    slot.innerHTML = icon('account');
  }
}

// ===== 시작 화면: 영상 불러오기 (재생목록 / 채널) =====
// 검색창, 자동완성, 검색 결과는 search.js 에서 다룬다
sourceBtn.addEventListener('click', () => showStartScreen());
startBack.addEventListener('click', hideStartScreen);

// 재생 중에 📂 를 누르면 시작 화면으로 돌아와서 다른 채널/재생목록으로 바꿀 수 있다
// message: 시작 화면에 띄울 안내 (예: 목록 전체가 재생되지 않을 때)
function showStartScreen(message = '') {
  closeSheet();
  startScreen.hidden = false;
  startBack.hidden = !videoIds.length || Boolean(message);
  setStatus(sourceStatus, message);
  if (player) player.pauseVideo();
}

function hideStartScreen() {
  startScreen.hidden = true;
  sourceInput.blur();
  if (player) player.playVideo();
}

let loadingSource = false;

// source: parseSource() 결과 또는 검색 결과에서 고른 채널 ({ type: 'channel', id })
async function loadSource(source) {
  if (loadingSource) return;
  loadingSource = true;
  sourceSubmit.disabled = true;
  setStatus(sourceStatus, '불러오는 중...');
  try {
    const { ids, label } = await fetchVideosFromSource(source, (count) => {
      setStatus(sourceStatus, `불러오는 중... (${count}개)`);
    });
    if (!ids.length) throw Object.assign(new Error('no videos'), { reason: 'empty' });
    startScreen.hidden = true;
    setVideos(ids);
    // 좋아요/댓글 수는 재생을 시작한 뒤 뒤에서 미리 받아 둔다 (영상이 많으면 몇 초 걸리므로 기다리지 않는다)
    fetchStats(ids).catch(() => {});
    updateSourceCurrent(label, ids.length);
    setStatus(sourceStatus, '');
  } catch (err) {
    setStatus(sourceStatus, apiErrorMessage(err));
  } finally {
    loadingSource = false;
    sourceSubmit.disabled = false;
  }
}

function updateSourceCurrent(label, count) {
  sourceCurrent.textContent = `지금 재생 중: ${label} (${count}개)`;
}

// ===== 처음 열었을 때 =====
if (!hasApiKey) {
  sourceSubmit.disabled = true;
  setStatus(sourceStatus, 'YouTube Data API 키가 설정되지 않았어요 (js/config.js)');
}
