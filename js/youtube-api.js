'use strict';

// YouTube Data API v3 호출 모음
// 하루 사용량(기본 10,000 units) 기준 비용: 아래 요청은 모두 1 unit 씩이다.

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3/';
// 재생목록/채널의 영상을 전부 불러온다. 영상이 아주 많은 채널을 대비한 안전 상한
// (50개당 1 unit 이므로 5,000개면 100 units)
const MAX_SOURCE_VIDEOS = 5000;

// js/config.js 가 없거나 비어 있으면 API 기능을 끈다 (config.example.js 참고)
const hasApiKey = typeof YOUTUBE_API_KEY !== 'undefined' && Boolean(YOUTUBE_API_KEY);

async function ytGet(endpoint, params) {
  const url = new URL(endpoint, YT_API_BASE);
  for (const [k, v] of Object.entries({ ...params, key: YOUTUBE_API_KEY })) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || res.statusText);
    err.reason = data.error?.errors?.[0]?.reason || data.error?.status || 'unknown';
    err.status = res.status;
    throw err;
  }
  return data;
}

// 로그인한 사용자 권한으로 보내는 요청 (좋아요/싫어요, 댓글/답글 쓰기, 내 채널 정보)
// 토큰은 auth.js 의 getAccessToken() 이 준다 (로그인 안 했으면 로그인 창을 띄운다)
async function ytAuthRequest(method, endpoint, params = {}, body) {
  const token = await getAccessToken();
  const url = new URL(endpoint, YT_API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  if (res.status === 204) return {}; // 좋아요/싫어요는 성공하면 빈 응답이 온다
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearAuth(); // 토큰이 만료되었거나 권한을 해제했으면 다시 로그인하게 한다
    const err = new Error(data.error?.message || res.statusText);
    err.reason = data.error?.errors?.[0]?.reason || data.error?.status || 'unknown';
    err.status = res.status;
    throw err;
  }
  return data;
}

// ===== 로그인 사용자 기능 =====
// 비용: 좋아요/싫어요, 댓글, 답글 쓰기 50 units / 내 평가 확인, 내 채널 정보 1 unit

// rating: 'like' | 'dislike' | 'none'
function rateVideo(videoId, rating) {
  return ytAuthRequest('POST', 'videos/rate', { id: videoId, rating });
}

// 내가 이 영상들에 누른 평가 → Map(videoId → 'like' | 'dislike' | 'none')
async function getMyRatings(ids) {
  const data = await ytAuthRequest('GET', 'videos/getRating', { id: ids.join(',') });
  return new Map((data.items || []).map((item) => [item.videoId, item.rating]));
}

async function fetchMyChannel() {
  const data = await ytAuthRequest('GET', 'channels', { part: 'snippet', mine: 'true' });
  const ch = data.items?.[0];
  return ch
    ? { hasChannel: true, title: ch.snippet.title, handle: ch.snippet.customUrl || '', avatar: ch.snippet.thumbnails?.default?.url || '' }
    : { hasChannel: false, title: '', handle: '', avatar: '' };
}

function toComment(snippet, extra = {}) {
  return {
    author: snippet.authorDisplayName,
    avatar: snippet.authorProfileImageUrl,
    text: snippet.textOriginal ?? snippet.textDisplay,
    likeCount: snippet.likeCount || 0,
    publishedAt: snippet.publishedAt,
    ...extra,
  };
}

async function postComment(videoId, text) {
  const data = await ytAuthRequest('POST', 'commentThreads', { part: 'snippet' }, {
    snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } },
  });
  return toComment(data.snippet.topLevelComment.snippet, { id: data.id, replyCount: 0 });
}

async function postReply(parentId, text) {
  const data = await ytAuthRequest('POST', 'comments', { part: 'snippet' }, {
    snippet: { parentId, textOriginal: text },
  });
  return toComment(data.snippet, { replyCount: 0 });
}

// 사용자에게 보여줄 에러 문구
function apiErrorMessage(err) {
  const reason = err.reason || '';
  const message = err.message || '';
  if (reason === 'quotaExceeded') return '오늘 API 사용량을 다 썼어요. 내일 다시 시도해 주세요';
  if (reason === 'commentsDisabled') return '댓글이 사용 중지된 영상이에요';
  if (reason === 'notLoggedIn') return '로그인이 필요해요';
  if (reason === 'loginCancelled') return '로그인이 취소되었어요';
  if (err.status === 401) return '로그인이 만료되었어요. 다시 시도해 주세요';
  if (reason === 'ineligibleAccount' || reason === 'forbidden' && message.includes('channel')) return '댓글을 쓰려면 유튜브 채널이 있어야 해요 (유튜브 앱에서 채널을 먼저 만들어 주세요)';
  if (reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') return '로그인할 때 유튜브 권한을 허용해 주세요';
  if (reason === 'channelNotFound') return '채널을 찾을 수 없어요';
  if (reason === 'noShorts') return '이 채널에는 숏츠가 없어요';
  if (reason === 'empty') return '재생할 수 있는 영상이 없어요';
  if (reason === 'playlistNotFound') return '재생목록을 찾을 수 없어요. 비공개 재생목록인지 확인해 주세요';
  if (message.includes('referer') || message.includes('referrer')) {
    return '이 주소에서는 API 키를 쓸 수 없어요 (키의 웹사이트 제한 설정을 확인해 주세요)';
  }
  if (reason === 'badRequest' && message.includes('API key')) return 'API 키가 올바르지 않아요';
  if (err instanceof TypeError) return '네트워크 연결을 확인해 주세요';
  return `불러오지 못했어요 (${reason || err.status || '알 수 없는 오류'})`;
}

// ===== 링크 해석 =====
// 지원 형식: 재생목록 링크(list=...), 채널 링크(/@핸들, /channel/UC...), @핸들, 재생목록 ID
function parseSource(text) {
  const s = text.trim();
  if (!s) return null;

  if (/^https?:\/\//i.test(s) || /^(www\.|m\.)?youtu(be\.com|\.be)\//i.test(s)) {
    try {
      const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      const list = url.searchParams.get('list');
      if (list) return { type: 'playlist', id: list };
      const handle = url.pathname.match(/^\/(@[^/]+)/);
      if (handle) return { type: 'handle', id: decodeURIComponent(handle[1]) };
      const channel = url.pathname.match(/^\/channel\/(UC[\w-]{22})/);
      if (channel) return { type: 'channel', id: channel[1] };
    } catch {
      return null;
    }
    return null;
  }

  if (/^@\S+$/.test(s)) return { type: 'handle', id: s };
  if (/^UC[\w-]{22}$/.test(s)) return { type: 'channel', id: s };
  if (/^(PL|UU|FL|OL|LL)[\w-]{10,}$/.test(s)) return { type: 'playlist', id: s };
  return null;
}

// ===== 영상 목록 =====
// onProgress(지금까지 불러온 개수): 영상이 많으면 몇 초 걸리므로 진행 상황을 알린다
async function fetchPlaylistVideoIds(playlistId, onProgress) {
  const ids = [];
  let pageToken;
  do {
    const data = await ytGet('playlistItems', {
      part: 'contentDetails,status',
      playlistId,
      maxResults: 50,
      pageToken,
    });
    for (const item of data.items || []) {
      // 비공개(private)나 삭제된 영상(privacyStatusUnspecified)은 재생할 수 없으므로 뺀다
      const privacy = item.status?.privacyStatus;
      if (privacy === 'private' || privacy === 'privacyStatusUnspecified') continue;
      ids.push(item.contentDetails.videoId);
    }
    pageToken = data.nextPageToken;
    onProgress?.(ids.length);
  } while (pageToken && ids.length < MAX_SOURCE_VIDEOS);
  return [...new Set(ids)].slice(0, MAX_SOURCE_VIDEOS);
}

// 채널의 숏츠 목록을 가져온다.
// 채널의 업로드 재생목록 ID는 UU...로 시작하고, 앞부분을 UUSH로 바꾸면 숏츠만 모인 재생목록이 된다 (공식 문서에는 없는 방식).
// 숏츠가 없는 채널은 이 재생목록이 없어서 404(playlistNotFound)가 온다 → 일반 영상으로 대신하지 않고 'noShorts' 로 알린다.
// (예전에는 전체 업로드 영상을 몰래 대신 재생했는데, 숏츠 화면에 가로 영상이 나와 혼란스럽다는 베타 피드백으로 바꿨다)
async function fetchChannelVideoIds(source, onProgress) {
  const params = { part: 'contentDetails,snippet' };
  if (source.type === 'handle') params.forHandle = source.id;
  else params.id = source.id;

  const data = await ytGet('channels', params);
  const channel = data.items?.[0];
  if (!channel) {
    const err = new Error('channel not found');
    err.reason = 'channelNotFound';
    throw err;
  }
  const uploads = channel.contentDetails.relatedPlaylists.uploads;
  const name = channel.snippet.title;

  const noShorts = () => Object.assign(new Error('channel has no shorts'), { reason: 'noShorts' });
  let shorts;
  try {
    shorts = await fetchPlaylistVideoIds(`UUSH${uploads.slice(2)}`, onProgress);
  } catch (err) {
    // 네트워크 오류, 사용량 초과 같은 다른 오류는 "숏츠 없음"으로 바꾸지 않고 그대로 알린다
    throw err.reason === 'playlistNotFound' ? noShorts() : err;
  }
  if (!shorts.length) throw noShorts();
  return { ids: shorts, label: `${name}의 숏츠` };
}

async function fetchVideosFromSource(source, onProgress) {
  if (source.type === 'playlist') {
    return { ids: await fetchPlaylistVideoIds(source.id, onProgress), label: '재생목록' };
  }
  return fetchChannelVideoIds(source, onProgress);
}

// ===== 채널 검색 =====
// search.list 는 한 번에 100 units 로 비싸다 (하루 10,000 units). 그래서 search.js 에서
// 검색 버튼을 눌렀을 때만 부르고, 같은 검색어의 결과는 하루 동안 저장해 두고 다시 쓴다.
async function searchChannels(query) {
  const data = await ytGet('search', {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: 10,
    regionCode: 'KR',
    relevanceLanguage: 'ko',
  });
  const ids = (data.items || []).map((item) => item.id.channelId).filter(Boolean);
  if (!ids.length) return [];

  // 구독자 수와 @핸들은 search 결과에 없어서 channels.list 로 한 번에 받는다 (1 unit)
  const channels = await ytGet('channels', { part: 'snippet,statistics', id: ids.join(','), maxResults: 50 });
  const byId = new Map((channels.items || []).map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((c) => ({
    id: c.id,
    title: c.snippet.title,
    handle: c.snippet.customUrl || '',
    avatar: c.snippet.thumbnails?.default?.url || '',
    subscriberCount: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? NaN),
  }));
}

// ===== 좋아요 수 / 댓글 수 =====
const statsCache = new Map(); // videoId -> { likeCount, commentCount } (값이 숨겨진 영상은 null)

async function fetchStats(ids) {
  const missing = ids.filter((id) => !statsCache.has(id));
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const data = await ytGet('videos', { part: 'statistics', id: chunk.join(','), maxResults: 50 });
    for (const item of data.items || []) {
      const s = item.statistics || {};
      statsCache.set(item.id, {
        likeCount: s.likeCount !== undefined ? Number(s.likeCount) : null,
        commentCount: s.commentCount !== undefined ? Number(s.commentCount) : null,
      });
    }
  }
}

// ===== 영상 설명 (⋮ 메뉴 → 설명) =====
const detailsCache = new Map(); // videoId -> 제목, 채널, 조회수, 날짜, 설명글
const channelAvatarCache = new Map(); // channelId -> 프로필 사진 주소

async function fetchVideoDetails(videoId) {
  if (detailsCache.has(videoId)) return detailsCache.get(videoId);
  const data = await ytGet('videos', { part: 'snippet,statistics', id: videoId });
  const item = data.items?.[0];
  if (!item) throw Object.assign(new Error('video not found'), { reason: 'videoNotFound' });
  const s = item.statistics || {};
  const details = {
    title: item.snippet.title,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    description: item.snippet.description,
    viewCount: s.viewCount !== undefined ? Number(s.viewCount) : null,
    likeCount: s.likeCount !== undefined ? Number(s.likeCount) : null,
  };
  detailsCache.set(videoId, details);
  return details;
}

async function fetchChannelAvatar(channelId) {
  if (channelAvatarCache.has(channelId)) return channelAvatarCache.get(channelId);
  const data = await ytGet('channels', { part: 'snippet', id: channelId });
  const url = data.items?.[0]?.snippet?.thumbnails?.default?.url || '';
  channelAvatarCache.set(channelId, url);
  return url;
}

// ===== 댓글 =====
// order: 'relevance' (인기순) 또는 'time' (최신순)
async function fetchComments(videoId, pageToken, order = 'relevance') {
  const data = await ytGet('commentThreads', {
    part: 'snippet',
    videoId,
    maxResults: 20,
    order,
    textFormat: 'plainText',
    pageToken,
  });
  const comments = (data.items || []).map((item) => {
    const c = item.snippet.topLevelComment.snippet;
    return {
      id: item.id,
      author: c.authorDisplayName,
      avatar: c.authorProfileImageUrl,
      text: c.textDisplay,
      likeCount: c.likeCount || 0,
      publishedAt: c.publishedAt,
      replyCount: item.snippet.totalReplyCount || 0,
    };
  });
  return { comments, nextPageToken: data.nextPageToken };
}

// 댓글의 답글 (1 unit)
async function fetchReplies(parentId, pageToken) {
  const data = await ytGet('comments', {
    part: 'snippet',
    parentId,
    maxResults: 20,
    textFormat: 'plainText',
    pageToken,
  });
  const replies = (data.items || []).map((item) => ({
    author: item.snippet.authorDisplayName,
    avatar: item.snippet.authorProfileImageUrl,
    text: item.snippet.textDisplay,
    likeCount: item.snippet.likeCount || 0,
    publishedAt: item.snippet.publishedAt,
  }));
  return { replies, nextPageToken: data.nextPageToken };
}

// ===== 표시용 포맷 =====
// 유튜브 앱과 같은 방식: 1234 → 1.2천, 56000 → 5.6만, 120000000 → 1.2억
function formatCount(n) {
  if (n === null || n === undefined) return '';
  const fmt = (v) => (v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.floor(v)));
  if (n < 1000) return String(n);
  if (n < 10000) return `${fmt(n / 1000)}천`;
  if (n < 100000000) return `${fmt(n / 10000)}만`;
  return `${fmt(n / 100000000)}억`;
}

function formatTimeAgo(iso) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  const units = [
    [60 * 60 * 24 * 365, '년'],
    [60 * 60 * 24 * 30, '개월'],
    [60 * 60 * 24 * 7, '주'],
    [60 * 60 * 24, '일'],
    [60 * 60, '시간'],
    [60, '분'],
  ];
  for (const [size, label] of units) {
    if (sec >= size) return `${Math.floor(sec / size)}${label} 전`;
  }
  return '방금 전';
}
