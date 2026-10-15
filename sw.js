'use strict';

// 서비스 워커: 홈 화면에 추가한 앱이 빨리 열리고, 인터넷이 끊겨도 시작 화면은 뜨게 한다.
// 수정한 내용이 바로 보이도록 "항상 네트워크에서 최신 파일을 먼저 받고, 실패할 때만 저장본"을 쓴다.
// 유튜브 플레이어, YouTube Data API 같은 다른 사이트 요청은 건드리지 않는다.

const CACHE = 'shorts-shuffle-v3';
const APP_SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/icons.js',
  'js/config.js',
  'js/youtube-api.js',
  'js/app.js',
  'js/panels.js',
  'js/menu.js',
  'js/search.js',
  'js/auth.js',
  'js/account.js',
  'privacy.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    // no-cache: 브라우저 캐시에 있어도 서버에 바뀌었는지 물어본다 (안 바뀌었으면 304 로 가볍게 끝난다)
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      }),
  );
});
