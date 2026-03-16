from __future__ import annotations

import base64
from typing import Any

import fitz


def extract_images(document: fitz.Document) -> list[dict[str, Any]]:
    extracted: list[dict[str, Any]] = []

    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        image_infos = page.get_image_info(xrefs=True)

        for image_index, info in enumerate(image_infos):
            xref = info.get("xref")
            if not xref:
                continue

            image = document.extract_image(xref)
            image_bytes = image.get("image", b"")
            ext = image.get("ext", "png").lower()
            mime_type = f"image/{'jpeg' if ext == 'jpg' else ext}"
            bbox = info.get("bbox", (0, 0, 0, 0))

            extracted.append(
                {
                    "id": f"page-{page_index + 1}-image-{image_index + 1}",
                    "page": page_index + 1,
                    "bbox": {
                        "x0": float(bbox[0]),
                        "y0": float(bbox[1]),
                        "x1": float(bbox[2]),
                        "y1": float(bbox[3]),
                    },
                    "mimeType": mime_type,
                    "base64": base64.b64encode(image_bytes).decode("utf-8"),
                }
            )

    return extracted
