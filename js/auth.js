'use strict';

// 구글 로그인 (Google Identity Services 의 토큰 방식 — 서버 없이 브라우저에서만 동작)
// - 로그인하면 유튜브 권한(youtube.force-ssl) 토큰을 받아 좋아요/싫어요, 댓글/답글 쓰기에 쓴다
// - 토큰은 1시간짜리라 만료 시각과 함께 이 브라우저에만 저장하고, 만료되면 다시 받는다
// - 우리 쪽 서버가 없으므로 토큰과 계정 정보는 사용자의 브라우저 밖으로 나가지 않는다 (privacy.html)

const AUTH_STORAGE_KEY = 'shorts-shuffle:auth';
const AUTH_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const hasLogin = typeof GOOGLE_CLIENT_ID !== 'undefined' && Boolean(GOOGLE_CLIENT_ID);

let auth = loadAuth(); // { token, expiresAt, me: { title, handle, avatar, hasChannel } }
let tokenClient = null;
let pendingLogin = null; // 로그인 창의 결과를 기다리는 Promise 의 resolve/reject
const authListeners = [];

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function saveAuth() {
  try {
    if (auth) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // 저장이 막혀도 이번 실행 동안은 로그인 상태가 유지된다
  }
}

// 로그인 상태가 바뀌면 화면(계정 버튼, 좋아요 색, 댓글 입력칸)을 다시 그린다
function onAuthChange(fn) {
  authListeners.push(fn);
}

function notifyAuth() {
  authListeners.forEach((fn) => fn(currentUser()));
}

// 로그인했으면 계정 정보, 아니면 null. (토큰이 만료되었어도 계정 정보는 보여준다 — 필요할 때 다시 받는다)
function currentUser() {
  return auth?.me ? auth.me : null;
}

function isLoggedIn() {
  return Boolean(auth?.me);
}

function hasValidToken() {
  return Boolean(auth?.token && Date.now() < auth.expiresAt);
}

function initTokenClient() {
  if (tokenClient) return true;
  if (!window.google?.accounts?.oauth2) return false; // 구글 로그인 스크립트가 아직 안 받아졌다
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: AUTH_SCOPE,
    callback: onTokenResponse,
    error_callback: (err) => finishLogin(null, err?.type === 'popup_closed' ? 'loginCancelled' : 'loginFailed'),
  });
  return true;
}

// 로그인 창을 띄운다. 브라우저가 팝업을 막지 않도록 반드시 버튼을 누른 그 순간에 불러야 한다.
// silent: 전에 로그인했던 사용자의 토큰을 다시 받을 때 (계정 선택 화면 없이 바로 닫힌다)
function login({ silent = false } = {}) {
  if (!hasLogin) return Promise.reject(Object.assign(new Error('login disabled'), { reason: 'notLoggedIn' }));
  if (!initTokenClient()) {
    return Promise.reject(Object.assign(new Error('google script not loaded'), { reason: 'loginFailed' }));
  }
  if (pendingLogin) pendingLogin.reject(Object.assign(new Error('replaced'), { reason: 'loginCancelled' }));
  return new Promise((resolve, reject) => {
    pendingLogin = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: silent ? '' : 'select_account' });
  });
}

function finishLogin(token, errorReason) {
  const pending = pendingLogin;
  pendingLogin = null;
  if (!pending) return;
  if (token) pending.resolve(token);
  else pending.reject(Object.assign(new Error(errorReason), { reason: errorReason }));
}

async function onTokenResponse(resp) {
  if (resp.error || !resp.access_token) {
    finishLogin(null, resp.error === 'access_denied' ? 'loginCancelled' : 'loginFailed');
    return;
  }
  // 권한 선택 화면에서 유튜브 권한을 빼고 허용하면 좋아요/댓글을 쓸 수 없다
  if (!google.accounts.oauth2.hasGrantedAllScopes(resp, AUTH_SCOPE)) {
    finishLogin(null, 'insufficientPermissions');
    return;
  }
  const isNewLogin = !auth?.me;
  auth = {
    token: resp.access_token,
    expiresAt: Date.now() + (Number(resp.expires_in) - 60) * 1000, // 만료 1분 전에 미리 새로 받는다
    me: auth?.me || null,
  };
  saveAuth();
  finishLogin(resp.access_token);
  if (isNewLogin) {
    try {
      auth.me = await fetchMyChannel();
      saveAuth();
    } catch {
      auth.me = { hasChannel: false, title: '', handle: '', avatar: '' };
    }
  }
  notifyAuth();
}

// 유효한 토큰을 돌려준다. 없거나 만료되었으면 로그인 창을 띄운다 (버튼을 누른 순간에 불러야 한다)
function getAccessToken() {
  if (hasValidToken()) return Promise.resolve(auth.token);
  return login({ silent: Boolean(auth?.me) });
}

// 토큰이 만료/취소되어 API 가 401 을 돌려줬을 때 (계정 정보는 남겨서 다음에 조용히 다시 받는다)
function clearAuth() {
  if (!auth) return;
  auth.token = null;
  auth.expiresAt = 0;
  saveAuth();
}

// 로그아웃: 권한을 해제하고, 이 기기에 남은 내 기록(최근 검색어 등)도 지운다 (user-data.js)
function logout() {
  if (auth?.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(auth.token, () => {});
  auth = null;
  saveAuth();
  clearUserData();
  notifyAuth();
}
