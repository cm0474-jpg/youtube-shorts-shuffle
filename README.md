# YouTube Shorts Shuffle

유튜브 숏츠와 재생목록 동영상을 **랜덤으로 재생**하는 모바일 최적화 웹앱(PWA)입니다.

## 배경

유튜브는 재생목록 내 동영상이나 숏츠를 랜덤으로 재생하는 기능을 제공하지 않습니다.
모바일로 유튜브를 소비하는 사용자들이 느끼는 이 불편함을 해소하기 위해 프로젝트를 시작했습니다.

## 핵심 기능

- 숏츠 동영상 랜덤 재생
- 모바일 최적화 화면 비율 (9:16 세로 화면)
- 스와이프로 다음 영상 넘기기
- 재생목록 / 채널 숏츠 불러오기 (YouTube Data API)
- 좋아요 수 표시, 댓글 보기

## 사용 방법

| 동작 | 모바일 | PC |
|---|---|---|
| 다음 영상 | 위로 스와이프 | ↓ 키 / 마우스 휠 아래 |
| 이전 영상 | 아래로 스와이프 | ↑ 키 / 마우스 휠 위 |
| 재생 / 일시정지 | 화면 탭 | 클릭 / 스페이스바 |
| 소리 켜기/끄기 | 🔇 버튼 | 🔇 버튼 / M 키 |
| 다시 섞기 | 🔀 버튼 | 🔀 버튼 |
| 댓글 보기 | 💬 버튼 | 💬 버튼 (Esc 로 닫기) |
| 재생목록 / 채널 불러오기 | 📂 버튼 | 📂 버튼 |

모바일 브라우저는 소리가 있는 자동재생을 막기 때문에 처음에는 음소거 상태로 재생됩니다.

📂 버튼에는 재생목록 링크(`youtube.com/playlist?list=...`)나 채널 링크(`youtube.com/@채널이름`)를 넣습니다.
채널 링크를 넣으면 그 채널의 숏츠만 불러오고, 마지막으로 불러온 링크는 다음에 열 때 자동으로 다시 불러옵니다.

## YouTube Data API 키 설정

👍 / 💬 / 📂 기능은 YouTube Data API 키가 있어야 보입니다. 키가 없으면 `js/videos.js`의 기본 목록만 재생합니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들고 **YouTube Data API v3**를 사용 설정합니다.
2. **사용자 인증 정보 → API 키**를 만들고 다음과 같이 제한합니다.
   - 애플리케이션 제한사항: 웹사이트 — `https://cm0474-jpg.github.io/*`, `http://localhost:8000/*`
   - API 제한사항: YouTube Data API v3
3. `js/config.js`의 `YOUTUBE_API_KEY`에 키를 넣습니다.

브라우저에서 동작하는 앱이라 키는 페이지 코드에 공개됩니다. 위의 제한 설정 덕분에 이 사이트에서, YouTube 조회 용도로만 쓸 수 있습니다.

## 로컬에서 실행하기

YouTube 플레이어는 `file://`로 연 페이지에서는 동작하지 않으므로 로컬 서버로 엽니다.

```bash
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 에 접속합니다.

## 프로젝트 구조

```
index.html          화면 구조
css/style.css       9:16 세로 레이아웃, 버튼, 아래에서 올라오는 창
js/config.js        YouTube Data API 키
js/videos.js        기본 숏츠 영상 ID 목록
js/youtube-api.js   YouTube Data API 호출 (재생목록, 채널, 좋아요 수, 댓글)
js/app.js           랜덤 순서, 스와이프, 플레이어 제어
js/panels.js        좋아요/댓글 표시, 댓글 창, 영상 불러오기 창
```

## 기술 스택

- HTML / CSS / JavaScript
- YouTube IFrame Player API
- YouTube Data API v3
- PWA (홈 화면 추가 지원)
- GitHub Pages 배포
