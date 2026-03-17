function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/[\uE000-\uF8FF\uFFF0-\uFFFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u2000-\u200D\u2060\uFEFF]/g, " ")
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return sanitizeText(value).toLowerCase();
}

function sourceLabel(sourceType) {
  return sourceType === "faq" ? "FAQ" : "룰북";
}

function shortHeading(text) {
  const cleaned = sanitizeText(text).replace(/\|.*$/, "").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > 28 ? `${cleaned.slice(0, 28).trim()}...` : cleaned;
}

function buildTextBlockMap(extraction) {
  return new Map((extraction?.textBlocks || []).map((block) => [block.id, block]));
}

function buildImageTag(image, caption, variant = "standard") {
  const alt = escapeHtml(`${sourceLabel(image.sourceType)} ${image.page}페이지 이미지`);
  const safeCaption = escapeHtml(caption || `${sourceLabel(image.sourceType)} ${image.page}페이지`);
  const className =
    variant === "icon" ? "auto-image-card auto-image-card--icon" : "auto-image-card";

  return [
    `<figure class="${className}" data-image-id="${escapeHtml(image.id)}">`,
    `<img src="data:${image.mimeType};base64,${image.base64}" alt="${alt}" loading="lazy" />`,
    `<figcaption>${safeCaption}</figcaption>`,
    `</figure>`
  ].join("");
}

function replaceImageSlots(html, images) {
  return html.replace(/\[IMAGE_SLOT:([^\]]+)\]/g, (_, imageId) => {
    const image = images.find((item) => item.id === imageId);
    return image ? buildImageTag(image, `${sourceLabel(image.sourceType)} ${image.page}페이지`) : "";
  });
}

function matchAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function getImageMetrics(image) {
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  const pixelWidth = Number(image.pixelWidth || 0);
  const pixelHeight = Number(image.pixelHeight || 0);
  const areaRatio = Number(image.areaRatio || 0);
  const aspectRatio = width && height ? width / height : pixelWidth && pixelHeight ? pixelWidth / pixelHeight : 1;

  return {
    width,
    height,
    pixelWidth,
    pixelHeight,
    areaRatio,
    aspectRatio
  };
}

function isUsableImage(image) {
  const { pixelWidth, pixelHeight, areaRatio, aspectRatio } = getImageMetrics(image);

  if (pixelWidth < 32 || pixelHeight < 32) {
    return false;
  }

  if (areaRatio >= 0.78) {
    return false;
  }

  if (aspectRatio >= 6 || aspectRatio <= 0.12) {
    return false;
  }

  return true;
}

function inferCaption(bucket, block, image) {
  const heading = shortHeading(block?.heading || "");
  const source = `${sourceLabel(image.sourceType)} ${image.page}페이지`;

  const fallbackMap = {
    components: "구성물 참고 이미지",
    setup: "세팅 참고 이미지",
    icons: "아이콘 참조",
    boards: "보드 참고 이미지"
  };

  return heading ? `${source} | ${heading}` : `${source} | ${fallbackMap[bucket]}`;
}

function classifyImage(image, textBlockMap) {
  if (!isUsableImage(image)) {
    return null;
  }

  const block = textBlockMap.get(image.nearestTextBlockId);
  const context = normalize(`${block?.heading || ""} ${block?.text || ""}`);
  const metrics = getImageMetrics(image);
  const looksLikeIcon =
    metrics.areaRatio > 0 &&
    metrics.areaRatio <= 0.018 &&
    metrics.pixelWidth <= 320 &&
    metrics.pixelHeight <= 320;
  const looksLikeBoard = metrics.areaRatio >= 0.14 || metrics.aspectRatio >= 1.2;

  if (
    looksLikeIcon ||
    matchAny(context, ["아이콘", "기호", "심벌", "symbol", "icon", "효과", "자원 획득"])
  ) {
    return {
      bucket: "icons",
      image,
      caption: inferCaption("icons", block, image),
      score: looksLikeIcon ? 90 : 70
    };
  }

  if (
    matchAny(context, ["구성물", "컴포넌트", "components", "materials", "자원", "토큰", "카드", "말"]) &&
    metrics.areaRatio <= 0.35
  ) {
    return {
      bucket: "components",
      image,
      caption: inferCaption("components", block, image),
      score: 80 - Math.min(metrics.areaRatio * 100, 25)
    };
  }

  if (
    matchAny(context, ["세팅", "준비", "배치", "setup", "set up", "시작 준비", "공용 준비", "개인 준비"])
  ) {
    return {
      bucket: "setup",
      image,
      caption: inferCaption("setup", block, image),
      score: looksLikeBoard ? 88 : 72
    };
  }

  if (
    looksLikeBoard ||
    matchAny(context, ["보드", "개인 보드", "메인 보드", "공용 보드", "player board", "main board", "board"])
  ) {
    return {
      bucket: "boards",
      image,
      caption: inferCaption("boards", block, image),
      score: looksLikeBoard ? 85 : 68
    };
  }

  return null;
}

function dedupeAndLimit(items, maxCount) {
  const seen = new Set();

  return items
    .sort((left, right) => right.score - left.score)
    .filter((item) => {
      if (seen.has(item.image.id)) {
        return false;
      }
      seen.add(item.image.id);
      return true;
    })
    .slice(0, maxCount);
}

function buildGallerySection(title, lead, items, variant = "standard") {
  if (!items.length) {
    return "";
  }

  const gridClass =
    variant === "icon" ? "auto-image-grid auto-image-grid--icons" : "auto-image-grid";

  const cards = items
    .map((item) => buildImageTag(item.image, item.caption, variant))
    .join("");

  return [
    `<section class="auto-image-gallery auto-image-gallery--${variant}">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<p class="auto-image-gallery__lead">${escapeHtml(lead)}</p>`,
    `<div class="${gridClass}">${cards}</div>`,
    `</section>`
  ].join("");
}

function buildSectionPlan(docType) {
  if (docType === "B") {
    return [
      {
        bucket: "setup",
        title: "게임 준비 한눈에 보기",
        lead: "설명 시작 전에 공용 준비와 개인 준비가 어떻게 놓이는지 빠르게 확인할 수 있도록 정리했습니다.",
        maxCount: 2,
        variant: "standard",
        headings: ["셋업", "준비", "setup", "첫 라운드", "게임 준비"]
      },
      {
        bucket: "components",
        title: "공용/개인 구성물 요약",
        lead: "플레이어 설명 중 바로 보여주기 쉬운 대표 구성물만 추려 넣었습니다.",
        maxCount: 4,
        variant: "standard",
        headings: ["구성물", "components", "참조 카드", "소개"]
      },
      {
        bucket: "icons",
        title: "중요 아이콘 빠른 참조",
        lead: "설명 중 자주 헷갈리는 아이콘만 작은 카드 형태로 빠르게 볼 수 있게 정리했습니다.",
        maxCount: 8,
        variant: "icon",
        headings: ["아이콘", "용어집", "참조 카드", "자주 헷갈리는"]
      },
      {
        bucket: "boards",
        title: "보드 보는 법",
        lead: "공용 보드와 개인 보드를 설명할 때 바로 보여주기 좋은 예시만 남겼습니다.",
        maxCount: 2,
        variant: "standard",
        headings: ["보드", "첫 라운드", "진행 가이드"]
      }
    ];
  }

  return [
    {
      bucket: "components",
      title: "주요 구성물 이미지",
      lead: "구성물 설명 근처에서 찾아낸 이미지를 학습용으로 다시 정리했습니다.",
      maxCount: 6,
      variant: "standard",
      headings: ["구성물", "components", "materials"]
    },
    {
      bucket: "setup",
      title: "세팅 참고 이미지",
      lead: "공용 준비와 개인 준비를 실제 배치 예시로 이해하기 쉽게 모았습니다.",
      maxCount: 4,
      variant: "standard",
      headings: ["세팅", "준비", "setup", "턴 순서"]
    },
    {
      bucket: "icons",
      title: "주요 아이콘 참조표",
      lead: "자주 등장하는 아이콘을 큰 그림 대신 작은 참조 카드처럼 정리했습니다.",
      maxCount: 10,
      variant: "icon",
      headings: ["아이콘", "기호", "핵심 메커니즘", "예외 규칙"]
    },
    {
      bucket: "boards",
      title: "개인 보드/공용 보드 예시",
      lead: "보드 구조를 미리 익히기 좋도록 대표 이미지만 추려 넣었습니다.",
      maxCount: 3,
      variant: "standard",
      headings: ["보드", "턴 순서", "핵심 메커니즘"]
    }
  ];
}

function insertAfterHeading(html, headingPatterns, sectionHtml) {
  if (!sectionHtml) {
    return html;
  }

  for (const pattern of headingPatterns) {
    const regex = new RegExp(`(<h[23][^>]*>[^<]*${pattern}[^<]*<\\/h[23]>)`, "i");
    if (regex.test(html)) {
      return html.replace(regex, `$1${sectionHtml}`);
    }
  }

  if (html.includes("</section>")) {
    return html.replace("</section>", `${sectionHtml}</section>`);
  }

  return `${html}${sectionHtml}`;
}

function collectClassifiedImages(extraction) {
  const textBlockMap = buildTextBlockMap(extraction);
  const buckets = {
    components: [],
    setup: [],
    icons: [],
    boards: []
  };

  for (const image of extraction?.images || []) {
    const classified = classifyImage(image, textBlockMap);
    if (!classified) {
      continue;
    }
    buckets[classified.bucket].push(classified);
  }

  return buckets;
}

function injectAutomaticGalleries(html, extraction, docType) {
  const plan = buildSectionPlan(docType);
  const classified = collectClassifiedImages(extraction);
  let result = html;

  for (const section of plan) {
    const items = dedupeAndLimit(classified[section.bucket] || [], section.maxCount);
    const sectionHtml = buildGallerySection(section.title, section.lead, items, section.variant);
    result = insertAfterHeading(result, section.headings, sectionHtml);
  }

  return result;
}

function stripHtml(value) {
  return sanitizeText(
    String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|li|div|h2|h3|h4|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractListItemsNearTurnSection(html) {
  const sectionRegex =
    /<(section|article)[^>]*>([\s\S]{0,3000}?(턴 순서|진행 순서|라운드|행동|액션|첫 라운드|턴 진행)[\s\S]{0,3000}?)<\/\1>/i;
  const match = html.match(sectionRegex);
  const source = match?.[2] || html;
  const listMatches = [...source.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];

  return listMatches
    .map((item) => stripHtml(item[1]))
    .filter(Boolean)
    .slice(0, 5);
}

function buildFallbackActionSteps(docType, html) {
  const inferred = extractListItemsNearTurnSection(html);
  if (inferred.length >= 3) {
    return inferred.map((item, index) => ({
      title: index === 0 ? "시작 확인" : index === inferred.length - 1 ? "마무리" : `핵심 단계 ${index + 1}`,
      detail: item
    }));
  }

  if (docType === "B") {
    return [
      { title: "차례 시작", detail: "내 차례에 확인할 보드 상태와 필수 효과를 먼저 확인합니다." },
      { title: "행동 선택", detail: "설명자가 안내한 대표 행동 중 하나를 선택합니다." },
      { title: "효과 처리", detail: "선택한 행동의 비용, 보상, 이동, 카드 처리 등을 순서대로 적용합니다." },
      { title: "차례 종료", detail: "정리 효과를 끝내고 다음 플레이어에게 차례를 넘깁니다." }
    ];
  }

  return [
    { title: "턴 시작", detail: "시작 시 발동 효과, 유지 조건, 자원 상태를 먼저 확인합니다." },
    { title: "행동 선택", detail: "이번 턴에 가능한 주요 액션 중 하나를 선택합니다." },
    { title: "결과 처리", detail: "선택한 행동의 비용 지불, 보상 획득, 배치, 이동, 해결 순서를 적용합니다." },
    { title: "정리 단계", detail: "턴 종료 조건과 정리 효과를 확인한 뒤 다음 플레이어로 넘어갑니다." }
  ];
}

function buildActionFlowSection(docType, html) {
  const steps = buildFallbackActionSteps(docType, html);
  const title = docType === "B" ? "내 턴에는 이렇게 진행합니다" : "턴 진행 흐름 한눈에 보기";
  const lead =
    docType === "B"
      ? "설명 중 바로 보여주기 쉽게, 한 턴의 흐름만 짧고 분명하게 정리했습니다."
      : "게임을 혼자 공부할 때 턴의 흐름을 빠르게 떠올릴 수 있도록 핵심 단계만 도식화했습니다.";

  const stepHtml = steps
    .map((step) => {
      return [
        `<div class="action-flow-step">`,
        `<strong>${escapeHtml(step.title)}</strong>`,
        `<p>${escapeHtml(step.detail)}</p>`,
        `</div>`
      ].join("");
    })
    .join('<div class="action-flow-arrow" aria-hidden="true">→</div>');

  return [
    `<section class="action-flow-section">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<p class="action-flow-section__lead">${escapeHtml(lead)}</p>`,
    `<div class="action-flow">${stepHtml}</div>`,
    `</section>`
  ].join("");
}

function ensureActionFlowSection(html, docType) {
  if (/class=["'][^"']*action-flow-section/.test(html)) {
    return html;
  }

  const actionFlowHtml = buildActionFlowSection(docType, html);
  return insertAfterHeading(
    html,
    ["턴 순서", "진행 순서", "핵심 메커니즘", "첫 라운드", "round", "turn", "action"],
    actionFlowHtml
  );
}

export function injectImagesIntoHtml(html, extraction, docType = "A") {
  const images = extraction?.images || [];
  const withManualSlots = replaceImageSlots(html, images);
  const withActionFlow = ensureActionFlowSection(withManualSlots, docType);
  return injectAutomaticGalleries(withActionFlow, extraction, docType);
}
