'use strict';

// 시작 화면의 검색창: 유튜브 앱처럼 자동완성, 오타 교정, 최근 검색어, 채널 검색 결과
//
// API 사용량 절약
// - 자동완성/오타 교정은 유튜브 검색어 추천(suggestqueries)을 써서 API 사용량이 들지 않는다
// - 채널 검색(100 units)은 검색 버튼을 눌렀을 때만 하고, 같은 검색어의 결과는 하루 동안 저장해 둔다
// - 링크나 @핸들을 넣으면 검색 없이 바로 채널/재생목록을 불러온다

const RECENT_STORAGE_KEY = 'shorts-shuffle:recent-searches';
const SEARCH_CACHE_KEY = 'shorts-shuffle:search-cache';
const MAX_RECENT = 10;
const MAX_CACHED_SEARCHES = 30;
const SEARCH_CACHE_TTL = 24 * 60 * 60 * 1000; // 하루
const SUGGEST_DELAY = 150; // 글자를 칠 때마다 바로 부르지 않고 잠깐 멈췄을 때 부른다 (ms)

// ===== DOM =====
const sourceForm = document.getElementById('sourceForm');
const searchClear = document.getElementById('searchClear');
const suggestList = document.getElementById('suggestList');
const searchCorrection = document.getElementById('searchCorrection');
const correctedQuery = document.getElementById('correctedQuery');
const searchOriginal = document.getElementById('searchOriginal');
const channelResults = document.getElementById('channelResults');
const sourceHelp = document.getElementById('sourceHelp');

// ===== 저장소 (이 브라우저에만 저장) =====
function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 시크릿 모드 등에서 저장이 막혀도 검색은 그대로 동작한다
  }
}

// 대소문자/띄어쓰기만 다른 검색어는 같은 검색어로 본다
function normalizeQuery(q) {
  return q.toLowerCase().replace(/\s+/g, '');
}

// ===== 최근 검색어 =====
function readRecent() {
  return readJSON(RECENT_STORAGE_KEY, []);
}

function addRecent(q) {
  const recent = readRecent().filter((r) => normalizeQuery(r) !== normalizeQuery(q));
  writeJSON(RECENT_STORAGE_KEY, [q, ...recent].slice(0, MAX_RECENT));
}

function removeRecent(q) {
  writeJSON(RECENT_STORAGE_KEY, readRecent().filter((r) => r !== q));
}

// ===== 검색어 추천 (자동완성) =====
// 유튜브 검색창이 쓰는 추천 주소. 다른 사이트에서 fetch 로는 못 받아서 JSONP(<script>)로 받는다.
const suggestCache = new Map();
let jsonpSeq = 0;

function fetchSuggestions(q) {
  if (suggestCache.has(q)) return Promise.resolve(suggestCache.get(q));
  return new Promise((resolve) => {
    const callbackName = `__ytSuggest${++jsonpSeq}`;
    const script = document.createElement('script');
    let finished = false;
    const finish = (list, cache) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window[callbackName] = () => {}; // 늦게 도착한 응답이 에러를 내지 않게 빈 함수로 남겨 둔다
      script.remove();
      if (cache) suggestCache.set(q, list);
      resolve(list);
    };
    const timer = setTimeout(() => finish([], false), 3000);
    window[callbackName] = (data) => {
      const list = (data?.[1] || []).map((item) => (Array.isArray(item) ? item[0] : item)).filter(Boolean);
      finish(list, true);
    };
    script.onerror = () => finish([], false);
    script.src = 'https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=ko&gl=kr&oe=utf-8'
      + `&q=${encodeURIComponent(q)}&callback=${callbackName}`;
    document.head.append(script);
  });
}

// ===== 채널 검색 (하루 동안 결과 저장) =====
async function searchChannelsCached(query) {
  const key = normalizeQuery(query);
  const cache = readJSON(SEARCH_CACHE_KEY, {});
  const hit = cache[key];
  if (hit && Date.now() - hit.time < SEARCH_CACHE_TTL) return hit.results;

  const results = await searchChannels(query);
  cache[key] = { time: Date.now(), results };
  // 오래된 것부터 지워서 저장 개수를 제한한다
  const keys = Object.keys(cache).sort((a, b) => cache[b].time - cache[a].time);
  keys.slice(MAX_CACHED_SEARCHES).forEach((k) => delete cache[k]);
  writeJSON(SEARCH_CACHE_KEY, cache);
  return results;
}

// ===== 검색창 =====
let suggestTimer = null;
let suggestSeq = 0; // 늦게 도착한 이전 추천 결과는 버린다

sourceInput.addEventListener('input', onQueryChange);
sourceInput.addEventListener('focus', onQueryChange);

searchClear.addEventListener('click', () => {
  sourceInput.value = '';
  sourceInput.focus();
  onQueryChange();
});

// 검색창/추천 목록 바깥을 누르면 추천 목록을 닫는다
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#sourceForm, #suggestList')) hideSuggestions();
});

sourceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitQuery(sourceInput.value);
});

function onQueryChange() {
  const q = sourceInput.value.trim();
  searchClear.hidden = !sourceInput.value;
  clearTimeout(suggestTimer);
  const seq = ++suggestSeq;

  if (!q) {
    renderSuggestions(readRecent(), { recent: true });
    return;
  }
  // 링크나 @핸들을 붙여넣는 중에는 추천을 보여주지 않는다
  if (parseSource(q)) {
    hideSuggestions();
    return;
  }
  suggestTimer = setTimeout(async () => {
    const list = await fetchSuggestions(q);
    if (seq === suggestSeq && document.activeElement === sourceInput) renderSuggestions(list, { query: q });
  }, SUGGEST_DELAY);
}

function hideSuggestions() {
  suggestList.hidden = true;
  sourceInput.setAttribute('aria-expanded', 'false');
}

function renderSuggestions(list, { recent = false, query = '' } = {}) {
  suggestList.replaceChildren(...list.map((text) => suggestionItem(text, recent, query)));
  suggestList.hidden = !list.length;
  sourceInput.setAttribute('aria-expanded', String(!suggestList.hidden));
}

const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';
const ICON_HISTORY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z"/></svg>';
const ICON_FILL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17V9.41l9.29 9.3 1.42-1.42L8.41 8H16V6H5v11z"/></svg>';

function suggestionItem(text, recent, query) {
  const li = document.createElement('li');
  li.className = 'suggest-row';

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'suggest-item';
  pick.innerHTML = recent ? ICON_HISTORY : ICON_SEARCH;
  const label = document.createElement('span');
  // 유튜브처럼 입력한 부분 뒤에 이어지는 글자를 굵게 보여준다
  if (query && text.startsWith(query)) {
    const rest = document.createElement('b');
    rest.textContent = text.slice(query.length);
    label.append(query, rest);
  } else {
    label.textContent = text;
  }
  pick.append(label);
  pick.addEventListener('click', () => {
    sourceInput.value = text;
    submitQuery(text);
  });
  li.append(pick);

  if (recent) {
    // 최근 검색어 옆의 ✕ 로 하나씩 지울 수 있다
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'suggest-side';
    remove.setAttribute('aria-label', `${text} 검색 기록 삭제`);
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      removeRecent(text);
      renderSuggestions(readRecent(), { recent: true });
      sourceInput.focus();
    });
    li.append(remove);
  } else {
    // ↖ 는 검색하지 않고 검색창에 넣기만 해서 이어서 입력할 수 있게 한다
    const fill = document.createElement('button');
    fill.type = 'button';
    fill.className = 'suggest-side';
    fill.setAttribute('aria-label', `${text} 검색창에 넣기`);
    fill.innerHTML = ICON_FILL;
    fill.addEventListener('click', () => {
      sourceInput.value = `${text} `;
      sourceInput.focus();
      onQueryChange();
    });
    li.append(fill);
  }
  return li;
}

// ===== 검색 실행 =====
function submitQuery(text) {
  const q = text.trim();
  if (!q || loadingSource) return;
  hideSuggestions();
  sourceInput.blur(); // 모바일 키보드 닫기
  addRecent(q);

  // 링크나 @핸들은 검색하지 않고 바로 불러온다 (1 unit)
  const source = parseSource(q);
  if (source) {
    clearResults();
    loadSource(source);
    return;
  }
  runSearch(q, { allowCorrection: true });
}

let searchSeq = 0;

// 유튜브처럼 오타가 있으면 고친 검색어로 검색하고, 원래 검색어로 다시 검색할 수 있는 링크를 보여준다.
// 오타 판단: 추천 검색어의 첫 번째가 입력한 검색어를 포함하지 않으면 추천 쪽이 고친 검색어다.
//   예) rlawhdgh → 김종호 (한/영 전환을 잊고 입력), 침착매 → 침착맨
async function runSearch(q, { allowCorrection }) {
  const seq = ++searchSeq;
  clearResults();
  setStatus(sourceStatus, '검색 중...');

  let query = q;
  if (allowCorrection) {
    const [top] = await fetchSuggestions(q);
    if (top && !normalizeQuery(top).includes(normalizeQuery(q))) query = top;
  }

  try {
    const results = await searchChannelsCached(query);
    if (seq !== searchSeq) return;
    if (query !== q) {
      sourceInput.value = query;
      correctedQuery.textContent = query;
      searchOriginal.textContent = q;
      searchOriginal.onclick = () => {
        sourceInput.value = q;
        runSearch(q, { allowCorrection: false });
      };
      searchCorrection.hidden = false;
    }
    channelResults.replaceChildren(...results.map(channelResultItem));
    sourceHelp.hidden = true;
    setStatus(sourceStatus, results.length ? '' : '검색 결과가 없어요');
  } catch (err) {
    if (seq === searchSeq) setStatus(sourceStatus, apiErrorMessage(err));
  }
}

function clearResults() {
  searchCorrection.hidden = true;
  channelResults.replaceChildren();
}

function channelResultItem(ch) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'channel-result';

  const avatar = document.createElement('img');
  avatar.className = 'channel-avatar';
  avatar.src = ch.avatar;
  avatar.alt = '';
  avatar.loading = 'lazy';
  avatar.referrerPolicy = 'no-referrer';

  const info = document.createElement('div');
  info.className = 'channel-info';
  const name = document.createElement('strong');
  name.textContent = ch.title;
  const meta = document.createElement('span');
  const subs = Number.isFinite(ch.subscriberCount) ? `구독자 ${formatCount(ch.subscriberCount)}명` : '';
  meta.textContent = [ch.handle, subs].filter(Boolean).join(' · ');
  info.append(name, meta);

  btn.append(avatar, info);
  btn.addEventListener('click', () => loadSource({ type: 'channel', id: ch.id }));
  li.append(btn);
  return li;
}
