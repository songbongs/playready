from __future__ import annotations

import base64
from typing import Any

import fitz

MAX_TOTAL_IMAGES = 24
MAX_IMAGES_PER_PAGE = 6
MAX_RENDER_EDGE = 900


def _bbox_to_dict(rect: fitz.Rect) -> dict[str, float]:
    return {
        "x0": float(rect.x0),
        "y0": float(rect.y0),
        "x1": float(rect.x1),
        "y1": float(rect.y1),
    }


def _pick_scale(area_ratio: float) -> float:
    if area_ratio <= 0.01:
        return 2.0
    if area_ratio <= 0.05:
        return 1.6
    return 1.2


def _fit_pixmap(pixmap: fitz.Pixmap) -> fitz.Pixmap:
    if max(pixmap.width, pixmap.height) <= MAX_RENDER_EDGE:
        return pixmap

    scale = MAX_RENDER_EDGE / max(pixmap.width, pixmap.height)
    target_width = max(1, int(pixmap.width * scale))
    target_height = max(1, int(pixmap.height * scale))
    return fitz.Pixmap(pixmap, target_width, target_height)


def _render_clipped_image(page: fitz.Page, rect: fitz.Rect, area_ratio: float) -> tuple[bytes, str, int, int]:
    matrix = fitz.Matrix(_pick_scale(area_ratio), _pick_scale(area_ratio))
    pixmap = page.get_pixmap(clip=rect, matrix=matrix, alpha=False, annots=False)
    fitted = _fit_pixmap(pixmap)
    return fitted.tobytes("png"), "image/png", fitted.width, fitted.height


def extract_images(document: fitz.Document) -> list[dict[str, Any]]:
    extracted: list[dict[str, Any]] = []
    seen: set[tuple[int, int, int, int, int]] = set()

    for page_index in range(document.page_count):
        if len(extracted) >= MAX_TOTAL_IMAGES:
            break

        try:
            page = document.load_page(page_index)
            image_infos = page.get_image_info(xrefs=True)
        except Exception:
            continue

        page_image_count = 0
        for image_index, info in enumerate(image_infos):
            if len(extracted) >= MAX_TOTAL_IMAGES or page_image_count >= MAX_IMAGES_PER_PAGE:
                break

            xref = info.get("xref")
            if not xref:
                continue

            bbox = fitz.Rect(info.get("bbox", (0, 0, 0, 0)))
            if bbox.width < 4 or bbox.height < 4:
                continue

            dedupe_key = (
                page_index,
                xref,
                round(bbox.x0),
                round(bbox.y0),
                round(bbox.x1 + bbox.y1),
            )
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            page_area = max(page.rect.get_area(), 1.0)
            area_ratio = max(bbox.get_area(), 1.0) / page_area

            try:
                image_bytes, mime_type, pixel_width, pixel_height = _render_clipped_image(
                    page, bbox, area_ratio
                )
                render_mode = "clip"
            except Exception:
                try:
                    image = document.extract_image(xref)
                    image_bytes = image.get("image", b"")
                    ext = image.get("ext", "png").lower()
                    mime_type = f"image/{'jpeg' if ext == 'jpg' else ext}"
                    pixel_width = int(image.get("width") or bbox.width)
                    pixel_height = int(image.get("height") or bbox.height)
                    render_mode = "raw"
                except Exception:
                    continue

            if not image_bytes:
                continue

            extracted.append(
                {
                    "id": f"page-{page_index + 1}-image-{image_index + 1}",
                    "page": page_index + 1,
                    "bbox": _bbox_to_dict(bbox),
                    "mimeType": mime_type,
                    "base64": base64.b64encode(image_bytes).decode("utf-8"),
                    "width": float(bbox.width),
                    "height": float(bbox.height),
                    "pixelWidth": pixel_width,
                    "pixelHeight": pixel_height,
                    "areaRatio": round(area_ratio, 6),
                    "renderMode": render_mode,
                }
            )
            page_image_count += 1

    return extracted
