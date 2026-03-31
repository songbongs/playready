# playready

보드게임 룰북 PDF를 바탕으로 학습용/설명용 문서 A, 문서 B를 자동 생성하는 프로젝트입니다.

이 프로젝트는 단순히 PDF만 읽는 구조가 아니라, 아래 자료를 함께 조합해 결과를 만듭니다.

- 사용자가 입력한 게임 제목
- BGG ID
- 룰북 PDF
- FAQ / 정오표 PDF
- 추가 자료
- BGG 기본 정보
- BGG 대표 포럼 / 대표 스레드 / 대표 댓글

쉽게 말하면:

- `index.html`은 사용자가 보는 화면
- `worker/`는 작업을 접수하고 상태를 관리하는 서버
- `pdf-processor/`는 PDF를 실제로 읽는 Python 서비스

입니다.

---

## 1. 현재 구조 한눈에 보기

현재 구조는 아래처럼 나뉩니다.

- `index.html`
  - GitHub Pages에 올리는 사용자 화면
  - 작업 시작, 진행상황 확인, 최근 작업 다시 열기
  - 문서 결과 미리보기

- `worker/`
  - Cloudflare Worker 백엔드
  - 작업 접수 API
  - 작업 상태 조회 API
  - 작업 중단 요청 API
  - Queue 소비자(백그라운드 처리)

- `pdf-processor/`
  - Python / FastAPI 기반 PDF 처리 서비스
  - PDF 텍스트, 이미지, 페이지 정보를 추출
  - Worker가 직접 PDF를 읽지 못하기 때문에 별도로 필요

- `docs/`
  - 배포 가이드
  - 체크리스트
  - 롤백 기준본

---

## 2. 현재 핵심 기능

### 2-1. 백그라운드 작업

문서 생성은 즉시 끝나는 작업이 아니라 `백그라운드 job`으로 처리됩니다.

흐름은 아래와 같습니다.

1. 사용자가 작업 시작
2. Worker가 `jobId` 발급
3. Queue에 작업 등록
4. 서버가 뒤에서 계속 처리
5. 사용자는 진행상황 화면 또는 최근 작업 목록으로 다시 확인

중요:

- 휴대폰에서 앱/브라우저 화면을 빠져나가도
- 노트북 화면이 잠금 상태가 되어도
- 브라우저 탭을 닫아도

이미 서버에 접수된 job은 계속 진행됩니다.

비유:

- 브라우저는 `작업 상황을 보여주는 창`
- 실제 일은 `서버`가 하고 있는 구조입니다

---

### 2-2. 실제 중단 요청 버튼

이제 진행 화면의 버튼은 단순히 화면만 나가는 버튼이 아닙니다.

현재는:

- 진행 중일 때 버튼: `작업 중단 요청`
- 중단 요청 후 버튼: `중단 요청 중...`
- 중단된 뒤 버튼: `다시 작업 준비`

중단 방식은 아래처럼 동작합니다.

- 사용자가 버튼 클릭
- 서버에 `cancel` 요청 전송
- 현재 처리 중이던 묶음을 안전하게 마무리
- 가능한 가장 빠른 지점에서 `cancelled` 상태로 종료

중요:

- 이 버튼은 `즉시 전원 차단식 강제 종료`는 아닙니다
- `안전한 지점에서 멈추는 중단 요청`입니다

예:

- BGG 요청 1개를 보내고 응답을 기다리는 중이면
- 그 요청 하나는 끝날 수 있습니다
- 하지만 그 다음 루프 / 다음 단계로 넘어가기 전 멈춥니다

---

### 2-3. BGG 수집 제한

예전에는 BGG 포럼을 너무 많이 읽어서 시간이 길어질 수 있었습니다.

현재는 기본적으로 아래 범위만 읽습니다.

- 대표 forum: 6개
- forum당 대표 thread: 6개
- thread당 대표 comment: 6개

그리고 전체 BGG 단계는 별도 시간 제한이 있습니다.

기본값:

- `BGG_COLLECTION_TIMEOUT_MS = 90000`

즉:

- BGG를 너무 오래 읽지 않음
- 시간이 오래 걸리면 대표 정보만 사용
- 그 다음 PDF 단계로 넘어감

이 제한은 `최신순만`이 아니라 아래를 섞어서 대표 항목을 고릅니다.

- 최근성
- 반응 수
- 규칙 / FAQ / 공식 답변 가능성

쉽게 말하면:

- 최신 글만 다 읽는 것도 아니고
- 댓글 많은 글만 다 읽는 것도 아니고
- `최근이면서, 실제로 참고 가치가 큰 자료` 위주로 추립니다

---

### 2-4. BGG 단계 세분화

사용자는 이제 BGG 단계가 그냥 `멈춘 것처럼` 보이지 않도록 더 잘게 상태를 보게 됩니다.

예시:

- BGG 기본 정보를 읽고 있습니다
- BGG 포럼 목록을 정리하고 있습니다
- 대표 포럼 2/6을 읽고 있습니다
- 스레드 4/6을 읽고 있습니다
- 대표 자료만 사용하고 다음 단계로 넘어갑니다

즉 사용자는 지금 실제로 어디서 시간이 쓰이고 있는지 훨씬 쉽게 이해할 수 있습니다.

---

### 2-5. watchdog 자동 정리

너무 오래 멈춰 있는 job을 시스템이 자동으로 정리합니다.

현재 기본값:

- 전체 처리 최대 시간: 12분
- heartbeat 정지 허용 시간: 4분

쉽게 말하면:

- 작업이 너무 오래 끌리거나
- 진행 업데이트가 너무 오래 멈추면

시스템이 자동으로 실패 처리해서 `무한정 매달려 있는 상태`를 줄입니다.

---

## 3. 현재 사용자 화면에서 보이는 변화

현재 화면 기준으로 사용자는 아래를 볼 수 있습니다.

- 최근 작업 목록
- 진행 중 / 완료 / 실패 / 중단 요청 / 중단됨 상태
- 작업 단계별 진행 메시지
- 결과 문서 A / 문서 B 미리보기
- 사용한 룰북 파일명 / FAQ 파일명 / 추가 자료 파일명
- 사용된 모델과 단계별 소요 시간

중요:

- 화면에 파일명이 보인다고 해서
- 반드시 그 PDF 내용이 충분히 읽혔다는 뜻은 아닙니다

왜냐하면:

- 파일명은 업로드 기록으로 표시될 수 있고
- 실제 본문 활용량은 PDF 추출 결과에 따라 달라질 수 있기 때문입니다

---

## 4. 현재 백엔드 구성

현재 서비스 구성은 아래와 같습니다.

- `GitHub Pages`
  - 사용자 화면

- `Cloudflare Worker`
  - 작업 접수 / 조회 / 결과 조회 / 중단 요청

- `Cloudflare Queue`
  - 백그라운드 작업 대기열

- `Cloudflare D1`
  - job 상태 저장

- `Cloudflare R2`
  - 작업 입력 임시 저장
  - 작업 결과 저장

- `Render` 또는 다른 Python 호스팅
  - PDF 추출 서비스

중요:

- 원본 PDF는 장기 보관이 목적이 아닙니다
- 작업 중 임시 저장될 수는 있지만
- 작업 처리 후 입력 원본은 삭제하고
- 결과와 파일명 위주 메타를 남기는 구조입니다

---

## 5. Secret 키

현재 Worker에서 사용하는 secret은 2개입니다.

| 이름 | 용도 | 등록 명령 |
|---|---|---|
| `GEMINI_API_KEY` | Gemini 문서 생성 | `npx wrangler secret put GEMINI_API_KEY` |
| `BGG_API_KEY` | BGG 기본 정보 / 포럼 수집 | `npx wrangler secret put BGG_API_KEY` |

중요:

- secret은 `wrangler.toml`에 적지 않습니다
- 코드에 직접 적지 않습니다
- `wrangler secret put` 명령으로 Cloudflare에만 저장합니다
- 대시보드에서는 값 자체가 다시 보이지 않을 수 있습니다

---

## 6. 현재 기본 설정값

현재 `worker/wrangler.toml` 기준 주요 값은 아래와 같습니다.

```toml
ALLOWED_ORIGIN = "https://songbongs.github.io"
BGG_API_BASE = "https://boardgamegeek.com/xmlapi2"
GEMINI_MODEL = "gemini-2.5-pro"
PDF_EXTRACTOR_URL = "https://playready.onrender.com/extract"

PROCESSING_TIMEOUT_MS = "600000"
JOB_MAX_PROCESSING_MS = "720000"
JOB_HEARTBEAT_TIMEOUT_MS = "240000"

BGG_DELAY_MS = "1200"
BGG_REQUEST_TIMEOUT_MS = "15000"
BGG_COLLECTION_TIMEOUT_MS = "90000"
BGG_MAX_FORUMS = "6"
BGG_MAX_THREADS_PER_FORUM = "6"
BGG_MAX_COMMENTS_PER_THREAD = "6"

ENABLE_FACT_PRESERVING_SUMMARY = "true"
ENABLE_STAGE_INPUT_SLICING = "true"
OPTIMIZATION_ROLLOUT_MODE = "safe_only"
```

뜻을 쉽게 풀면:

- BGG 요청 하나가 너무 오래 끌리면 오래 기다리지 않음
- 포럼도 대표 샘플만 읽음
- job이 너무 오래 멈춰 있으면 자동 정리
- 최적화 기능은 무조건 전체 ON이 아니라 `안전한 케이스에만 제한 적용`

---

## 7. 최적화 모드

현재 Worker는 최적화 2종을 가지고 있습니다.

- 사실 보존형 요약본
- 단계별 입력 슬라이싱

운영 모드는 `OPTIMIZATION_ROLLOUT_MODE`로 제어합니다.

### `off`

- 새 최적화 사용 안 함
- 전부 기존 방식

### `safe_only`

- 안전한 케이스에만 제한 적용
- 현재 권장 기본값

### `on`

- 모든 작업에 새 최적화 적용

초보자 운영 추천 순서:

1. 처음에는 `safe_only`
2. 결과 품질 확인
3. 충분히 안정적이면 `on`
4. 이상하면 바로 `off`

---

## 8. 결과물 메타에 남는 정보

현재 결과 메타에는 아래 같은 정보가 남을 수 있습니다.

- 사용한 룰북 파일명
- 사용한 FAQ 파일명
- 추가 자료 파일명 목록
- 최적화 적용 여부
- 왜 최적화에서 제외되었는지 이유
- 사용 모델
- 단계별 시간

즉 나중에 문제가 생겼을 때,

- 어떤 파일로 만들었는지
- 어떤 모드로 처리됐는지
- 기존 방식이었는지, 제한적 최적화였는지

를 추적하기 쉽게 설계되어 있습니다.

---

## 9. 로컬 검증 명령

Worker 코드 점검:

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready\worker"
npm test
npm run check
```

현재 `npm test`는 아래를 확인합니다.

- BGG 대표 forum / thread / comment 제한 수집
- BGG 시간 초과 시 부분 결과 반환

테스트 파일 위치:

- `worker/tests/run-tests.mjs`

---

## 10. 배포 방법

### 10-1. Worker 배포

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready\worker"
npm test
npm run check
npx wrangler deploy
```

### 10-2. secret 재등록이 필요할 때만

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready\worker"
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put BGG_API_KEY
npx wrangler deploy
```

### 10-3. GitHub Pages 반영

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready"
git add .
git commit -m "Update README and deploy latest playready changes"
git push origin main
```

중요:

- Worker는 `서버 기능` 반영
- GitHub Pages는 `화면 변경` 반영

이번 프로젝트는 보통 둘 다 해야 전체 수정이 보입니다.

---

## 11. 배포 후 확인할 것

### Worker health 확인

예시:

```text
https://playready-worker.iamsangmin.workers.dev/api/health
```

### 실제 화면 확인

예시:

```text
https://songbongs.github.io/playready/
```

### 꼭 확인할 동작

1. 작업 시작이 되는지
2. 최근 작업이 보이는지
3. BGG 단계가 세분화되어 보이는지
4. `작업 중단 요청` 버튼이 보이는지
5. 버튼 클릭 후 `중단 요청 중...` 으로 바뀌는지
6. 잠시 후 `중단됨`으로 정리되는지
7. 브라우저를 나갔다가 다시 들어와도 최근 작업에서 이어 확인 가능한지

---

## 12. 자주 헷갈리는 부분

### Q. `작업 중단 요청`은 즉시 kill인가요?

아니요.

- 완전 즉시 강제 종료가 아니라
- 현재 작업 묶음을 안전하게 마친 뒤
- 가능한 가장 빠른 지점에서 멈춥니다

### Q. 휴대폰 화면을 나가면 작업이 멈추나요?

아니요.

이미 서버에 접수된 뒤라면 계속 진행됩니다.

### Q. 파일명이 결과에 보이면 PDF 본문도 꼭 제대로 읽힌 건가요?

그건 아닙니다.

- 파일명은 업로드 기록
- 실제 본문 활용은 PDF 추출 결과

라서 서로 완전히 같은 의미는 아닙니다.

---

## 13. 롤백 기준본

최적화 적용 전 기준본은 아래 폴더에 있습니다.

- `docs/rollback-baseline/promptBuilder.pre-optimization.js`
- `docs/rollback-baseline/generationPipeline.pre-optimization.js`
- `docs/rollback-baseline/bggApi.pre-optimization.js`
- `docs/rollback-baseline/constants.pre-optimization.js`

즉, 품질 이슈가 생기면

- 최적화만 끄거나
- 기준본으로 되돌리는 판단

을 할 수 있도록 준비되어 있습니다.
