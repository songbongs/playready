import { collectBggForumData } from "../bgg/bggApi.js";
import { createUserError } from "../security/inputValidator.js";
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

async function fetchOptionalPdfExtraction(payload, config, onProgress, warningMessage) {
  try {
    return await fetchPdfExtraction(payload, config);
  } catch {
    await onProgress(warningMessage, { stage: "pdf-warning" });
    return null;
  }
}

function prefixExtraction(sourceType, extraction) {
  const textBlocks = (extraction?.textBlocks || []).map((block) => ({
    ...block,
    id: `${sourceType}-${block.id}`,
    sourceType
  }));

  const images = (extraction?.images || []).map((image) => ({
    ...image,
    id: `${sourceType}-${image.id}`,
    nearestTextBlockId: image.nearestTextBlockId ? `${sourceType}-${image.nearestTextBlockId}` : null,
    sourceType
  }));

  return {
    ok: Boolean(extraction?.ok),
    gameName: extraction?.gameName || "",
    pageCount: Number(extraction?.pageCount || 0),
    textBlocks,
    images
  };
}

function buildEmptyExtraction(gameName) {
  return {
    ok: true,
    gameName,
    pageCount: 0,
    textBlocks: [],
    images: []
  };
}

function mergeExtractions(gameName, rulebookExtraction, faqExtraction) {
  const rulebook = prefixExtraction("rulebook", rulebookExtraction);
  const faq = prefixExtraction("faq", faqExtraction);

  return {
    ok: true,
    gameName,
    pageCount: rulebook.pageCount + faq.pageCount,
    textBlocks: [...rulebook.textBlocks, ...faq.textBlocks],
    images: [...rulebook.images, ...faq.images]
  };
}

function cleanupSensitiveData(state) {
  state.request.pdfBase64 = "";
  state.request.faqPdfBase64 = "";
  state.rulebookExtraction = null;
  state.faqExtraction = null;
  state.pdfExtraction = null;
  state.bggForumData = null;
  state.request.additionalMaterials = [];
}

function getRenderGenerateUrl(config) {
  if (!config.pdfExtractorUrl) {
    throw createUserError("AI 생성 서버 주소가 설정되지 않았습니다.", 500, "MISSING_AI_SERVICE");
  }

  if (config.pdfExtractorUrl.endsWith("/extract")) {
    return `${config.pdfExtractorUrl.slice(0, -"/extract".length)}/generate-json`;
  }

  return `${config.pdfExtractorUrl.replace(/\/$/, "")}/generate-json`;
}

function parseAiServiceError(status, message) {
  const normalized = String(message || "");

  if (/location is not supported/i.test(normalized)) {
    return createUserError(
      "현재 설정한 Gemini API는 이 서버 위치에서 사용할 수 없습니다. Render 서버 지역 또는 Gemini 제공 방식을 다시 확인해주세요.",
      403,
      "GEMINI_UNSUPPORTED_LOCATION"
    );
  }

  if (/quota|billing|rate limit|exceeded your current quota/i.test(normalized)) {
    return createUserError(
      "Gemini 사용량 또는 결제 한도에 도달했습니다. Google AI Studio 또는 Google Cloud 결제 상태를 확인해주세요.",
      403,
      "GEMINI_QUOTA_OR_BILLING"
    );
  }

  if (/api key|authentication/i.test(normalized)) {
    return createUserError(
      "Render 서버의 Gemini API 키 설정이 올바르지 않습니다. Render 환경변수 GEMINI_API_KEY를 다시 확인해주세요.",
      401,
      "GEMINI_INVALID_KEY"
    );
  }

  if (/model/i.test(normalized) && status === 404) {
    return createUserError(
      "설정한 Gemini 모델 이름을 찾을 수 없습니다. 모델 설정을 다시 확인해주세요.",
      404,
      "GEMINI_MODEL_NOT_FOUND"
    );
  }

  if (status === 503 || /high demand|temporar|unavailable/i.test(normalized)) {
    return createUserError(
      "AI 서버가 현재 매우 혼잡합니다. 잠시 후 다시 시도해주세요. 보통 몇 분 안에 다시 정상화됩니다.",
      503,
      "GEMINI_TEMPORARILY_UNAVAILABLE"
    );
  }

  if (
    status === 413 ||
    /token limit|context length|request too large|input too large|too many tokens|too large/i.test(normalized)
  ) {
    return createUserError(
      "AI에 전달할 자료가 너무 많아 문서 생성에 실패했습니다. 입력 자료를 줄이거나 더 큰 한도의 모델을 사용해주세요.",
      413,
      "GEMINI_INPUT_TOO_LARGE"
    );
  }

  return createUserError(
    `AI 처리 중 오류가 발생했습니다. Gemini 응답: ${normalized.slice(0, 220)}`,
    status || 502,
    "GEMINI_FAILED"
  );
}

async function requestRenderGeneration(config, payload) {
  const endpoint = getRenderGenerateUrl(config);
  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.geminiModel,
        payload
      })
    });
  } catch {
    throw createUserError(
      "Render AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
      502,
      "AI_SERVICE_UNAVAILABLE"
    );
  }

  const responseText = await response.text();

  if (!response.ok) {
    let detail = responseText;
    try {
      const parsed = JSON.parse(responseText || "{}");
      detail = parsed?.detail || parsed?.message || "";
    } catch {
      detail = responseText;
    }

    throw parseAiServiceError(response.status, detail);
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText || "{}");
  } catch {
    throw createUserError(
      "Render AI 서버가 올바른 JSON 응답을 반환하지 않았습니다. 잠시 후 다시 시도해주세요.",
      502,
      "AI_SERVICE_INVALID_RESPONSE"
    );
  }

  return parsed?.result || parsed;
}

async function generateJsonSection(config, payload) {
  const result = await requestRenderGeneration(config, payload);

  try {
    return parseGeminiJsonResponse(result);
  } catch (error) {
    if (error?.code === "GEMINI_OUTPUT_TOO_LARGE") {
      throw createUserError(
        "AI가 문서를 거의 완성했지만 출력 길이가 너무 길어 마지막 JSON 정리에 실패했습니다. 문서 분량을 더 나눠 생성하거나 출력 한도를 더 큰 방식으로 조정해야 합니다.",
        502,
        "GEMINI_OUTPUT_TOO_LARGE"
      );
    }

    throw createUserError(
      "AI 응답 형식을 정리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
      502,
      "GEMINI_RESPONSE_INVALID"
    );
  }
}

export async function runGenerationPipeline(state, env, config, onProgress = async () => {}) {
  const startedAt = Date.now();
  const assertTime = () => {
    if (Date.now() - startedAt > config.processingTimeoutMs) {
      throw createUserError(
        "처리 시간이 초과되었습니다. 입력 자료를 줄이거나 다시 시도해주세요.",
        504,
        "TIMEOUT"
      );
    }
  };

  try {
    await onProgress("BGG 포럼 데이터를 수집하고 있습니다... (1/3)", { stage: "bgg" });
    state.bggForumData = await collectBggForumData(state.request.bggId, config, onProgress);
    assertTime();

    await onProgress("PDF를 분석하고 있습니다... (2/3)", { stage: "pdf" });

    if (state.request.pdfBase64) {
      state.rulebookExtraction =
        (await fetchOptionalPdfExtraction(
          {
            gameName: state.request.gameName,
            pdfBase64: state.request.pdfBase64,
            pdfFileName: state.request.pdfFileName
          },
          config,
          onProgress,
          "룰북 PDF는 읽지 못했지만 BGG 자료 기준으로 계속 진행합니다... (2/3)"
        )) || buildEmptyExtraction(state.request.gameName);
    } else {
      state.rulebookExtraction = buildEmptyExtraction(state.request.gameName);
    }

    if (state.request.faqPdfBase64) {
      await onProgress("FAQ/정오표 PDF를 분석하고 있습니다... (2/3)", { stage: "pdf" });
      state.faqExtraction =
        (await fetchOptionalPdfExtraction(
          {
            gameName: state.request.gameName,
            pdfBase64: state.request.faqPdfBase64,
            pdfFileName: state.request.faqPdfFileName
          },
          config,
          onProgress,
          "FAQ/정오표 PDF는 읽지 못했지만 룰북과 BGG 자료 기준으로 계속 진행합니다... (2/3)"
        )) || buildEmptyExtraction(state.request.gameName);
    } else {
      state.faqExtraction = buildEmptyExtraction(state.request.gameName);
    }

    if (
      !state.rulebookExtraction?.pageCount &&
      !state.bggForumData?.forums?.length &&
      !state.request.additionalMaterials?.length
    ) {
      throw createUserError(
        "룰북 PDF를 읽지 못했고 사용할 수 있는 다른 자료도 없어 문서를 생성할 수 없습니다. 다른 PDF 파일로 다시 시도해주세요.",
        400,
        "RULEBOOK_PDF_PARSE_FAILED"
      );
    }

    if (!state.request.pdfBase64 && state.request.faqPdfBase64 && !state.faqExtraction?.pageCount) {
      throw createUserError(
        "FAQ/정오표 PDF를 읽을 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.",
        400,
        "FAQ_PDF_PARSE_FAILED"
      );
    }

    state.pdfExtraction = mergeExtractions(
      state.request.gameName,
      state.rulebookExtraction,
      state.faqExtraction
    );
    assertTime();

    await onProgress("한국어 문서를 생성하고 있습니다... (3/3)", { stage: "ai" });
    const payloadInput = {
      gameName: state.request.gameName,
      bggId: state.request.bggId,
      pdfExtraction: state.pdfExtraction,
      faqExtraction: prefixExtraction("faq", state.faqExtraction),
      bggForumData: state.bggForumData,
      additionalMaterials: state.request.additionalMaterials
    };

    const glossaryResult = await generateJsonSection(config, buildGlossaryPayload(payloadInput));
    const documentAResult = await generateJsonSection(
      config,
      buildDocumentPayload(payloadInput, glossaryResult.glossary || [], "A")
    );
    const documentBResult = await generateJsonSection(
      config,
      buildDocumentPayload(payloadInput, glossaryResult.glossary || [], "B")
    );

    const images = state.pdfExtraction?.images || [];
    const documentAHtml = injectImagesIntoHtml(documentAResult.documentHtml || "", images);
    const documentBHtml = injectImagesIntoHtml(documentBResult.documentHtml || "", images);

    return {
      ok: true,
      data: {
        gameName: state.request.gameName,
        bggId: state.request.bggId,
        glossary: glossaryResult.glossary || [],
        documentAHtml,
        documentBHtml,
        meta: {
          generatedAt: new Date().toISOString(),
          imageCount: images.length,
          forumCount: state.bggForumData?.forums?.length || 0,
          faqPageCount: state.faqExtraction?.pageCount || 0,
          rulebookPageCount: state.rulebookExtraction?.pageCount || 0,
          faqIncluded: Boolean(state.faqExtraction?.pageCount)
        }
      }
    };
  } finally {
    cleanupSensitiveData(state);
  }
}
