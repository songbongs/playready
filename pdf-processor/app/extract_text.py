from __future__ import annotations

import fitz


def extract_text_blocks(document: fitz.Document) -> list[dict]:
    text_blocks: list[dict] = []
    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        blocks = page.get_text("dict").get("blocks", [])
        for block_index, block in enumerate(blocks):
            if "lines" not in block:
                continue

            lines: list[str] = []
            for line in block["lines"]:
                spans = [span.get("text", "").strip() for span in line.get("spans", [])]
                content = " ".join([item for item in spans if item])
                if content:
                    lines.append(content)

            if not lines:
                continue

            block_id = f"page-{page_index + 1}-text-{block_index + 1}"
            text = "\n".join(lines)
            heading = lines[0] if len(lines[0]) <= 80 else None
            text_blocks.append(
                {
                    "id": block_id,
                    "page": page_index + 1,
                    "heading": heading,
                    "text": text,
                    "bbox": block.get("bbox", [0, 0, 0, 0]),
                }
            )

    return text_blocks
