from __future__ import annotations

import os
import tempfile


def delete_temp_file(path: str | None) -> None:
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        return


def write_temp_pdf(pdf_bytes: bytes) -> str:
    fd, path = tempfile.mkstemp(suffix=".pdf")
    with os.fdopen(fd, "wb") as handle:
        handle.write(pdf_bytes)
    return path
