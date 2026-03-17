export async function readAndValidateJsonRequest(request, config) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > config.requestMaxBytes) {
    throw createUserError("PDF 파일은 최대 50MB까지 업로드할 수 있습니다.", 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw createUserError("요청 형식을 읽을 수 없습니다. 다시 시도해주세요.", 400);
  }

  const gameName = String(body?.gameName || "").trim();
  const bggId = String(body?.bggId || "").trim();
  const pdfBase64 = String(body?.pdfBase64 || "").trim();
  const pdfFileName = String(body?.pdfFileName || "rulebook.pdf").trim();
  const pdfMimeType = String(body?.pdfMimeType || "application/pdf").trim();
  const faqPdfBase64 = String(body?.faqPdfBase64 || "").trim();
  const faqPdfFileName = String(body?.faqPdfFileName || "faq.pdf").trim();
  const faqPdfMimeType = String(body?.faqPdfMimeType || "application/pdf").trim();
  const additionalMaterials = normalizeAdditionalMaterials(body?.additionalMaterials || []);

  if (!gameName) {
    throw createUserError("게임 이름을 입력해주세요.", 400, "INVALID_GAME_NAME");
  }
  if (!bggId || !/^\d+$/.test(bggId)) {
    throw createUserError("BGG ID는 숫자로만 입력해주세요.", 400, "INVALID_BGG_ID");
  }
  if (pdfBase64 && pdfMimeType !== "application/pdf") {
    throw createUserError("룰북은 PDF 파일만 업로드할 수 있습니다.", 400, "INVALID_PDF_TYPE");
  }
  if (faqPdfBase64 && faqPdfMimeType !== "application/pdf") {
    throw createUserError("FAQ/정오표는 PDF 파일만 업로드할 수 있습니다.", 400, "INVALID_FAQ_PDF_TYPE");
  }

  const estimatedBytes = pdfBase64 ? estimateBase64Bytes(pdfBase64) : 0;
  const faqEstimatedBytes = faqPdfBase64 ? estimateBase64Bytes(faqPdfBase64) : 0;

  if (pdfBase64 && estimatedBytes > config.requestMaxBytes) {
    throw createUserError("룰북 PDF는 최대 50MB까지 업로드할 수 있습니다.", 413, "PDF_TOO_LARGE");
  }
  if (faqPdfBase64 && faqEstimatedBytes > config.requestMaxBytes) {
    throw createUserError("FAQ/정오표 PDF는 최대 50MB까지 업로드할 수 있습니다.", 413, "FAQ_PDF_TOO_LARGE");
  }

  return {
    gameName,
    bggId,
    pdfBase64,
    pdfFileName,
    pdfMimeType,
    faqPdfBase64,
    faqPdfFileName,
    faqPdfMimeType,
    estimatedBytes,
    faqEstimatedBytes,
    additionalMaterials
  };
}

function normalizeAdditionalMaterials(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      fileName: String(item?.fileName || "").trim(),
      mimeType: String(item?.mimeType || "application/octet-stream").trim(),
      textContent: String(item?.textContent || "").trim()
    }))
    .filter((item) => item.fileName)
    .slice(0, 5);
}

export function estimateBase64Bytes(value) {
  const clean = value.replace(/^data:.*;base64,/, "");
  const padding = (clean.match(/=*$/) || [""])[0].length;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export function createUserError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.isUserError = true;
  return error;
}
