# Cloudflare Workers 배포 가이드

## 1. Cloudflare 사이트 접속

1. 브라우저에서 [https://dash.cloudflare.com](https://dash.cloudflare.com) 으로 들어갑니다.
2. 로그인합니다.
3. 왼쪽 메뉴에서 `Workers & Pages`를 클릭합니다.

화면에서 보게 될 것:
- 왼쪽에는 메뉴 목록이 보입니다.
- 가운데에는 Worker 또는 Pages 관련 프로젝트 목록이 보입니다.

## 2. API 키를 코드에 넣지 않는 이유

`index.html`은 GitHub Pages로 공개됩니다.  
즉, 여기에 API 키를 넣으면 누구나 볼 수 있습니다.

그래서 이번 구조는 이렇게 나눕니다.

- GitHub Pages: 사용자 화면
- Cloudflare Worker: 비밀키를 숨긴 중간 서버
- Gemini API 키: Cloudflare secret에만 저장

## 3. 준비물 설치

### Node.js 설치

1. [https://nodejs.org](https://nodejs.org) 에 들어갑니다.
2. `LTS` 버전을 다운로드합니다.
3. 설치 파일을 실행합니다.
4. 계속 `Next`를 눌러 설치합니다.

### Python 설치

1. [https://www.python.org/downloads/](https://www.python.org/downloads/) 에 들어갑니다.
2. 최신 안정 버전을 다운로드합니다.
3. 설치 화면에서 반드시 `Add Python to PATH`를 체크합니다.
4. `Install Now`를 누릅니다.

## 4. Worker 프로젝트 설치

1. Windows 시작 메뉴에서 `PowerShell`을 엽니다.
2. 아래 폴더로 이동합니다.

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready\worker"
```

3. 아래 명령으로 필요한 패키지를 설치합니다.

```powershell
npm install
```

정상이라면:
- `node_modules` 폴더가 생깁니다.
- 설치 완료 메시지가 보입니다.

## 5. Wrangler 로그인

1. 같은 PowerShell 창에서 아래 명령을 입력합니다.

```powershell
npx wrangler login
```

2. 브라우저 창이 열리면 Cloudflare 로그인을 완료합니다.
3. 승인 화면이 나오면 허용합니다.

## 6. KV 네임스페이스 만들기

1. PowerShell에서 아래 명령을 실행합니다.

```powershell
npx wrangler kv namespace create RATE_LIMIT_KV
```

2. 출력 결과에 `id` 값이 나옵니다.
3. 그 값을 [worker/wrangler.toml](/C:/Users/kblife/Desktop/AI%20실습/playready/worker/wrangler.toml) 에 넣습니다.

예시:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "여기에_실제_ID_붙여넣기"
```

## 7. Gemini API 키 secret 등록

1. PowerShell에서 아래 명령을 입력합니다.

```powershell
npx wrangler secret put GEMINI_API_KEY
```

2. `Enter a secret value:` 라는 문구가 나오면
3. Google AI Studio에서 받은 Gemini API 키를 붙여넣고 Enter를 누릅니다.

중요:
- 붙여넣어도 화면에 글자가 보이지 않을 수 있습니다.
- 정상 동작이니 그대로 Enter를 누르면 됩니다.

## 8. 허용 도메인 설정

GitHub Pages 주소가 예를 들어 아래와 같다고 가정하겠습니다.

```text
https://myname.github.io/playready
```

그러면 [worker/wrangler.toml](/C:/Users/kblife/Desktop/AI%20실습/playready/worker/wrangler.toml) 의 `ALLOWED_ORIGIN` 값을 아래처럼 맞춥니다.

```toml
ALLOWED_ORIGIN = "https://myname.github.io"
```

주의:
- 경로 `/playready` 까지는 넣지 않고
- 도메인 부분만 넣습니다.

## 9. PDF 추출 서비스 실행

Cloudflare Worker는 PyMuPDF를 직접 실행할 수 없습니다.  
그래서 Python 서비스가 따로 필요합니다.

중요:
- 로컬 테스트에서는 `http://127.0.0.1:8000/extract` 를 써도 됩니다.
- 실제 배포에서는 Worker가 여러분 컴퓨터의 `127.0.0.1` 에 접근할 수 없습니다.
- 따라서 실서비스에서는 Render, Railway, Fly.io 같은 곳에 이 Python 서비스를 따로 올리고, 그 공개 URL을 `PDF_EXTRACTOR_URL`에 넣어야 합니다.

1. 새 PowerShell 창을 엽니다.
2. 아래 폴더로 이동합니다.

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready\pdf-processor"
```

3. 가상환경을 만듭니다.

```powershell
python -m venv .venv
```

4. 가상환경을 켭니다.

```powershell
.venv\Scripts\Activate.ps1
```

5. 패키지를 설치합니다.

```powershell
pip install -r requirements.txt
```

6. 서버를 실행합니다.

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

7. 로컬 테스트용 Worker 설정 파일에서 `PDF_EXTRACTOR_URL` 값이 아래와 같은지 확인합니다.

```toml
PDF_EXTRACTOR_URL = "http://127.0.0.1:8000/extract"
```

실서비스 예시:

```toml
PDF_EXTRACTOR_URL = "https://playready-pdf.onrender.com/extract"
```

## 10. 로컬 테스트

1. Worker 폴더 PowerShell 창으로 돌아옵니다.
2. 아래 명령을 실행합니다.

```powershell
npm run dev
```

3. 브라우저 또는 프론트엔드에서 Worker 주소로 요청을 보냅니다.
4. 진행 상황은 `/api/generate/stream` SSE 엔드포인트로 받을 수 있습니다.

## 11. 실제 배포

1. Worker 폴더에서 아래 명령을 실행합니다.

```powershell
npx wrangler deploy
```

2. 배포가 끝나면 Cloudflare가 Worker URL을 보여줍니다.
3. 그 주소를 프론트엔드 JavaScript에서 API 주소로 사용합니다.

예시:

```text
https://playready-worker.your-subdomain.workers.dev
```

## 12. 배포 후 꼭 확인할 것

1. `/api/health`가 열리는지 확인
2. 허용되지 않은 도메인에서 호출하면 403이 나오는지 확인
3. 50MB 초과 PDF에서 친절한 오류가 뜨는지 확인
4. Gemini 키가 코드에 들어 있지 않은지 다시 확인
5. 처리 후 PDF 원본이 서버에 남지 않는지 확인
