# playready 배포 체크리스트

- GitHub Pages 주소를 확인하고 `ALLOWED_ORIGIN` 값에 정확히 입력했는지 확인
- `GEMINI_API_KEY`를 `wrangler secret`으로 등록했는지 확인
- `PDF_EXTRACTOR_URL`가 실제 동작 중인 Python 서비스 주소인지 확인
- `RATE_LIMIT_KV` 네임스페이스를 만들고 `wrangler.toml`에 id를 넣었는지 확인
- PDF 업로드 크기 50MB 제한과 오류 메시지를 테스트했는지 확인
- BGG 요청이 최소 2초 간격으로 나가는지 확인
