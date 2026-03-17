import { collectBggForumData } from "../bgg/bggApi.js";
import { createUserError } from "../security/inputValidator.js";
import {
  buildDocumentPayload,
  buildGlossaryPayload,
  parseGeminiJsonResponse
} from "./promptBuilder.js";
import { injectImagesIntoHtml } from "./imagePlacement.js";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPdfExtraction(payload, config, options = {}) {
  if (!config.pdfExtractorUrl) {
    throw createUserError("PDF 추출 서비스 주소가 설정되지 않았습니다.", 500, "MISSING_PDF_SERVICE");
  }

  const retryableStatuses = new Set([500, 502, 503, 504]);
  const delays = [2000, 5000];
  const timeoutMs = options.timeoutMs ?? 90000;
  let lastResponse = null;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(config.pdfExtractorUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        return response.json();
      }

      lastResponse = response;
      if (retryableStatuses.has(response.status) && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }

      break;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        if (attempt < delays.length) {
          await sleep(delays[attempt]);
          continue;
        }

        throw createUserError(
          "PDF 분석 서버 응답이 너무 오래 걸리고 있습니다. 잠시 후 다시 시도해주세요.",
          504,
          "PDF_SERVICE_TIMEOUT"
        );
      }

      if (attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }

      throw createUserError(
        "PDF 파일을 읽을 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.",
        502,
        "PDF_SERVICE_UNAVAILABLE"
      );
    }
  }

  if (lastResponse?.status >= 500) {
    throw createUserError(
      "PDF 분석 서버가 잠시 불안정합니다. 잠시 후 다시 시도해주세요.",
      502,
      "PDF_SERVICE_UNAVAILABLE"
    );
  }

  throw createUserError(
    "PDF 파일을 읽을 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.",
    400,
    "PDF_PARSE_FAILED"
  );
}

async function fetchOptionalPdfExtraction(
  payload,
  config,
  onProgress,
  warningMessage,
  timeoutWarningMessage = warningMessage
) {
  try {
    return await fetchPdfExtraction(payload, config);
  } catch (error) {
    const message =
      error?.code === "PDF_SERVICE_TIMEOUT"
        ? timeoutWarningMessage === warningMessage
          ? `${warningMessage} PDF 분석이 오래 걸려 가능한 다른 자료부터 먼저 사용합니다.`
          : timeoutWarningMessage
        : warningMessage;
    await onProgress(message, { stage: "pdf-warning" });
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

function hasUsableBggData(bggForumData) {
  return Boolean(
    bggForumData?.forums?.length ||
      bggForumData?.thingInfo?.description ||
      bggForumData?.thingInfo?.mechanics?.length ||
      bggForumData?.thingInfo?.categories?.length ||
      bggForumData?.thingInfo?.name
  );
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
    throw createUserError("AI 생성 서비스 주소가 설정되지 않았습니다.", 500, "MISSING_AI_SERVICE");
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
      "Gemini 사용량 또는 결제 한도를 초과했습니다. Google AI Studio 또는 Google Cloud 결제 상태를 확인해주세요.",
      403,
      "GEMINI_QUOTA_OR_BILLING"
    );
  }

  if (/api key|authentication/i.test(normalized)) {
    return createUserError(
      "Render 서버의 Gemini API 키가 올바르지 않습니다. Render 환경변수 GEMINI_API_KEY를 다시 확인해주세요.",
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
      "AI 서버가 현재 매우 혼잡합니다. 잠시 후 다시 시도해주세요. 보통 몇 분 내로 다시 정상화됩니다.",
      503,
      "GEMINI_TEMPORARILY_UNAVAILABLE"
    );
  }

  if (status === 524 || /524|timed out|timeout/i.test(normalized)) {
    return createUserError(
      "AI 서버가 문서 생성 중 시간 초과로 응답을 끝내지 못했습니다. 입력 자료가 많거나 모델 응답이 느린 상황일 수 있습니다. 잠시 후 다시 시도해주세요.",
      524,
      "GEMINI_UPSTREAM_TIMEOUT"
    );
  }

  if (status === 502 || /502|bad gateway|upstream/i.test(normalized)) {
    return createUserError(
      "AI 서버와 모델 서버 사이 연결이 잠시 불안정했습니다. 잠시 후 다시 시도해주세요. 같은 문제가 반복되면 모델 혼잡 시간대일 수 있습니다.",
      502,
      "GEMINI_UPSTREAM_BAD_GATEWAY"
    );
  }

  if (
    status === 413 ||
    /token limit|context length|request too large|input too large|too many tokens|too large/i.test(normalized)
  ) {
    return createUserError(
      "AI에 전달할 자료가 너무 많아 문서 생성에 실패했습니다. 입력 자료를 줄이거나 더 큰 입력을 지원하는 모델을 사용해주세요.",
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

  return {
    result: parsed?.result || parsed,
    modelInfo: parsed?.modelInfo || null
  };
}

async function generateJsonSection(config, payload) {
  const renderResponse = await requestRenderGeneration(config, payload);

  try {
    return {
      data: parseGeminiJsonResponse(renderResponse.result),
      modelInfo: renderResponse.modelInfo
    };
  } catch (error) {
    if (error?.code === "GEMINI_OUTPUT_TOO_LARGE") {
      throw createUserError(
        "AI가 문서를 거의 완성했지만 출력 길이가 너무 길어 마지막 JSON 정리에 실패했습니다. 문서를 더 작은 단위로 나누는 조정이 필요합니다.",
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

function isRetryableAiError(error) {
  return [
    "GEMINI_TEMPORARILY_UNAVAILABLE",
    "GEMINI_UPSTREAM_BAD_GATEWAY",
    "GEMINI_UPSTREAM_TIMEOUT",
    "AI_SERVICE_UNAVAILABLE"
  ].includes(error?.code);
}

function formatModelUsageSummary(sectionInfos = []) {
  const usableInfos = sectionInfos.filter((info) => info?.usedModel);
  if (!usableInfos.length) {
    return {
      label: "사용 모델: 확인 불가",
      detail: "이번 결과에서 실제 사용 모델 정보를 받지 못했습니다."
    };
  }

  const uniqueModels = [...new Set(usableInfos.map((info) => info.usedModel))];
  const fallbackUsed = usableInfos.some((info) => info.fallbackUsed);

  if (uniqueModels.length === 1 && !fallbackUsed) {
    return {
      label: `사용 모델: ${uniqueModels[0]}`,
      detail: `이번 작업은 전체 단계가 ${uniqueModels[0]}로 처리되었습니다.`
    };
  }

  if (uniqueModels.length === 1 && fallbackUsed) {
    return {
      label: `사용 모델: ${uniqueModels[0]} (fallback 사용)`,
      detail: `기본 모델 재시도 후 ${uniqueModels[0]}로 처리된 단계가 있습니다.`
    };
  }

  return {
    label: `사용 모델: 혼합 (${uniqueModels.join(", ")})`,
    detail: "단계별로 사용된 모델이 달랐습니다. 아래 세부 정보를 확인하세요."
  };
}

function buildModelUsageDetails(sectionMap) {
  const sectionLabels = {
    glossary: "용어집",
    documentA: "문서 A",
    documentB: "문서 B"
  };

  return Object.entries(sectionMap)
    .map(([key, info]) => {
      if (!info?.usedModel) {
        return null;
      }

      const suffix = info.fallbackUsed ? " (fallback)" : "";
      return `${sectionLabels[key]}: ${info.usedModel}${suffix}`;
    })
    .filter(Boolean);
}

async function generateJsonSectionWithRetry(config, payload, onProgress, retryMessage) {
  const delays = [3000, 8000];
  let lastError;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await generateJsonSection(config, payload);
    } catch (error) {
      lastError = error;
      if (!isRetryableAiError(error) || attempt === delays.length) {
        throw error;
      }

      await onProgress(retryMessage, { stage: "ai-retry", attempt: attempt + 1 });
      await sleep(delays[attempt]);
    }
  }

  throw lastError;
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
    state.bggForumData = await collectBggForumData(
      state.request.bggId,
      state.request.gameName,
      config,
      onProgress
    );
    assertTime();

    await onProgress("PDF를 분석하고 있습니다... (2/3)", { stage: "pdf" });

    if (state.request.pdfBase64) {
      await onProgress("룰북 PDF를 분석 서버로 전송하고 있습니다... (2/3)", {
        stage: "pdf-upload"
      });
      await onProgress("룰북 PDF에서 텍스트와 이미지를 추출하고 있습니다... (2/3)", {
        stage: "pdf-extract"
      });
      state.rulebookExtraction =
        (await fetchOptionalPdfExtraction(
          {
            gameName: state.request.gameName,
            pdfBase64: state.request.pdfBase64,
            pdfFileName: state.request.pdfFileName
          },
          config,
          onProgress,
          hasUsableBggData(state.bggForumData)
            ? "룰북 PDF는 읽지 못했지만 BGG 자료 기준으로 계속 진행합니다... (2/3)"
            : "룰북 PDF를 읽지 못했습니다. BGG 기본 정보만으로 계속 진행 가능한지 확인하고 있습니다... (2/3)"
        )) || buildEmptyExtraction(state.request.gameName);
      await onProgress("FAQ/정오표 PDF 분석 결과를 정리하고 있습니다... (2/3)", {
        stage: "pdf-merge"
      });
      await onProgress("FAQ/정오표 PDF 분석 결과를 정리하고 있습니다... (2/3)", {
        stage: "pdf-merge"
      });
      await onProgress("룰북 PDF 분석 결과를 정리하고 있습니다... (2/3)", {
        stage: "pdf-merge"
      });
    } else {
      state.rulebookExtraction = buildEmptyExtraction(state.request.gameName);
    }

    if (state.request.faqPdfBase64) {
      await onProgress("FAQ/정오표 PDF를 분석 서버로 전송하고 있습니다... (2/3)", {
        stage: "pdf-faq-upload"
      });
      await onProgress("FAQ/정오표 PDF에서 텍스트와 이미지를 추출하고 있습니다... (2/3)", {
        stage: "pdf-faq-extract"
      });
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
      !hasUsableBggData(state.bggForumData) &&
      !state.request.additionalMaterials?.length
    ) {
      throw createUserError(
        "룰북 PDF를 읽지 못했고 사용할 수 있는 BGG 포럼 또는 게임 기본 정보도 충분하지 않아 문서를 생성할 수 없습니다. 다른 PDF 파일로 다시 시도해주세요.",
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

    const glossaryResult = await generateJsonSectionWithRetry(
      config,
      buildGlossaryPayload(payloadInput),
      onProgress,
      "AI 서버가 잠시 혼잡하여 용어집을 다시 시도하고 있습니다... (3/3)"
    );
    const documentAResult = await generateJsonSectionWithRetry(
      config,
      buildDocumentPayload(payloadInput, glossaryResult.data.glossary || [], "A"),
      onProgress,
      "AI 서버가 잠시 혼잡하여 문서 A를 다시 시도하고 있습니다... (3/3)"
    );
    const documentBResult = await generateJsonSectionWithRetry(
      config,
      buildDocumentPayload(payloadInput, glossaryResult.data.glossary || [], "B"),
      onProgress,
      "AI 서버가 잠시 혼잡하여 문서 B를 다시 시도하고 있습니다... (3/3)"
    );

    const images = state.pdfExtraction?.images || [];
    const documentAHtml = injectImagesIntoHtml(
      documentAResult.data.documentHtml || "",
      state.pdfExtraction,
      "A"
    );
    const documentBHtml = injectImagesIntoHtml(
      documentBResult.data.documentHtml || "",
      state.pdfExtraction,
      "B"
    );
    const modelUsageBySection = {
      glossary: glossaryResult.modelInfo,
      documentA: documentAResult.modelInfo,
      documentB: documentBResult.modelInfo
    };
    const modelUsageSummary = formatModelUsageSummary(Object.values(modelUsageBySection));
    const modelUsageDetails = buildModelUsageDetails(modelUsageBySection);

    return {
      ok: true,
      data: {
        gameName: state.request.gameName,
        bggId: state.request.bggId,
        glossary: glossaryResult.data.glossary || [],
        documentAHtml,
        documentBHtml,
        meta: {
          generatedAt: new Date().toISOString(),
          imageCount: images.length,
          forumCount: state.bggForumData?.forums?.length || 0,
          faqPageCount: state.faqExtraction?.pageCount || 0,
          rulebookPageCount: state.rulebookExtraction?.pageCount || 0,
          faqIncluded: Boolean(state.faqExtraction?.pageCount),
          hasBggThingInfo: Boolean(state.bggForumData?.thingInfo?.name),
          modelUsageSummary,
          modelUsageDetails,
          modelUsageBySection
        }
      }
    };
  } finally {
    cleanupSensitiveData(state);
  }
}
