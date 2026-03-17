import { collectBggForumData } from "../bgg/bggApi.js";
import { createUserError } from "../security/inputValidator.js";
import { generateWithRetry } from "../ai/geminiClient.js";
import {
  buildDocumentPayload,
  buildGlossaryPayload,
  parseGeminiJsonResponse
} from "./promptBuilder.js";
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
  state.request.additionalMaterials = [];
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
    if (state.request.pdfBase64) {
      state.pdfExtraction = await fetchPdfExtraction(
        {
          gameName: state.request.gameName,
          pdfBase64: state.request.pdfBase64,
          pdfFileName: state.request.pdfFileName
        },
        config
      );
    } else {
      await onProgress("PDF가 없어 BGG 데이터 중심으로 진행하고 있습니다... (2/3)", {
        stage: "pdf-skip"
      });
      state.pdfExtraction = {
        ok: true,
        gameName: state.request.gameName,
        pageCount: 0,
        textBlocks: [],
        images: []
      };
    }
    assertTime();

    await onProgress("한국어 문서를 생성하고 있습니다... (3/3)", { stage: "ai" });
    const payloadInput = {
      gameName: state.request.gameName,
      bggId: state.request.bggId,
      pdfExtraction: state.pdfExtraction,
      bggForumData: state.bggForumData,
      additionalMaterials: state.request.additionalMaterials
    };

    const glossary = await generateJsonSection(env, config, [
      {
        label: "용어집을 정리하고 있습니다... (3/3)",
        payload: buildGlossaryPayload(payloadInput, "full")
      },
      {
        label: "BGG를 제외하고 용어집을 다시 정리하고 있습니다... (3/3)",
        payload: buildGlossaryPayload(payloadInput, "no-bgg")
      },
      {
        label: "추가 자료까지 제외하고 용어집을 다시 정리하고 있습니다... (3/3)",
        payload: buildGlossaryPayload(payloadInput, "no-bgg-no-extras")
      },
      {
        label: "최소 정보만으로 용어집을 다시 정리하고 있습니다... (3/3)",
        payload: buildGlossaryPayload(payloadInput, "minimal-only")
      }
    ], onProgress);

    const documentAResult = await generateJsonSection(env, config, [
      {
        label: "문서 A를 작성하고 있습니다... (3/3)",
        payload: buildDocumentPayload(payloadInput, glossary.glossary || [], "A", "full")
      },
      {
        label: "BGG를 제외하고 문서 A를 다시 작성하고 있습니다... (3/3)",
        payload: buildDocumentPayload(payloadInput, glossary.glossary || [], "A", "no-bgg")
      },
      {
        label: "추가 자료까지 제외하고 문서 A를 다시 작성하고 있습니다... (3/3)",
        payload: buildDocumentPayload(payloadInput, glossary.glossary || [], "A", "no-bgg-no-extras")
      },
      {
        label: "최소 정보만으로 문서 A를 다시 작성하고 있습니다... (3/3)",
        payload: buildDocumentPayload(payloadInput, glossary.glossary || [], "A", "minimal-only")
      }
    ], onProgress);

    const documentBResult = await generateJsonSection(env, config, [
      {
        label: "문서 B를 작성하고 있습니다... (3/3)",
        payload: buildDocumentPayload(payloadInput, glossary.glossary || [], "B", "full")
      },
      {
        label: "BGG를 제외하고 문서 B를 다시 작성하고 있습니다... (3/3)",
        payload: buildDocumentPayload(payloadInput, glossary.glossary || [], "B", "no-bgg")
      },
      {
        label: "추가 자료까지 제외하고 문서 B를 다시 작성하고 있습니다... (3/3)",
        payload: buildDocumentPayload(payloadInput, glossary.glossary || [], "B", "no-bgg-no-extras")
      },
      {
        label: "최소 정보만으로 문서 B를 다시 작성하고 있습니다... (3/3)",
        payload: buildDocumentPayload(payloadInput, glossary.glossary || [], "B", "minimal-only")
      }
    ], onProgress);

    const images = state.pdfExtraction?.images || [];
    const documentAHtml = injectImagesIntoHtml(documentAResult.documentHtml || "", images);
    const documentBHtml = injectImagesIntoHtml(documentBResult.documentHtml || "", images);

    return {
      ok: true,
      data: {
        gameName: state.request.gameName,
        bggId: state.request.bggId,
        glossary: glossary.glossary || [],
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

async function generateJsonSection(env, config, attempts, onProgress) {
  let lastError = null;

  for (const attempt of attempts) {
    await onProgress(attempt.label, { stage: "ai" });

    let result;
    try {
      result = await generateWithRetry(env, config, attempt.payload);
    } catch (error) {
      if (error.code === "GEMINI_INPUT_TOO_LARGE") {
        lastError = error;
        continue;
      }
      throw error;
    }

    try {
      return parseGeminiJsonResponse(result);
    } catch {
      throw createUserError(
        "AI 응답 형식을 정리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
        502,
        "GEMINI_RESPONSE_INVALID"
      );
    }
  }

  throw createUserError(
    "AI에 전달할 자료가 너무 많아 문서 생성에 실패했습니다. BGG, 추가 자료, PDF를 단계적으로 제외해도 현재 무료 티어 한도를 넘고 있습니다.",
    413,
    lastError?.code || "GEMINI_INPUT_TOO_LARGE"
  );
}
