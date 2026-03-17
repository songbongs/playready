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
    matchAny(context, ["아이콘", "기호", "효과", "symbol", "icon", "자원 획득", "액션"])
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
    matchAny(context, ["세팅", "준비", "배치", "setup", "set up", "공용 준비", "개인 준비", "첫 라운드"])
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

  const cards = items.map((item) => buildImageTag(item.image, item.caption, variant)).join("");

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
        headings: ["구성물", "참조 카드", "소개"]
      },
      {
        bucket: "icons",
        title: "핵심 아이콘 사전",
        lead: "설명 중 자주 헷갈리는 아이콘만 빠르게 찾아볼 수 있도록 정리했습니다.",
        maxCount: 8,
        variant: "icon",
        headings: ["아이콘", "Q&A", "용어", "참조"]
      },
      {
        bucket: "boards",
        title: "첫 라운드 보드 참고",
        lead: "첫 설명 때 테이블 위에서 바로 보여주기 좋은 보드 이미지만 남겼습니다.",
        maxCount: 2,
        variant: "standard",
        headings: ["첫 라운드", "스크립트", "보드", "셋업"]
      }
    ];
  }

  return [
    {
      bucket: "components",
      title: "구성물 완전 해설 이미지",
      lead: "구성물 설명을 볼 때 바로 옆에서 참고할 수 있게 대표 이미지를 정리했습니다.",
      maxCount: 6,
      variant: "standard",
      headings: ["구성물", "완전 해설"]
    },
    {
      bucket: "setup",
      title: "준비 단계 참고 이미지",
      lead: "공용 준비와 개인 준비를 실제 배치 예시로 이해할 수 있게 모았습니다.",
      maxCount: 4,
      variant: "standard",
      headings: ["준비", "가이드", "세팅"]
    },
    {
      bucket: "icons",
      title: "작업 아이콘 완전 백과",
      lead: "자주 보는 아이콘을 작은 참조 카드처럼 정리해 빠르게 다시 볼 수 있게 만들었습니다.",
      maxCount: 10,
      variant: "icon",
      headings: ["아이콘", "백과", "작업 아이콘"]
    },
    {
      bucket: "boards",
      title: "보드 구조 참고 이미지",
      lead: "개인 보드와 공용 보드 구조를 이해하기 좋도록 대표 이미지를 남겼습니다.",
      maxCount: 3,
      variant: "standard",
      headings: ["보드", "트랙", "턴 진행"]
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
    /<(section|article)[^>]*>([\s\S]{0,3200}?(턴|행동|라운드|첫 라운드|진행 흐름|턴 진행)[\s\S]{0,3200}?)<\/\1>/i;
  const match = html.match(sectionRegex);
  const source = match?.[2] || html;
  const listMatches = [...source.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];

  return listMatches
    .map((item) => stripHtml(item[1]))
    .filter(Boolean)
    .slice(0, 6);
}

function buildFallbackActionSteps(docType, html) {
  const inferred = extractListItemsNearTurnSection(html);
  if (inferred.length >= 4) {
    return inferred.map((item, index) => ({
      title:
        index === 0
          ? "내 차례 시작"
          : index === inferred.length - 1
            ? "종료 또는 다음 단계"
            : `핵심 단계 ${index + 1}`,
      detail: item,
      tone: index === 0 || index === inferred.length - 1 ? "neutral" : "primary"
    }));
  }

  if (docType === "B") {
    return [
      { title: "내 차례 시작", detail: "차례 시작 시 확인할 효과와 현재 보드 상태를 먼저 봅니다.", tone: "neutral" },
      { title: "행동 1개 선택", detail: "이번 차례에는 대표 행동 하나를 선택해 실행합니다.", tone: "primary" },
      { title: "효과 처리", detail: "선택한 행동의 비용, 보상, 배치, 이동을 순서대로 적용합니다.", tone: "secondary" },
      { title: "차례 종료", detail: "추가 정리 효과를 끝내고 다음 플레이어에게 차례를 넘깁니다.", tone: "neutral" }
    ];
  }

  return [
    { title: "내 차례 시작", detail: "시작 시 발동 효과와 목표 달성 여부를 먼저 확인합니다.", tone: "neutral" },
    { title: "3가지 행동 중 하나 선택", detail: "작업 배치, 기술자 승급, 패스 중 하나를 선택해 실행합니다.", tone: "primary" },
    { title: "추가 처리", detail: "특수 경로, 빠른 배치, 목표 달성 여부, 추가 보상을 순서대로 처리합니다.", tone: "secondary" },
    { title: "라운드 종료 조건 확인", detail: "모든 플레이어가 패스했는지 또는 종료 조건을 만족했는지 확인합니다.", tone: "warning" },
    { title: "종료 아님 / 라운드 종료", detail: "종료가 아니면 다음 플레이어로, 종료면 라운드 마무리 단계로 넘어갑니다.", tone: "neutral" }
  ];
}

function buildVerticalActionFlow(steps) {
  return steps
    .map((step, index) => {
      const arrow =
        index === steps.length - 1
          ? ""
          : '<div class="action-flow-arrow action-flow-arrow--vertical" aria-hidden="true">↓</div>';

      return [
        `<div class="action-flow-node action-flow-node--${escapeHtml(step.tone || "neutral")}">`,
        `<div class="action-flow-step">`,
        `<strong>${escapeHtml(step.title)}</strong>`,
        `<p>${escapeHtml(step.detail)}</p>`,
        `</div>`,
        `</div>`,
        arrow
      ].join("");
    })
    .join("");
}

function buildActionFlowSection(docType, html) {
  const steps = buildFallbackActionSteps(docType, html);
  const title = docType === "B" ? "내 턴에는 이렇게 진행합니다" : "플레이 흐름 도식화";
  const lead =
    docType === "B"
      ? "처음 설명할 때 바로 보여줄 수 있도록, 내 차례에 무엇을 하는지 위에서 아래로 정리했습니다."
      : "실제 플레이 도중 흐름을 놓치지 않도록, 내 턴의 핵심 단계를 위에서 아래로 따라가며 볼 수 있게 정리했습니다.";

  return [
    `<section class="action-flow-section">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<p class="action-flow-section__lead">${escapeHtml(lead)}</p>`,
    `<div class="action-flow action-flow--vertical">`,
    buildVerticalActionFlow(steps),
    `</div>`,
    `</section>`
  ].join("");
}

function ensureActionFlowSection(html, docType) {
  if (/class=["'][^"']*action-flow-section/.test(html)) {
    return html.replace(/class=(["'][^"']*action-flow)(?![^"']*action-flow--vertical)([^"']*\1)/, "");
  }

  const actionFlowHtml = buildActionFlowSection(docType, html);
  return insertAfterHeading(
    html,
    ["턴 진행", "플레이 흐름", "행동", "첫 라운드", "turn", "action"],
    actionFlowHtml
  );
}

export function injectImagesIntoHtml(html, extraction, docType = "A") {
  const images = extraction?.images || [];
  const withManualSlots = replaceImageSlots(html, images);
  const withActionFlow = ensureActionFlowSection(withManualSlots, docType);
  return injectAutomaticGalleries(withActionFlow, extraction, docType);
}
