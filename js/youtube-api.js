'use strict';

// YouTube Data API v3 호출 모음
// 하루 사용량(기본 10,000 units) 기준 비용: 아래 요청은 모두 1 unit 씩이다.

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3/';
const MAX_SOURCE_VIDEOS = 200; // 재생목록/채널에서 불러올 최대 영상 수

const hasApiKey = Boolean(YOUTUBE_API_KEY);

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

// 사용자에게 보여줄 에러 문구
function apiErrorMessage(err) {
  const reason = err.reason || '';
  const message = err.message || '';
  if (reason === 'quotaExceeded') return '오늘 API 사용량을 다 썼어요. 내일 다시 시도해 주세요';
  if (reason === 'commentsDisabled') return '댓글이 사용 중지된 영상이에요';
  if (reason === 'channelNotFound') return '채널을 찾을 수 없어요';
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
async function fetchPlaylistVideoIds(playlistId) {
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
  } while (pageToken && ids.length < MAX_SOURCE_VIDEOS);
  return [...new Set(ids)].slice(0, MAX_SOURCE_VIDEOS);
}

// 채널의 숏츠 목록을 가져온다.
// 채널의 업로드 재생목록 ID는 UU...로 시작하고, 앞부분을 UUSH로 바꾸면 숏츠만 모인 재생목록이 된다.
// (공식 문서에는 없는 방식이라, 실패하면 전체 업로드 영상으로 대신한다)
async function fetchChannelVideoIds(source) {
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

  try {
    const shorts = await fetchPlaylistVideoIds(`UUSH${uploads.slice(2)}`);
    if (shorts.length) return { ids: shorts, label: `${name}의 숏츠` };
  } catch {
    // 숏츠 재생목록이 없으면 아래에서 전체 업로드로 대신한다
  }
  return { ids: await fetchPlaylistVideoIds(uploads), label: `${name}의 전체 영상` };
}

async function fetchVideosFromSource(source) {
  if (source.type === 'playlist') {
    return { ids: await fetchPlaylistVideoIds(source.id), label: '재생목록' };
  }
  return fetchChannelVideoIds(source);
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

// ===== 댓글 =====
async function fetchComments(videoId, pageToken) {
  const data = await ytGet('commentThreads', {
    part: 'snippet',
    videoId,
    maxResults: 20,
    order: 'relevance',
    textFormat: 'plainText',
    pageToken,
  });
  const comments = (data.items || []).map((item) => {
    const c = item.snippet.topLevelComment.snippet;
    return {
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
