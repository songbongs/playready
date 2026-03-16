from __future__ import annotations


def link_images_to_text(images: list[dict], text_blocks: list[dict]) -> list[dict]:
    for image in images:
        same_page_blocks = [block for block in text_blocks if block["page"] == image["page"]]
        if not same_page_blocks:
            image["nearestTextBlockId"] = None
            continue

        image_y = image["bbox"]["y0"]
        sorted_blocks = sorted(
            same_page_blocks,
            key=lambda block: abs(image_y - float(block["bbox"][1]))
        )
        image["nearestTextBlockId"] = sorted_blocks[0]["id"]

    return images
