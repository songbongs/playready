from __future__ import annotations

import base64

import fitz
from fastapi import FastAPI, HTTPException

from .cleanup import delete_temp_file, write_temp_pdf
from .extract_images import extract_images
from .extract_text import extract_text_blocks
from .layout_matcher import link_images_to_text
from .schemas import ExtractRequest, ExtractResponse

app = FastAPI(title="playready-pdf-extractor")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "playready-pdf-extractor"}


@app.post("/extract", response_model=ExtractResponse)
def extract(request: ExtractRequest) -> ExtractResponse:
    temp_path: str | None = None
    document: fitz.Document | None = None
    try:
        raw_base64 = request.pdfBase64.split(",", 1)[-1]
        pdf_bytes = base64.b64decode(raw_base64)
        temp_path = write_temp_pdf(pdf_bytes)

        document = fitz.open(temp_path)
        text_blocks = extract_text_blocks(document)
        images = extract_images(document)
        linked_images = link_images_to_text(images, text_blocks)

        return ExtractResponse(
            gameName=request.gameName,
            pageCount=document.page_count,
            textBlocks=[
                {
                    "id": block["id"],
                    "page": block["page"],
                    "heading": block["heading"],
                    "text": block["text"],
                }
                for block in text_blocks
            ],
            images=linked_images,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="PDF 파일을 읽을 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.",
        ) from exc
    finally:
        if document is not None:
            document.close()
        delete_temp_file(temp_path)
