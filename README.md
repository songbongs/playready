# playready

보드게임 룰북 학습용/설명용 문서 생성기입니다.

현재 구성:

- `index.html`: 사용자 화면
- `worker/`: Cloudflare Worker 백엔드
- `pdf-processor/`: Render 등에 올려서 쓰는 Python PDF/AI 처리 서비스
- `docs/`: 배포 문서와 롤백 기준본

## 이번 버전 핵심 변경

이번 버전부터 문서 생성 최적화 2종이 들어갔습니다.

1. `사실 보존형 요약본`
2. `단계별 입력 슬라이싱`

중요:

- 이 두 기능은 일반 사용자 화면에서 버튼으로 켜고 끄는 방식이 아닙니다.
- 운영자가 Cloudflare Worker 설정값으로 제어합니다.
- 기본 배포 상태는 `전체 ON`이 아니라 `안전한 케이스에만 제한적 ON`입니다.

즉, 처음부터 모든 작업에 새 방식을 강제로 적용하지 않습니다.

## 안전한 케이스에만 제한적 ON이란?

아주 쉽게 말하면:

- 비교적 단순한 작업은 새 최적화 사용
- 조금이라도 복잡하거나 위험한 작업은 기존 방식 유지

현재 코드에서 제한적 ON 대상은 아래 조건을 모두 만족하는 경우입니다.

- 룰북 PDF가 있음
- FAQ/정오표 PDF가 없음
- 추가 자료가 없음
- 룰북 PDF 용량이 안전 기준 이하
- PDF 페이지 수가 안전 기준 이하
- PDF 텍스트 블록 수가 안전 기준 이하
- BGG 포럼 스레드 수가 안전 기준 이하

하나라도 벗어나면 자동으로 기존 방식으로 돌아갑니다.

## 사용자 입장에서 보이는 변화

일반 사용자는 화면에서 ON/OFF 버튼을 보지 않습니다.

사용자 경험은 여전히 아래와 같습니다.

1. 파일 업로드
2. 문서 생성 시작
3. 진행 상태 확인
4. 결과 확인

차이는 내부 처리 방식만 달라질 수 있다는 점입니다.

- 안전한 작업: 최적화가 제한적으로 적용될 수 있음
- 복잡한 작업: 자동으로 기존 방식 유지

결과 화면에서는 이번 작업에 사용된 파일 이름이 함께 표시됩니다.

- 룰북 파일명
- FAQ 파일명
- 추가 자료 파일명

원본 PDF 자체를 장기 저장하지 않더라도, 어떤 파일로 작업했는지는 확인할 수 있도록 했습니다.

## 운영 모드 3가지

Worker 환경변수 `OPTIMIZATION_ROLLOUT_MODE` 값으로 운영 모드를 정합니다.

### 1. `off`

의미:

- 새 최적화 2종을 전부 끔
- 모든 작업을 기존 방식으로만 처리

추천 상황:

- 품질 이슈가 감지되었을 때
- 비교 테스트 전
- 급하게 안정성을 최우선으로 둘 때

### 2. `safe_only`

의미:

- 안전한 케이스에만 제한적으로 새 최적화 사용
- 나머지는 기존 방식 유지

현재 권장 기본값:

- 이 프로젝트는 처음 배포할 때 이 모드로 두는 것이 가장 안전합니다.

### 3. `on`

의미:

- 새 최적화 2종을 모든 작업에 적용

추천 상황:

- 충분한 품질 검증이 끝난 뒤
- 내부 비교 결과가 안정적일 때

## 각 기능을 개별로 켜고 끄는 값

아래 두 환경변수로 기능별 제어가 가능합니다.

- `ENABLE_FACT_PRESERVING_SUMMARY`
- `ENABLE_STAGE_INPUT_SLICING`

예시:

- 둘 다 `true`: 두 기능 모두 사용 가능
- 하나만 `false`: 해당 기능만 비활성화

주의:

- `OPTIMIZATION_ROLLOUT_MODE=off`이면 위 두 값이 `true`여도 실제로는 전체 OFF처럼 동작합니다.

## 현재 기본 설정값

`worker/wrangler.toml` 기준 기본값:

```toml
ENABLE_FACT_PRESERVING_SUMMARY = "true"
ENABLE_STAGE_INPUT_SLICING = "true"
OPTIMIZATION_ROLLOUT_MODE = "safe_only"
OPTIMIZATION_SAFE_PDF_BYTES = "12582912"
OPTIMIZATION_SAFE_MAX_ADDITIONAL_MATERIALS = "0"
OPTIMIZATION_SAFE_MAX_FORUM_THREADS = "12"
OPTIMIZATION_SAFE_MAX_TEXT_BLOCKS = "260"
OPTIMIZATION_SAFE_MAX_PAGES = "80"
```

뜻을 쉽게 풀면:

- 12MB 이하 정도의 비교적 가벼운 룰북
- 추가 자료 없음
- 포럼 스레드 너무 많지 않음
- PDF가 너무 길거나 복잡하지 않음

이런 경우만 처음부터 제한적으로 새 최적화가 적용됩니다.

## 전체 OFF 하는 방법

품질 이슈가 보이면 가장 먼저 이 방법을 쓰면 됩니다.

### 방법 A. Cloudflare 대시보드에서 변경

1. Cloudflare 로그인
2. `Workers & Pages` 클릭
3. `playready-worker` 선택
4. `Settings` 또는 `Variables` 열기
5. `OPTIMIZATION_ROLLOUT_MODE` 값을 `off`로 변경
6. 저장

이후 새 작업부터는 전부 기존 방식으로 처리됩니다.

### 방법 B. 코드 설정에서 변경 후 재배포

`worker/wrangler.toml`에서 아래 값을 바꿉니다.

```toml
OPTIMIZATION_ROLLOUT_MODE = "off"
```

그 다음 Worker를 다시 배포합니다.

## 제한적 ON으로 운영하는 방법

이 모드가 현재 권장 기본 운영값입니다.

### Cloudflare 대시보드에서 변경

1. Cloudflare 로그인
2. `Workers & Pages`
3. `playready-worker`
4. `Variables`
5. 아래 값 확인 또는 수정

```text
ENABLE_FACT_PRESERVING_SUMMARY = true
ENABLE_STAGE_INPUT_SLICING = true
OPTIMIZATION_ROLLOUT_MODE = safe_only
```

6. 저장

이후 시스템이 자동으로 판정합니다.

- 안전한 케이스면 새 방식 사용
- 위험하면 기존 방식 유지

## 전체 ON 하는 방법

충분한 검증 후 모든 작업에 새 최적화를 적용하고 싶을 때 사용합니다.

### Cloudflare 대시보드에서 변경

1. Cloudflare 로그인
2. `Workers & Pages`
3. `playready-worker`
4. `Variables`
5. 아래 값으로 변경

```text
ENABLE_FACT_PRESERVING_SUMMARY = true
ENABLE_STAGE_INPUT_SLICING = true
OPTIMIZATION_ROLLOUT_MODE = on
```

6. 저장

이후 새 작업부터는 전체 ON으로 동작합니다.

## 기능별 개별 OFF 예시

예를 들어 단계별 입력 슬라이싱만 끄고 싶다면:

```text
ENABLE_FACT_PRESERVING_SUMMARY = true
ENABLE_STAGE_INPUT_SLICING = false
OPTIMIZATION_ROLLOUT_MODE = safe_only
```

이 경우:

- 사실 보존형 요약본만 제한적으로 사용
- 단계별 입력 슬라이싱은 사용 안 함

## 결과물에서 확인 가능한 메타

이번 버전 결과 메타에는 아래 정보가 포함됩니다.

- 사용한 룰북 파일명
- 사용한 FAQ 파일명
- 추가 자료 파일명 목록
- 이번 작업이 안전 케이스였는지 여부
- 새 최적화가 실제 적용됐는지 여부
- 적용되지 않았다면 왜 제외됐는지 이유

즉, 나중에 품질 이슈가 생기면:

- 이 작업이 기존 방식이었는지
- 새 방식이었는지
- 왜 제한적 ON 대상에서 제외되었는지

를 추적할 수 있습니다.

## 품질 이슈 시 즉시 대응 방법

가장 쉬운 대응 순서:

1. `OPTIMIZATION_ROLLOUT_MODE = off`
2. 새 작업이 모두 기존 방식으로 돌아가는지 확인
3. 품질 이슈 재확인
4. 필요하면 코드 롤백 진행

## 코드 롤백 기준본 위치

이번 작업 전 상태를 기준본으로 별도 보존해두었습니다.

위치:

- `docs/rollback-baseline/promptBuilder.pre-optimization.js`
- `docs/rollback-baseline/generationPipeline.pre-optimization.js`
- `docs/rollback-baseline/bggApi.pre-optimization.js`
- `docs/rollback-baseline/constants.pre-optimization.js`

의미:

- 나중에 사용자가
  - `결과물 품질 이슈에 대해 이전 버전으로 롤백해줘`
  - 또는
  - `요약본/입력 슬라이싱 적용 전으로 되돌려줘`
  라고 요청할 경우,
  이 기준본을 바탕으로 되돌릴 수 있습니다.

## 로컬/배포 시 참고

Worker 배포:

```powershell
cd "C:\Users\kblife\Desktop\AI 실습\playready\worker"
npx wrangler deploy
```

PDF/AI 서비스는 별도 Render 배포가 필요합니다.

## 운영 추천 순서

비개발자 운영자 기준 추천 순서:

1. 처음에는 `safe_only`
2. 결과물 품질 확인
3. 안정적이면 `on`
4. 이상이 보이면 즉시 `off`

이 순서가 가장 안전합니다.
