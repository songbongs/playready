from __future__ import annotations

import re

import fitz


PRIVATE_USE_RE = re.compile(r"[\uE000-\uF8FF\uFFF0-\uFFFF]")
CONTROL_RE = re.compile(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]")
MULTISPACE_RE = re.compile(r"[ \t]{2,}")

REPLACEMENTS = {
    "\u00A0": " ",
    "\u2000": " ",
    "\u2001": " ",
    "\u2002": " ",
    "\u2003": " ",
    "\u2004": " ",
    "\u2005": " ",
    "\u2006": " ",
    "\u2007": " ",
    "\u2008": " ",
    "\u2009": " ",
    "\u200A": " ",
    "\u200B": "",
    "\u200C": "",
    "\u200D": "",
    "\u2060": "",
    "\uFEFF": "",
    "\uFFFD": "",
    "ﬁ": "fi",
    "ﬂ": "fl",
}


def clean_text(value: str) -> str:
    cleaned = str(value or "")
    for source, target in REPLACEMENTS.items():
        cleaned = cleaned.replace(source, target)
    cleaned = PRIVATE_USE_RE.sub("", cleaned)
    cleaned = CONTROL_RE.sub("", cleaned)
    cleaned = MULTISPACE_RE.sub(" ", cleaned)
    return cleaned.strip()


def extract_text_blocks(document: fitz.Document) -> list[dict]:
    text_blocks: list[dict] = []
    for page_index in range(document.page_count):
        try:
            page = document.load_page(page_index)
            blocks = page.get_text("dict").get("blocks", [])
        except Exception:
            continue

        for block_index, block in enumerate(blocks):
            if "lines" not in block:
                continue

            lines: list[str] = []
            for line in block["lines"]:
                spans = [clean_text(span.get("text", "")) for span in line.get("spans", [])]
                content = " ".join([item for item in spans if item])
                content = clean_text(content)
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
