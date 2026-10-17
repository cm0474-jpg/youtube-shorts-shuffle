// 설정 예시 파일 — 이 파일을 복사해서 js/config.js 를 만들고 값을 채운다.
//   cp js/config.example.js js/config.js
// js/config.js 는 .gitignore 에 들어 있어서 커밋되지 않는다 (API 키를 저장소에 올리지 않기 위해).
// GitHub Pages 배포 때는 .github/workflows/deploy.yml 이 저장소 Secrets 로 js/config.js 를 만들어 넣는다.

// YouTube Data API v3 키
// Google Cloud Console 에서 "웹사이트 제한(사이트 주소, localhost)"과 "API 제한(YouTube Data API v3만)"을 건다.
// 비워 두면 영상 목록, 좋아요 수, 댓글을 불러올 수 없다.
const YOUTUBE_API_KEY = '';

// 구글 로그인용 OAuth 클라이언트 ID (좋아요/싫어요, 댓글/답글 쓰기에 쓴다)
// Google Cloud Console 의 Google 인증 플랫폼 → 클라이언트에서 만든 "웹 애플리케이션" 클라이언트 ID.
// 비워 두면 로그인 기능은 숨겨진다.
const GOOGLE_CLIENT_ID = '';
