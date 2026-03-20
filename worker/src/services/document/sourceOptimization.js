function trimText(value, maxLength) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }

  const sliced = normalized.slice(0, maxLength);
  const boundary = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf(" "), sliced.lastIndexOf(", "));
  return `${(boundary > 80 ? sliced.slice(0, boundary) : sliced).trim()}...`;
}

function toSafeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function countForumThreads(forums = []) {
  return forums.reduce((total, forum) => total + (Array.isArray(forum?.threads) ? forum.threads.length : 0), 0);
}

function countTextBlocks(extraction) {
  return Array.isArray(extraction?.textBlocks) ? extraction.textBlocks.length : 0;
}

function countPages(extraction) {
  return Number(extraction?.pageCount || 0);
}

function copyImageMetadata(image) {
  return {
    id: image.id,
    page: image.page,
    bbox: image.bbox,
    mimeType: image.mimeType,
    nearestTextBlockId: image.nearestTextBlockId || null,
    sourceType: image.sourceType || "rulebook",
    width: image.width ?? null,
    height: image.height ?? null,
    pixelWidth: image.pixelWidth ?? null,
    pixelHeight: image.pixelHeight ?? null,
    areaRatio: image.areaRatio ?? null,
    renderMode: image.renderMode ?? null
  };
}

function getStageLimits(stage, useStageInputSlicing) {
  if (!useStageInputSlicing) {
    return {
      maxTextBlocks: 240,
      maxTextChars: 1300,
      maxImages: 10,
      maxForums: 4,
      maxThreadsPerForum: 5,
      maxCommentsPerThread: 4,
      maxCommentChars: 600,
      maxMaterials: 3,
      maxMaterialChars: 2800
    };
  }

  const stageMap = {
    glossary: {
      maxTextBlocks: 160,
      maxTextChars: 900,
      maxImages: 0,
      maxForums: 3,
      maxThreadsPerForum: 3,
      maxCommentsPerThread: 2,
      maxCommentChars: 420,
      maxMaterials: 2,
      maxMaterialChars: 1400
    },
    gameFacts: {
      maxTextBlocks: 180,
      maxTextChars: 1000,
      maxImages: 2,
      maxForums: 4,
      maxThreadsPerForum: 4,
      maxCommentsPerThread: 3,
      maxCommentChars: 480,
      maxMaterials: 2,
      maxMaterialChars: 1800
    },
    turnFlow: {
      maxTextBlocks: 200,
      maxTextChars: 1100,
      maxImages: 3,
      maxForums: 4,
      maxThreadsPerForum: 4,
      maxCommentsPerThread: 3,
      maxCommentChars: 520,
      maxMaterials: 2,
      maxMaterialChars: 1800
    },
    documentA: {
      maxTextBlocks: 240,
      maxTextChars: 1300,
      maxImages: 8,
      maxForums: 4,
      maxThreadsPerForum: 5,
      maxCommentsPerThread: 4,
      maxCommentChars: 600,
      maxMaterials: 3,
      maxMaterialChars: 2600
    },
    documentB: {
      maxTextBlocks: 220,
      maxTextChars: 1200,
      maxImages: 6,
      maxForums: 4,
      maxThreadsPerForum: 4,
      maxCommentsPerThread: 4,
      maxCommentChars: 560,
      maxMaterials: 3,
      maxMaterialChars: 2200
    }
  };

  return stageMap[stage] || stageMap.documentA;
}

function summarizeTextBlocks(textBlocks = [], limits) {
  const sliced = textBlocks.slice(0, limits.maxTextBlocks);
  return {
    items: sliced.map((block) => ({
      id: block.id,
      page: block.page,
      heading: trimText(block.heading || "", 120),
      text: trimText(block.text || "", limits.maxTextChars)
    })),
    omittedCount: Math.max(0, textBlocks.length - sliced.length)
  };
}

function summarizeImages(images = [], limits) {
  const sliced = images.slice(0, limits.maxImages);
  return {
    items: sliced.map(copyImageMetadata),
    omittedCount: Math.max(0, images.length - sliced.length)
  };
}

function summarizeBggForumData(bggForumData = {}, limits) {
  const rawForums = Array.isArray(bggForumData?.forums) ? bggForumData.forums : [];
  const summarizedForums = rawForums.slice(0, limits.maxForums).map((forum) => {
    const rawThreads = Array.isArray(forum?.threads) ? forum.threads : [];
    return {
      id: forum.id,
      title: forum.title || "",
      group: forum.group || "",
      threads: rawThreads.slice(0, limits.maxThreadsPerForum).map((thread) => ({
        id: thread.id,
        subject: trimText(thread.subject || "", 180),
        author: thread.author || "",
        postCount: Number(thread.postCount || 0),
        comments: (Array.isArray(thread?.comments) ? thread.comments : [])
          .slice(0, limits.maxCommentsPerThread)
          .map((comment) => ({
            username: comment.username || "unknown",
            postedAt: comment.postedAt || null,
            language: comment.language || "unknown",
            subject: trimText(comment.subject || "", 120),
            body: trimText(comment.body || "", limits.maxCommentChars),
            isDesignerReply: Boolean(comment.isDesignerReply)
          }))
      }))
    };
  });

  return {
    bggId: bggForumData?.bggId || "",
    collectedAt: bggForumData?.collectedAt || null,
    warning: bggForumData?.warning || "",
    thingInfo: bggForumData?.thingInfo || {},
    forums: summarizedForums,
    summaryMeta: {
      omittedForumCount: Math.max(0, rawForums.length - summarizedForums.length),
      omittedThreadCount: Math.max(0, countForumThreads(rawForums) - countForumThreads(summarizedForums))
    }
  };
}

function summarizeAdditionalMaterials(additionalMaterials = [], limits) {
  const sliced = additionalMaterials.slice(0, limits.maxMaterials);
  return {
    items: sliced.map((item) => ({
      fileName: item.fileName || "",
      mimeType: item.mimeType || "application/octet-stream",
      textContent: trimText(item.textContent || "", limits.maxMaterialChars)
    })),
    omittedCount: Math.max(0, additionalMaterials.length - sliced.length)
  };
}

function summarizeExtraction(extraction, limits) {
  const textBlocks = summarizeTextBlocks(extraction?.textBlocks || [], limits);
  const images = summarizeImages(extraction?.images || [], limits);
  return {
    gameName: extraction?.gameName || "",
    pageCount: Number(extraction?.pageCount || 0),
    textBlocks: textBlocks.items,
    images: images.items,
    summaryMeta: {
      omittedTextBlockCount: textBlocks.omittedCount,
      omittedImageCount: images.omittedCount
    }
  };
}

export function buildOptimizationProfile(state, config) {
  const rolloutMode = String(config.optimizationRolloutMode || "safe_only").toLowerCase();
  const reasons = [];
  const hasRulebook = Boolean(state.request?.pdfBase64);
  const hasFaq = Boolean(state.request?.faqPdfBase64);
  const additionalMaterialCount = state.request?.additionalMaterials?.length || 0;
  const pdfBytes = Number(state.request?.estimatedBytes || 0);
  const forumThreadCount = countForumThreads(state.bggForumData?.forums || []);
  const totalTextBlocks = countTextBlocks(state.pdfExtraction);
  const totalPages = countPages(state.pdfExtraction);

  if (!hasRulebook) reasons.push("룰북 PDF가 없는 작업은 제한적 ON 대상에서 제외합니다.");
  if (hasFaq) reasons.push("FAQ/정오표 PDF가 있으면 기존 경로를 유지합니다.");
  if (additionalMaterialCount > config.optimizationSafeMaxAdditionalMaterials) {
    reasons.push("추가 자료가 포함된 작업은 제한적 ON 대상에서 제외합니다.");
  }
  if (pdfBytes > config.optimizationSafePdfBytes) {
    reasons.push("룰북 PDF 용량이 안전 기준보다 큽니다.");
  }
  if (forumThreadCount > config.optimizationSafeMaxForumThreads) {
    reasons.push("BGG 포럼 스레드 수가 안전 기준보다 많습니다.");
  }
  if (totalTextBlocks > config.optimizationSafeMaxTextBlocks) {
    reasons.push("PDF 텍스트 블록 수가 안전 기준보다 많습니다.");
  }
  if (totalPages > config.optimizationSafeMaxPages) {
    reasons.push("PDF 페이지 수가 안전 기준보다 많습니다.");
  }

  const safeCase = reasons.length === 0;
  const rolloutAllowed = rolloutMode === "on" || (rolloutMode === "safe_only" && safeCase);

  return {
    rolloutMode,
    safeCase,
    reasons,
    useFactPreservingSummary: Boolean(config.enableFactPreservingSummary) && rolloutAllowed,
    useStageInputSlicing: Boolean(config.enableStageInputSlicing) && rolloutAllowed,
    sourceStats: {
      hasRulebook,
      hasFaq,
      additionalMaterialCount,
      pdfBytes,
      forumThreadCount,
      totalTextBlocks,
      totalPages
    }
  };
}

export function buildOptimizedSourceBundle(input, stage, optimizationProfile) {
  const summaryEnabled = Boolean(optimizationProfile?.useFactPreservingSummary);
  const slicingEnabled = Boolean(optimizationProfile?.useStageInputSlicing);
  const limits = getStageLimits(stage, slicingEnabled);

  if (!summaryEnabled && !slicingEnabled) {
    return {
      gameName: input.gameName,
      bggId: input.bggId,
      pdfExtraction: {
        gameName: input.pdfExtraction?.gameName || input.gameName,
        pageCount: Number(input.pdfExtraction?.pageCount || 0),
        textBlocks: input.pdfExtraction?.textBlocks || [],
        images: (input.pdfExtraction?.images || []).map(copyImageMetadata)
      },
      faqExtraction: {
        gameName: input.faqExtraction?.gameName || input.gameName,
        pageCount: Number(input.faqExtraction?.pageCount || 0),
        textBlocks: input.faqExtraction?.textBlocks || [],
        images: (input.faqExtraction?.images || []).map(copyImageMetadata)
      },
      bggForumData: input.bggForumData || { forums: [] },
      additionalMaterials: input.additionalMaterials || []
    };
  }

  return {
    gameName: input.gameName,
    bggId: input.bggId,
    pdfExtraction: summarizeExtraction(input.pdfExtraction, limits),
    faqExtraction: summarizeExtraction(input.faqExtraction, limits),
    bggForumData: summarizeBggForumData(input.bggForumData, limits),
    additionalMaterials: summarizeAdditionalMaterials(input.additionalMaterials || [], limits).items,
    optimizationMeta: {
      stage,
      summaryEnabled,
      slicingEnabled,
      limits
    }
  };
}

export function parseBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function parseRolloutMode(value, fallback = "safe_only") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ["off", "safe_only", "on"].includes(normalized) ? normalized : fallback;
}

export function parsePositiveIntegerFlag(value, fallback) {
  const parsed = toSafeInteger(value, fallback);
  return parsed >= 0 ? parsed : fallback;
}
