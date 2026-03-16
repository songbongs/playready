# playready Cloudflare Worker

Cloudflare Worker orchestration layer for:

- request validation
- BGG forum/FAQ/Q&A collection
- PDF extraction service calls
- Gemini document generation
- progress streaming to the frontend

Secrets are never committed. Configure them with `wrangler secret put`.
