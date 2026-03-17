from typing import Any

from pydantic import BaseModel, Field


class ExtractRequest(BaseModel):
    gameName: str = Field(min_length=1)
    pdfBase64: str = Field(min_length=1)
    pdfFileName: str = Field(default="rulebook.pdf")


class BoundingBox(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class TextBlock(BaseModel):
    id: str
    page: int
    heading: str | None = None
    text: str


class ExtractedImage(BaseModel):
    id: str
    page: int
    bbox: BoundingBox
    mimeType: str
    base64: str
    nearestTextBlockId: str | None = None
    width: float | None = None
    height: float | None = None
    pixelWidth: int | None = None
    pixelHeight: int | None = None
    areaRatio: float | None = None
    renderMode: str | None = None


class ExtractResponse(BaseModel):
    ok: bool = True
    gameName: str
    pageCount: int
    textBlocks: list[TextBlock]
    images: list[ExtractedImage]


class GenerateJsonRequest(BaseModel):
    model: str = Field(min_length=1)
    payload: dict[str, Any]


class GenerateJsonResponse(BaseModel):
    ok: bool = True
    result: dict[str, Any]
