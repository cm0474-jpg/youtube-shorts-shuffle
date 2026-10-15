'use strict';

// 로그인과 화면 연결: 시작 화면의 계정 버튼, ⋮ 메뉴의 계정 항목, 계정 창,
// 좋아요/싫어요 누르기, 댓글 입력칸 (로그인 자체는 auth.js)

// ===== DOM =====
const accountBtn = document.getElementById('accountBtn');
const accountBtnIcon = document.getElementById('accountBtnIcon');
const accountBtnLabel = document.getElementById('accountBtnLabel');
const menuAccountItem = document.getElementById('menuAccountItem');
const menuAccount = document.getElementById('menuAccount');
const menuAccountIcon = document.getElementById('menuAccountIcon');
const menuAccountLabel = document.getElementById('menuAccountLabel');
const menuAccountValue = document.getElementById('menuAccountValue');
const accountSheet = document.getElementById('accountSheet');
const logoutBtn = document.getElementById('logoutBtn');
const likeIcon = document.getElementById('likeIcon');
const dislikeIcon = document.getElementById('dislikeIcon');

// 로그인 기능이 있을 때만 계정 버튼과 싫어요 버튼을 보여준다 (없으면 좋아요는 숫자만 보인다)
accountBtn.hidden = !hasLogin;
menuAccountItem.hidden = !hasLogin;
dislikeBtn.hidden = !(hasLogin && hasApiKey);
likeBtn.disabled = !hasLogin;

// ===== 계정 버튼 / 계정 창 =====
function onAccountClick() {
  if (isLoggedIn()) {
    openAccountSheet();
  } else {
    closeSheet();
    login().catch(() => {}); // 로그인 창을 닫으면 아무 일도 하지 않는다
  }
}

accountBtn.addEventListener('click', onAccountClick);
menuAccount.addEventListener('click', onAccountClick);

function openAccountSheet() {
  const user = currentUser();
  const avatar = document.getElementById('accountAvatar');
  if (user.avatar) avatar.src = user.avatar;
  else avatar.removeAttribute('src');
  document.getElementById('accountName').textContent = user.title || '구글 계정';
  document.getElementById('accountHandle').textContent = user.handle;
  setStatus(document.getElementById('accountNote'),
    user.hasChannel ? '' : '이 계정은 유튜브 채널이 없어서 댓글은 쓸 수 없어요. 좋아요/싫어요는 누를 수 있어요.');
  openSheet(accountSheet);
}

logoutBtn.addEventListener('click', () => {
  logout();
  closeSheet();
});

function renderAccount(user) {
  if (user) {
    fillAvatar(accountBtnIcon, user);
    accountBtnLabel.hidden = true;
    accountBtn.setAttribute('aria-label', '계정');
    fillAvatar(menuAccountIcon, user);
    menuAccountLabel.textContent = '계정';
    menuAccountValue.textContent = user.handle || user.title;
  } else {
    setIcon(accountBtnIcon, 'account');
    accountBtnLabel.hidden = false;
    accountBtn.setAttribute('aria-label', '로그인');
    setIcon(menuAccountIcon, 'account');
    menuAccountLabel.textContent = '로그인';
    menuAccountValue.textContent = '';
  }
  document.querySelectorAll('.composer-avatar').forEach((slot) => fillAvatar(slot, user));
  if (!user) ratingCache.clear();
  updateMyRating(currentVideoId);
}

onAuthChange(renderAccount);

// ===== 좋아요 / 싫어요 =====
const ratingCache = new Map(); // videoId → 'like' | 'dislike' | 'none' (내가 누른 평가)

function renderRating(rating) {
  setIcon(likeIcon, rating === 'like' ? 'likeFilled' : 'like');
  setIcon(dislikeIcon, rating === 'dislike' ? 'dislikeFilled' : 'dislike');
  likeBtn.setAttribute('aria-pressed', String(rating === 'like'));
  dislikeBtn.setAttribute('aria-pressed', String(rating === 'dislike'));
}

// 영상이 바뀔 때 (panels.js 의 updateVideoInfo) 내가 누른 평가를 보여준다 (1 unit)
async function updateMyRating(videoId) {
  if (!videoId || !hasLogin || !isLoggedIn()) {
    renderRating('none');
    return;
  }
  renderRating(ratingCache.get(videoId) || 'none');
  // 토큰이 만료되었으면 영상이 바뀔 때마다 로그인 창을 띄우지 않도록 확인을 건너뛴다
  if (ratingCache.has(videoId) || !hasValidToken()) return;
  try {
    const ratings = await getMyRatings([videoId]);
    ratingCache.set(videoId, ratings.get(videoId) || 'none');
    if (currentVideoId === videoId) renderRating(ratingCache.get(videoId));
  } catch {
    // 확인하지 못하면 빈 아이콘으로 둔다
  }
}

// 누른 평가를 다시 누르면 취소된다 (유튜브 앱과 같다). 결과를 기다리지 않고 화면부터 바꾼다
function rate(target) {
  const videoId = currentVideoId;
  const before = ratingCache.get(videoId) || 'none';
  const after = before === target ? 'none' : target;
  applyRating(videoId, before, after);
  // rateVideo 는 로그인이 필요하면 로그인 창을 띄운다 — 버튼을 누른 순간에 불러야 브라우저가 막지 않는다
  rateVideo(videoId, after).catch(() => applyRating(videoId, after, before));
}

function applyRating(videoId, from, to) {
  ratingCache.set(videoId, to);
  const stats = statsCache.get(videoId);
  if (stats?.likeCount != null) {
    if (from === 'like') stats.likeCount -= 1;
    if (to === 'like') stats.likeCount += 1;
  }
  if (currentVideoId === videoId) {
    renderRating(to);
    renderCounts(stats);
  }
}

likeBtn.addEventListener('click', () => { if (hasLogin) rate('like'); });
dislikeBtn.addEventListener('click', () => rate('dislike'));

// ===== 댓글 입력칸 (댓글 창 맨 아래) =====
const commentComposer = createComposer('댓글 추가...', async (text) => {
  const videoId = commentsVideoId || currentVideoId;
  const comment = await postComment(videoId, text);
  commentsList.prepend(renderComment(comment));
  commentsSheet.querySelector('.sheet-body').scrollTop = 0;
  setStatus(commentsStatus, '');
  const stats = statsCache.get(videoId);
  if (stats?.commentCount != null) {
    stats.commentCount += 1;
    commentsCountLabel.textContent = stats.commentCount.toLocaleString('ko-KR');
    if (currentVideoId === videoId) renderCounts(stats);
  }
});
commentComposer.element.classList.add('comment-composer');
commentComposer.element.hidden = !hasLogin;
commentsSheet.append(commentComposer.element);

// 로그인하지 않았으면 입력칸을 누를 때 로그인 창을 띄운다
commentComposer.input.addEventListener('pointerdown', (e) => {
  if (hasValidToken()) return;
  e.preventDefault();
  getAccessToken().then(() => commentComposer.input.focus()).catch(() => {});
});

renderAccount(currentUser());
