import { collectBggForumData } from "../bgg/bggApi.js";
import { createUserError } from "../security/inputValidator.js";
import { generateWithRetry } from "../ai/geminiClient.js";
import { buildGeminiPayload, parseGeminiJsonResponse } from "./promptBuilder.js";
import { injectImagesIntoHtml } from "./imagePlacement.js";

async function fetchPdfExtraction(payload, config) {
  if (!config.pdfExtractorUrl) {
    throw createUserError("PDF 추출 서비스 주소가 설정되지 않았습니다.", 500, "MISSING_PDF_SERVICE");
  }

  let response;
  try {
    response = await fetch(config.pdfExtractorUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw createUserError(
      "PDF 파일을 읽을 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.",
      502,
      "PDF_SERVICE_UNAVAILABLE"
    );
  }

  if (!response.ok) {
    throw createUserError(
      "PDF 파일을 읽을 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.",
      400,
      "PDF_PARSE_FAILED"
    );
  }

  return response.json();
}

function cleanupSensitiveData(state) {
  state.request.pdfBase64 = "";
  state.pdfExtraction = null;
  state.bggForumData = null;
}

export async function runGenerationPipeline(state, env, config, onProgress = async () => {}) {
  const startedAt = Date.now();
  const assertTime = () => {
    if (Date.now() - startedAt > config.processingTimeoutMs) {
      throw createUserError("처리 시간이 초과되었습니다. PDF 크기나 내용을 줄여 다시 시도해주세요.", 504, "TIMEOUT");
    }
  };

  try {
    await onProgress("BGG 포럼 데이터를 수집하고 있습니다... (1/3)", { stage: "bgg" });
    state.bggForumData = await collectBggForumData(state.request.bggId, config, onProgress);
    assertTime();

    await onProgress("PDF를 분석하고 있습니다... (2/3)", { stage: "pdf" });
    state.pdfExtraction = await fetchPdfExtraction(
      {
        gameName: state.request.gameName,
        pdfBase64: state.request.pdfBase64,
        pdfFileName: state.request.pdfFileName
      },
      config
    );
    assertTime();

    await onProgress("한국어 문서를 생성하고 있습니다... (3/3)", { stage: "ai" });
    const geminiPayload = buildGeminiPayload({
      gameName: state.request.gameName,
      bggId: state.request.bggId,
      pdfExtraction: state.pdfExtraction,
      bggForumData: state.bggForumData
    });
    const geminiResult = await generateWithRetry(env, config, geminiPayload);
    const parsed = parseGeminiJsonResponse(geminiResult);

    const images = state.pdfExtraction?.images || [];
    const documentAHtml = injectImagesIntoHtml(parsed.documentAHtml || "", images);
    const documentBHtml = injectImagesIntoHtml(parsed.documentBHtml || "", images);

    return {
      ok: true,
      data: {
        gameName: state.request.gameName,
        bggId: state.request.bggId,
        glossary: parsed.glossary || [],
        documentAHtml,
        documentBHtml,
        meta: {
          generatedAt: new Date().toISOString(),
          imageCount: images.length,
          forumCount: state.bggForumData?.forums?.length || 0
        }
      }
    };
  } finally {
    cleanupSensitiveData(state);
  }
}
