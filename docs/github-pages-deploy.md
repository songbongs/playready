# GitHub Pages 배포 가이드

## 1. 먼저 준비된 파일 확인

이번 프론트엔드는 단일 파일입니다.

확인할 파일:

- [`/C:/Users/kblife/Desktop/AI 실습/playready/index.html`](/C:/Users/kblife/Desktop/AI%20실습/playready/index.html)

이 파일 안에:
- 화면 디자인
- 버튼 동작
- Cloudflare Worker 호출 코드

가 모두 들어 있습니다.

## 2. Worker 주소가 맞는지 확인

`index.html` 상단 JavaScript 설정에서 아래 값을 찾습니다.

```js
WORKER_BASE_URL: "https://playready-worker.iamsangmin.workers.dev"
```

이 값이 실제 사용하는 Worker 주소와 같아야 합니다.

## 3. GitHub 저장소에 파일 올리기

PowerShell을 엽니다.

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready"
git status
git add index.html docs/github-pages-deploy.md worker/src/services/security/inputValidator.js worker/src/services/document/generationPipeline.js worker/src/services/document/promptBuilder.js
git commit -m "Add single-file frontend for GitHub Pages"
git push origin main
```

## 4. GitHub 사이트에서 저장소 열기

브라우저에서 아래 주소로 들어갑니다.

- [https://github.com/songbongs/playready](https://github.com/songbongs/playready)

여기서 `index.html` 파일이 보이면 정상입니다.

## 5. GitHub Pages 켜기

1. 저장소 상단 메뉴에서 `Settings`를 클릭합니다.
2. 왼쪽 메뉴에서 `Pages`를 클릭합니다.
3. `Build and deployment` 영역을 찾습니다.
4. `Source`를 `Deploy from a branch`로 선택합니다.
5. `Branch`를 `main`으로 선택합니다.
6. 폴더는 `/ (root)`를 선택합니다.
7. `Save`를 클릭합니다.

## 6. 배포 완료 기다리기

저장 후 잠시 기다리면 GitHub Pages 주소가 표시됩니다.

예시:

```text
https://songbongs.github.io/playready/
```

처음 배포는 1~5분 정도 걸릴 수 있습니다.

## 7. Pages 주소와 Worker CORS 확인

현재 Worker 설정의 `ALLOWED_ORIGIN` 값은 보통 아래처럼 되어 있어야 합니다.

```toml
ALLOWED_ORIGIN = "https://songbongs.github.io"
```

이 값이 다르면 브라우저에서 API 호출이 막힐 수 있습니다.

## 8. 브라우저에서 실제 접속 테스트

GitHub Pages 주소를 엽니다.

예시:

- [https://songbongs.github.io/playready/](https://songbongs.github.io/playready/)

그리고 아래 순서로 테스트합니다.

1. 게임 이름 입력
2. BGG ID 입력
3. 작은 PDF 하나 선택하거나, PDF 없이 진행
4. `문서 생성 시작` 클릭
5. 진행 상황 화면이 나오는지 확인
6. 완료 후 문서 A, 문서 B 탭이 보이는지 확인

## 9. 수정 후 다시 배포하는 법

GitHub Pages는 `main` 브랜치의 최신 파일을 자동 반영합니다.

즉, 다음 순서만 반복하면 됩니다.

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready"
git add .
git commit -m "Update frontend"
git push origin main
```

그러면 잠시 후 Pages에 새 버전이 반영됩니다.

## 10. 자주 생기는 문제

### 1) 페이지는 열리는데 생성 버튼이 실패함

가능성:
- Worker 주소 오타
- CORS 설정 불일치
- Gemini API 키 문제

### 2) `허용되지 않은 도메인입니다`가 뜸

가능성:
- Worker의 `ALLOWED_ORIGIN` 값이 실제 GitHub Pages 도메인과 다름

### 3) GitHub Pages 주소가 안 뜸

가능성:
- `Settings > Pages`에서 branch 저장을 안 했음
- `index.html`이 루트에 없음
