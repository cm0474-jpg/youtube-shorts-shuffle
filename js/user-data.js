'use strict';

// 사용자 기록 저장소 — 기록은 계정 단위로만 남긴다 (ROADMAP #3)
// - 로그인한 동안: 이 브라우저에 저장한다 (최근 검색어, 검색 결과 저장본, 자막 설정)
// - 로그아웃하면: 이 기기에서 모두 지운다 → 같은 기기를 다음에 쓰는 사람에게 내 기록이 보이지 않는다
// - 로그인하지 않은 손님: 저장하지 않고 이 탭을 쓰는 동안만 기억한다 (탭을 닫으면 사라진다)
// 서버가 없어서 기기를 바꾸면 기록이 따라가지 않는다 (좋아요/댓글은 유튜브 계정에 남으므로 따라간다).

const USER_DATA_PREFIX = 'shorts-shuffle:user:';
const guestData = new Map();

function userDataGet(name, fallback) {
  if (!isLoggedIn()) return guestData.has(name) ? guestData.get(name) : fallback;
  try {
    return JSON.parse(localStorage.getItem(USER_DATA_PREFIX + name)) ?? fallback;
  } catch {
    return fallback;
  }
}

function userDataSet(name, value) {
  if (!isLoggedIn()) {
    guestData.set(name, value);
    return;
  }
  try {
    localStorage.setItem(USER_DATA_PREFIX + name, JSON.stringify(value));
  } catch {
    // 시크릿 모드 등에서 저장이 막혀도 이번 실행 동안은 화면에 남아 있다
  }
}

// auth.js 의 logout() 이 부른다
function clearUserData() {
  guestData.clear();
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(USER_DATA_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // 저장소를 쓸 수 없으면 지울 것도 없다
  }
}

// 손님으로 쓰다가 로그인하면 그동안의 기록을 계정 쪽(이 브라우저 저장소)으로 옮긴다
onAuthChange((user) => {
  if (!user || !guestData.size) return;
  guestData.forEach((value, name) => userDataSet(name, value));
  guestData.clear();
});

// 예전 버전은 로그인과 상관없이 기록을 남겼다 → 한 번 지운다
try {
  ['shorts-shuffle:recent-searches', 'shorts-shuffle:search-cache', 'shorts-shuffle:captions', 'shorts-shuffle:source']
    .forEach((key) => localStorage.removeItem(key));
} catch {
  // 저장소를 쓸 수 없으면 남은 기록도 없다
}
