"""여러 브라우저·화면 크기 점검 (ROADMAP #4~#6, 10/28)

브라우저 엔진 x 8가지 화면 크기마다 시작 화면 → 채널 불러오기 → 재생 → ⋮ 메뉴 → 댓글 창을 차례로 열고,
가로 스크롤 / 버튼이 화면 밖으로 나가는지 / 버튼 겹침 / 창 넘침 / 스크립트 오류를 자동으로 검사한다.
YouTube Data API 응답은 처음 한 번만 실제로 받고 나머지는 저장본으로 돌려준다 (사용량 절약).

실행 방법:
  1. js/config.js 에 API 키를 넣고 (js/config.example.js 참고) 저장소 폴더에서 python3 -m http.server 8000
  2. pip install playwright && playwright install chromium firefox
  3. python3 tests/devcheck.py [스크린샷 폴더] [엔진 ...]   (기본: tests/output, chromium firefox)
결과는 화면에 한 줄씩, 스크린샷과 results.json 은 스크린샷 폴더에 저장된다 (tests/output 은 커밋하지 않음).
"""
import json, sys, pathlib
from playwright.sync_api import sync_playwright

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent / 'output')
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:8000/'
SOURCE = '@jongho_food'
VIEWPORTS = [
    ('phone-s', 360, 800, True), ('phone-l', 412, 915, True), ('iphone', 390, 844, True),
    ('phone-land', 915, 412, True), ('tablet', 820, 1180, True), ('tablet-land', 1180, 820, True),
    ('laptop', 1366, 768, False), ('desktop', 1920, 1080, False),
]
API_CACHE = {}

def route_api(route):
    url = route.request.url
    if url in API_CACHE:
        status, body = API_CACHE[url]
        route.fulfill(status=status, body=body, content_type='application/json')
        return
    resp = route.fetch()
    body = resp.body()
    API_CACHE[url] = (resp.status, body)
    route.fulfill(response=resp, body=body)

CHECK_JS = """() => {
  const vw = innerWidth, vh = innerHeight, issues = [];
  if (document.documentElement.scrollWidth > vw + 1) issues.push('가로 스크롤 ' + document.documentElement.scrollWidth + '>' + vw);
  const ids = ['likeBtn','commentBtn','soundBtn','shuffleBtn','sourceBtn','moreBtn','progress'];
  const boxes = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el || el.hidden || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    boxes[id] = r;
    if (r.left < 0 || r.top < 0 || r.right > vw + 1 || r.bottom > vh + 1) issues.push(id + ' 화면 밖');
  }
  const btns = ['likeBtn','commentBtn','soundBtn','shuffleBtn','sourceBtn'].filter(i => boxes[i]);
  for (let i = 1; i < btns.length; i++) if (boxes[btns[i]].top < boxes[btns[i-1]].bottom - 1) issues.push(btns[i-1] + '/' + btns[i] + ' 겹침');
  if (boxes.moreBtn && boxes.likeBtn && boxes.likeBtn.top < boxes.moreBtn.bottom) issues.push('⋮ 와 버튼 겹침');
  const frame = document.getElementById('frame').getBoundingClientRect();
  return { issues, frame: [Math.round(frame.width), Math.round(frame.height)] };
}"""

SHEET_JS = """(id) => {
  const r = document.getElementById(id).getBoundingClientRect();
  const issues = [];
  if (r.left < -1 || r.right > innerWidth + 1) issues.push(id + ' 가로로 넘침');
  if (r.top < -1) issues.push(id + ' 위로 넘침');
  if (r.height < 120) issues.push(id + ' 너무 낮음 ' + Math.round(r.height));
  return issues;
}"""

def run(p, engine):
    browser = getattr(p, engine).launch()
    rows = []
    for name, w, h, mobile in VIEWPORTS:
        opts = dict(viewport={'width': w, 'height': h}, locale='ko-KR', has_touch=mobile)
        if mobile and engine != 'firefox':
            opts['is_mobile'] = True  # 파이어폭스는 모바일 모드를 지원하지 않는다
        ctx = browser.new_context(**opts)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)[:120]))
        page.route('https://www.googleapis.com/youtube/v3/**', route_api)
        row = {'engine': engine, 'view': name, 'size': f'{w}x{h}', 'issues': [], 'errors': errors}
        try:
            page.goto(BASE, wait_until='load')
            page.wait_for_timeout(800)
            row['issues'] += [i for i in page.evaluate(CHECK_JS)['issues'] if '가로 스크롤' in i]
            page.screenshot(path=OUT / f'{engine}-{name}-1start.png')
            page.fill('#sourceInput', SOURCE)
            page.click('#sourceSubmit')
            page.wait_for_function("() => document.getElementById('startScreen').hidden", timeout=30000)
            page.wait_for_timeout(5000)
            res = page.evaluate(CHECK_JS)
            row['issues'] += res['issues']
            row['frame'] = res['frame']
            row['playing'] = page.evaluate("() => typeof player !== 'undefined' && player.getPlayerState ? player.getPlayerState() : null")
            page.screenshot(path=OUT / f'{engine}-{name}-2player.png')
            page.click('#moreBtn')
            page.wait_for_timeout(600)
            row['issues'] += page.evaluate(SHEET_JS, 'menuSheet')
            page.screenshot(path=OUT / f'{engine}-{name}-3menu.png')
            page.keyboard.press('Escape')
            page.wait_for_timeout(500)
            page.click('#commentBtn')
            page.wait_for_timeout(1500)
            row['issues'] += page.evaluate(SHEET_JS, 'commentsSheet')
            row['comments'] = page.evaluate("() => document.querySelectorAll('#commentsList > li').length")
            page.screenshot(path=OUT / f'{engine}-{name}-4comments.png')
        except Exception as e:
            row['issues'].append('실패: ' + str(e).splitlines()[0][:150])
            page.screenshot(path=OUT / f'{engine}-{name}-x-fail.png')
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        ctx.close()
    browser.close()
    return rows

with sync_playwright() as p:
    allrows = []
    for engine in (sys.argv[2:] or ['chromium', 'firefox']):
        allrows += run(p, engine)
    (OUT / 'results.json').write_text(json.dumps(allrows, ensure_ascii=False, indent=1))
