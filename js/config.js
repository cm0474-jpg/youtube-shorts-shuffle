// YouTube Data API v3 키
// 이 키는 브라우저 코드에 그대로 들어가므로 공개된다고 보고,
// Google Cloud Console 에서 "웹사이트 제한(이 사이트 주소만)"과 "API 제한(YouTube Data API v3만)"으로 보호한다.
// 비워 두면 영상 목록, 좋아요 수, 댓글을 불러올 수 없다.
const YOUTUBE_API_KEY = 'AIzaSyD0cVQp0RIJ6wNCbPDYzwaArKQ3gK0rXUA';

// 구글 로그인용 OAuth 클라이언트 ID (좋아요/싫어요, 댓글/답글 쓰기에 쓴다)
// Google Cloud Console 의 Google 인증 플랫폼 → 클라이언트에서 만든 "웹 애플리케이션" 클라이언트 ID.
// 클라이언트 ID 는 공개되어도 되는 값이고, 승인된 자바스크립트 원본(이 사이트 주소)에서만 동작한다.
// 비워 두면 로그인 기능은 숨겨진다.
const GOOGLE_CLIENT_ID = '269821159009-30ofobss4qelhful7if63s6n29b8cu97.apps.googleusercontent.com';
