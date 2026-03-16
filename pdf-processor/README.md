# playready PDF extractor

This service runs outside Cloudflare Workers because PyMuPDF cannot execute inside the Worker runtime.

It accepts a base64 PDF payload and returns:

- section-preserving text blocks
- images with page number and coordinates
- base64 encoded image payloads for later HTML injection
