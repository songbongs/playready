from __future__ import annotations

import base64
import binascii
import json

import fitz
from fastapi import FastAPI, HTTPException

from .cleanup import delete_temp_file, write_temp_pdf
from .extract_images import extract_images
from .extract_text import extract_text_blocks
from .gemini_client import GeminiConfigurationError, generate_with_retry
from .layout_matcher import link_images_to_text
from .schemas import ExtractRequest, ExtractResponse, GenerateJsonRequest, GenerateJsonResponse

app = FastAPI(title="playready-pdf-extractor")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "playready-pdf-extractor"}


@app.post("/extract", response_model=ExtractResponse)
def extract(request: ExtractRequest) -> ExtractResponse:
    temp_path: str | None = None
    document: fitz.Document | None = None
    pdf_bytes: bytes | None = None

    try:
        raw_base64 = request.pdfBase64.split(",", 1)[-1]
        pdf_bytes = base64.b64decode(raw_base64, validate=True)

        try:
            document = fitz.open(stream=pdf_bytes, filetype="pdf")
        except Exception:
            temp_path = write_temp_pdf(pdf_bytes)
            document = fitz.open(temp_path)

        if document.needs_pass and not document.authenticate(""):
            raise ValueError("password-protected pdf")

        if document.page_count == 0:
            raise ValueError("empty extraction result")

        try:
            text_blocks = extract_text_blocks(document)
        except Exception:
            text_blocks = []

        try:
            images = extract_images(document)
        except Exception:
            images = []

        try:
            linked_images = link_images_to_text(images, text_blocks)
        except Exception:
            linked_images = images

        if not text_blocks and not linked_images:
            # The PDF was opened successfully, so keep processing with page metadata
            # instead of failing the whole request for a partial extractor issue.
            linked_images = []
            text_blocks = []

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
    except (binascii.Error, ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=400,
            detail="PDF 파일을 읽을 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="PDF 분석 중 예기치 않은 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        ) from exc
    finally:
        if document is not None:
            document.close()
        delete_temp_file(temp_path)


@app.post("/generate-json", response_model=GenerateJsonResponse)
def generate_json(request: GenerateJsonRequest) -> GenerateJsonResponse:
    try:
        generated = generate_with_retry(request.model, request.payload)
        return GenerateJsonResponse(
            result=generated["result"],
            modelInfo=generated["modelInfo"],
        )
    except GeminiConfigurationError as exc:
        raise HTTPException(
            status_code=500,
            detail="Render 서버에 Gemini API 키가 설정되지 않았습니다.",
        ) from exc
    except RuntimeError as exc:
        try:
            parsed = json.loads(str(exc))
        except json.JSONDecodeError:
            parsed = {"status": 502, "message": str(exc)}

        raise HTTPException(
            status_code=int(parsed.get("status", 502)),
            detail=str(parsed.get("message", "Gemini request failed")),
        ) from exc
