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

function normalizeText(value) {
  return sanitizeText(value).toLowerCase();
}

function completeSentence(value, fallback = "") {
  const cleaned = sanitizeText(value || fallback).replace(/[.。…]+$/g, "").trim();
  if (!cleaned) {
    return sanitizeText(fallback);
  }

  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function shortenAtBoundary(value, maxLength, fallback = "") {
  const completed = completeSentence(value, fallback);
  if (completed.length <= maxLength) {
    return completed;
  }

  const sliced = completed.slice(0, maxLength);
  const lastBoundary = Math.max(
    sliced.lastIndexOf(". "),
    sliced.lastIndexOf("! "),
    sliced.lastIndexOf("? "),
    sliced.lastIndexOf(" "),
    sliced.lastIndexOf("·")
  );
  const trimmed = (lastBoundary > 8 ? sliced.slice(0, lastBoundary) : sliced).trim();
  return completeSentence(trimmed, fallback);
}

function stripTags(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoBulletLines(text) {
  const normalized = sanitizeText(text)
    .replace(/\s*[:：]\s*/g, ". ")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s*·\s*/g, ". ");

  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((line) => sanitizeText(line))
    .filter(Boolean)
    .filter((line, index, arr) => arr.indexOf(line) === index);
}

function sourceLabel(sourceType) {
  return sourceType === "faq" ? "FAQ" : "룰북";
}

function shortHeading(text) {
  const cleaned = sanitizeText(text).replace(/\|.*$/, "").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > 32 ? `${cleaned.slice(0, 32).trim()}...` : cleaned;
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

function getImageMetrics(image) {
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  const pixelWidth = Number(image.pixelWidth || 0);
  const pixelHeight = Number(image.pixelHeight || 0);
  const areaRatio = Number(image.areaRatio || 0);
  const aspectRatio =
    width && height ? width / height : pixelWidth && pixelHeight ? pixelWidth / pixelHeight : 1;

  return {
    pixelWidth,
    pixelHeight,
    areaRatio,
    aspectRatio
  };
}

function isUsableImage(image) {
  const { pixelWidth, pixelHeight, areaRatio, aspectRatio } = getImageMetrics(image);

  if (pixelWidth < 40 || pixelHeight < 40) {
    return false;
  }

  if (areaRatio >= 0.72) {
    return false;
  }

  if (aspectRatio >= 6 || aspectRatio <= 0.14) {
    return false;
  }

  return true;
}

function matchAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function inferCaption(bucket, block, image) {
  const heading = shortHeading(block?.heading || "");
  const source = `${sourceLabel(image.sourceType)} ${image.page}페이지`;

  const fallbackMap = {
    components: "구성물 참고 이미지",
    setup: "셋업 참고 이미지",
    icons: "아이콘 참고 이미지",
    boards: "보드 참고 이미지",
    scoring: "점수 참고 이미지"
  };

  return heading ? `${source} | ${heading}` : `${source} | ${fallbackMap[bucket]}`;
}

function classifyImage(image, textBlockMap) {
  if (!isUsableImage(image)) {
    return null;
  }

  const block = textBlockMap.get(image.nearestTextBlockId);
  const context = normalizeText(`${block?.heading || ""} ${block?.text || ""}`);
  const metrics = getImageMetrics(image);
  const looksLikeIcon =
    metrics.areaRatio > 0 &&
    metrics.areaRatio <= 0.018 &&
    metrics.pixelWidth <= 320 &&
    metrics.pixelHeight <= 320;
  const looksLikeBoard = metrics.areaRatio >= 0.14 || metrics.aspectRatio >= 1.18;

  if (
    looksLikeIcon ||
    matchAny(context, ["아이콘", "기호", "symbol", "icon", "효과", "행동", "자원", "능력"])
  ) {
    return {
      bucket: "icons",
      image,
      caption: inferCaption("icons", block, image),
      score: looksLikeIcon ? 95 : 78
    };
  }

  if (matchAny(context, ["점수", "승점", "최종 점수", "종료 점수", "scoring", "score"])) {
    return {
      bucket: "scoring",
      image,
      caption: inferCaption("scoring", block, image),
      score: looksLikeBoard ? 84 : 72
    };
  }

  if (
    matchAny(context, ["구성물", "컴포넌트", "components", "materials", "토큰", "카드", "말", "타일"]) &&
    metrics.areaRatio <= 0.4
  ) {
    return {
      bucket: "components",
      image,
      caption: inferCaption("components", block, image),
      score: 82 - Math.min(metrics.areaRatio * 100, 24)
    };
  }

  if (
    matchAny(context, ["셋업", "setup", "준비", "배치", "시작 세팅", "초기 배치", "플레이어 준비"])
  ) {
    return {
      bucket: "setup",
      image,
      caption: inferCaption("setup", block, image),
      score: looksLikeBoard ? 88 : 76
    };
  }

  if (
    looksLikeBoard ||
    matchAny(context, ["보드", "개인판", "개인 보드", "메인 보드", "트랙", "player board", "main board"])
  ) {
    return {
      bucket: "boards",
      image,
      caption: inferCaption("boards", block, image),
      score: looksLikeBoard ? 86 : 74
    };
  }

  return null;
}

function collectClassifiedImages(extraction) {
  const textBlockMap = buildTextBlockMap(extraction);
  const buckets = {
    components: [],
    setup: [],
    icons: [],
    boards: [],
    scoring: []
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

function findHeadingMatchText(html, headingPatterns) {
  for (const pattern of headingPatterns) {
    const regex = new RegExp(`(<h2[^>]*>[^<]*${pattern}[^<]*<\\/h2>)`, "i");
    const match = html.match(regex);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function insertAfterHeading(html, headingPatterns, sectionHtml) {
  if (!sectionHtml) {
    return html;
  }

  const headingText = findHeadingMatchText(html, headingPatterns);
  if (!headingText) {
    return html;
  }

  return html.replace(headingText, `${headingText}${sectionHtml}`);
}

function containsHeading(html, headingPatterns) {
  return Boolean(findHeadingMatchText(html, headingPatterns));
}

function legacyBuildSectionPlan(docType) {
  if (docType === "B") {
    return [
      {
        title: "셋업 참고 이미지",
        lead: "설명 전에 세팅 상태를 빠르게 확인할 수 있는 이미지입니다.",
        variant: "standard",
        maxCount: 2,
        headingPatterns: ["셋업 체크리스트"],
        requiredBuckets: ["setup", "boards"]
      },
      {
        title: "행동 위치 참고 이미지",
        lead: "내 턴에 어떤 위치를 보며 설명해야 하는지 한눈에 볼 수 있는 이미지입니다.",
        variant: "standard",
        maxCount: 2,
        headingPatterns: ["플레이어 턴 흐름도 (간소화)", "핵심 행동 요약"],
        requiredBuckets: ["boards"]
      },
      {
        title: "핵심 아이콘 카드",
        lead: "실제로 자주 보는 아이콘만 짧게 다시 확인할 수 있게 정리했습니다.",
        variant: "icon",
        maxCount: 8,
        headingPatterns: ["핵심 아이콘 카드"],
        requiredBuckets: ["icons"]
      },
      {
        title: "종료 처리 참고 이미지",
        lead: "라운드 종료나 점수 확인 때 참고할 수 있는 이미지입니다.",
        variant: "standard",
        maxCount: 2,
        headingPatterns: ["라운드 종료 / 게임 종료 체크리스트"],
        requiredBuckets: ["scoring", "boards"]
      }
    ];
  }

  return [
    {
      title: "게임 개요 참고 이미지",
      lead: "게임 전체 구성을 빠르게 이해하는 데 도움이 되는 대표 이미지입니다.",
      variant: "standard",
      maxCount: 2,
      headingPatterns: ["게임 개요"],
      requiredBuckets: ["boards", "components"]
    },
    {
      title: "셋업 참고 이미지",
      lead: "게임 시작 전 준비 상태를 시각적으로 확인하는 데 도움이 되는 이미지입니다.",
      variant: "standard",
      maxCount: 3,
      headingPatterns: ["게임 준비 개요"],
      requiredBuckets: ["setup", "boards"]
    },
      {
        title: "행동 위치 참고 이미지",
        lead: "핵심 행동이 보드에서 어디와 연결되는지 보기 쉽게 정리한 이미지입니다.",
        variant: "standard",
        maxCount: 2,
        headingPatterns: ["플레이어 턴 흐름도", "핵심 행동 상세 설명"],
        requiredBuckets: ["boards"]
      },
    {
      title: "점수·트랙 참고 이미지",
      lead: "트랙, 보드, 점수 구조가 어떻게 이어지는지 참고할 수 있는 이미지입니다.",
      variant: "standard",
      maxCount: 2,
      headingPatterns: ["자원·트랙·상태·위치의 연결", "점수/승리 조건 이해"],
      requiredBuckets: ["boards", "scoring"]
    },
    {
      title: "구성물 해설 이미지",
      lead: "구성물 역할을 구분해서 볼 수 있는 이미지입니다.",
      variant: "standard",
      maxCount: 4,
      headingPatterns: ["구성물 해설"],
      requiredBuckets: ["components"]
    },
    {
      title: "아이콘/기호 사전",
      lead: "문서에서 자주 등장하는 아이콘만 작은 카드 형태로 다시 정리했습니다.",
      variant: "icon",
      maxCount: 10,
      headingPatterns: ["아이콘/기호 사전"],
      requiredBuckets: ["icons"]
    },
    {
      title: "보드/개인판 구조 참고 이미지",
      lead: "보드와 개인판 구조를 구분해서 보기 쉽게 정리한 이미지입니다.",
      variant: "standard",
      maxCount: 3,
      headingPatterns: ["보드/개인판 구조 설명"],
      requiredBuckets: ["boards"]
    }
  ];
}

function legacyPickItemsForPlan(plan, classified) {
  const selected = [];
  const used = new Set();

  for (const bucket of plan.requiredBuckets) {
    const bucketItems = dedupeAndLimit(classified[bucket] || [], plan.maxCount * 2);
    for (const item of bucketItems) {
      if (used.has(item.image.id)) {
        continue;
      }
      selected.push(item);
      used.add(item.image.id);
      if (selected.length >= plan.maxCount) {
        return selected;
      }
    }
  }

  return selected;
}

function legacyInjectAutomaticGalleries(html, extraction, docType) {
  const plan = buildSectionPlan(docType);
  const classified = collectClassifiedImages(extraction);
  let result = html;

  for (const section of plan) {
    if (!containsHeading(result, section.headingPatterns)) {
      continue;
    }

    const items = pickItemsForPlan(section, classified);
    if (!items.length) {
      continue;
    }

    const galleryHtml = buildGallerySection(section.title, section.lead, items, section.variant);
    result = insertAfterHeading(result, section.headingPatterns, galleryHtml);
  }

  return result;
}

function buildActionFlowSteps(docType) {
  if (docType === "B") {
    return [
      { title: "내 차례 시작", detail: "차례 시작 효과와 현재 상태를 먼저 확인합니다.", tone: "neutral" },
      { title: "가능한 행동 확인", detail: "이번 턴에 할 수 있는 대표 행동을 확인합니다.", tone: "primary" },
      { title: "행동 1개 선택", detail: "핵심 선택지 가운데 하나를 고릅니다.", tone: "secondary" },
      { title: "효과 처리", detail: "비용, 보상, 배치, 이동 같은 즉시 효과를 처리합니다.", tone: "secondary" },
      { title: "종료 확인", detail: "추가 처리나 종료 조건이 있는지 짧게 확인합니다.", tone: "warning" },
      { title: "다음 플레이어 또는 라운드 종료", detail: "조건에 따라 다음 차례로 넘기거나 종료 처리를 진행합니다.", tone: "neutral" }
    ];
  }

  return [
    { title: "내 차례 시작", detail: "시작 효과와 현재 상태를 먼저 확인합니다.", tone: "neutral" },
    { title: "현재 상태 / 시작 효과 확인", detail: "턴 시작 시 확인해야 하는 조건과 즉시 효과를 점검합니다.", tone: "primary" },
    { title: "선택 가능한 행동 또는 결정 지점", detail: "이번 턴에 할 수 있는 행동과 선택 조건을 파악합니다.", tone: "warning" },
    { title: "행동 선택", detail: "가능한 행동 가운데 하나를 고릅니다.", tone: "secondary" },
    { title: "행동 효과 처리", detail: "비용, 보상, 이동, 배치, 연쇄 효과를 순서대로 처리합니다.", tone: "secondary" },
    { title: "추가 처리 / 예외 확인", detail: "목표 달성, 즉시 반응, 예외 규칙이 있는지 확인합니다.", tone: "warning" },
    { title: "종료 조건 확인", detail: "턴 종료 또는 라운드 종료 조건이 충족되는지 확인합니다.", tone: "primary" },
    { title: "다음 플레이어 또는 라운드 종료", detail: "조건에 따라 다음 플레이어 차례로 넘기거나 종료 처리를 진행합니다.", tone: "neutral" }
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

function buildStructuredActionFlow(docType) {
  const model =
    docType === "B"
      ? [
          { type: "node", title: "내 차례 시작", detail: "현재 상태와 시작 효과를 확인합니다.", tone: "neutral" },
          { type: "decision", title: "이번 턴에 무엇을 할까?", detail: "핵심 행동 1개를 고를 준비를 합니다.", tone: "primary" },
          {
            type: "branch",
            tone: "secondary",
            options: [
              { title: "행동 선택", detail: "이번 턴의 핵심 행동을 고릅니다." },
              { title: "효과 처리", detail: "비용과 보상을 바로 처리합니다." },
              { title: "패스/종료 판단", detail: "추가 행동 없이 끝낼지 확인합니다." }
            ]
          },
          { type: "merge", title: "턴 마무리", detail: "남은 처리와 종료 조건을 확인합니다.", tone: "warning" },
          { type: "node", title: "다음 플레이어 또는 라운드 종료", detail: "조건에 따라 차례를 넘기거나 종료를 처리합니다.", tone: "neutral" }
        ]
      : [
          { type: "node", title: "내 차례 시작", detail: "시작 효과와 현재 상태를 먼저 확인합니다.", tone: "neutral" },
          { type: "decision", title: "즉시 처리할 예외가 있는가?", detail: "강제 효과와 즉시 반응을 먼저 봅니다.", tone: "primary" },
          {
            type: "branch",
            tone: "secondary",
            options: [
              { title: "행동 선택", detail: "가능한 행동 중 하나를 고릅니다." },
              { title: "효과 처리", detail: "비용, 보상, 이동, 배치를 처리합니다." },
              { title: "예외 확인", detail: "추가 반응과 예외 규칙을 짧게 봅니다." }
            ]
          },
          { type: "merge", title: "턴 마무리", detail: "이번 턴 결과를 정리하고 종료 조건을 확인합니다.", tone: "warning" },
          { type: "node", title: "다음 플레이어 또는 라운드 종료", detail: "조건에 따라 다음 차례나 종료 처리로 넘어갑니다.", tone: "neutral" }
        ];

  return model
    .map((item, index) => {
      const arrow =
        index === model.length - 1
          ? ""
          : '<div class="action-flow-arrow action-flow-arrow--vertical" aria-hidden="true">↓</div>';

      if (item.type === "branch") {
        const options = item.options
          .map(
            (option) => `
              <div class="action-flow-branch-option">
                <strong>${escapeHtml(option.title)}</strong>
                <p>${escapeHtml(option.detail)}</p>
              </div>
            `
          )
          .join("");

        return `
          <div class="action-flow-branch action-flow-branch--${escapeHtml(item.tone || "secondary")}">
            <div class="action-flow-branch__label">여기서 선택이 갈립니다</div>
            <div class="action-flow-branch__options">${options}</div>
          </div>
          ${arrow}
        `;
      }

      const extraClass =
        item.type === "decision"
          ? "action-flow-node--decision"
          : item.type === "merge"
            ? "action-flow-node--merge"
            : "";

      return `
        <div class="action-flow-node action-flow-node--${escapeHtml(item.tone || "neutral")} ${extraClass}">
          <div class="action-flow-step">
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.detail)}</p>
          </div>
        </div>
        ${arrow}
      `;
    })
    .join("");
}

function buildActionFlowSection(docType) {
  const title = docType === "B" ? "2-1. 플레이어 턴 흐름도 (간소화)" : "2-1. 플레이어 턴 흐름도";
  const lead =
    docType === "B"
      ? "설명할 때 바로 보여줄 수 있도록 한 턴의 기본 흐름을 위에서 아래로 정리했습니다."
      : "공부할 때 헷갈리지 않도록 한 턴의 기본 흐름을 위에서 아래로 정리했습니다.";

  return [
    `<section class="action-flow-section">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<p class="action-flow-section__lead">${escapeHtml(lead)}</p>`,
    `<div class="action-flow action-flow--vertical">`,
    buildStructuredActionFlow(docType),
    `</div>`,
    `</section>`
  ].join("");
}

function ensureActionFlowSection(html, docType) {
  if (/class=["'][^"']*action-flow-section/.test(html)) {
    return html;
  }

  const sectionHtml = buildActionFlowSection(docType);
  const headingPatterns =
    docType === "B"
      ? ["플레이어 턴 흐름도 (간소화)", "핵심 행동 요약"]
      : ["플레이어 턴 흐름도", "핵심 행동 상세 설명"];

  const inserted = insertAfterHeading(html, headingPatterns, sectionHtml);
  return inserted === html ? `${html}${sectionHtml}` : inserted;
}

function sanitizeFlowText(value, fallback = "") {
  const cleaned = sanitizeText(value);
  return cleaned || fallback;
}

function clampFlowText(value, maxLength) {
  const cleaned = sanitizeFlowText(value);
  if (!cleaned || cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function normalizeFlowOption(option, fallbackTitle) {
  return {
    title: shortenAtBoundary(option?.title || fallbackTitle, 24, fallbackTitle),
    detail: shortenAtBoundary(option?.detail, 58, ""),
    tone: sanitizeFlowText(option?.tone, "secondary"),
    requirement: sanitizeFlowText(option?.requirement, ""),
    timing: shortenAtBoundary(option?.timing, 34, "")
  };
}

function normalizeFlowStep(step, index, docType) {
  const kind = sanitizeFlowText(step?.kind, index === 0 ? "start" : "action").toLowerCase();
  const title = clampFlowText(step?.title || `단계 ${index + 1}`, docType === "B" ? 16 : 18);
  const detail = clampFlowText(step?.detail, docType === "B" ? 38 : 52);
  const tone = sanitizeFlowText(step?.tone, kind === "decision" ? "primary" : "neutral").toLowerCase();
  const options = Array.isArray(step?.options)
    ? step.options
        .slice(0, 4)
        .map((item, optionIndex) => normalizeFlowOption(item, `선택 ${optionIndex + 1}`))
    : [];

  return { kind, title, detail, tone, options };
}

function getFallbackFlowData(docType) {
  return {
    lead:
      docType === "B"
        ? "설명용으로 내 차례의 핵심 흐름만 짧게 정리했습니다."
        : "학습용으로 내 차례가 어떻게 흘러가는지 핵심 순서만 정리했습니다.",
    steps:
      docType === "B"
        ? [
            { kind: "start", title: "차례 시작", detail: "시작 상태를 먼저 확인합니다.", tone: "neutral" },
            { kind: "decision", title: "행동 선택", detail: "이번 턴에 할 핵심 행동을 고릅니다.", tone: "primary" },
            {
              kind: "branch",
              title: "핵심 선택지",
              detail: "대표 행동 중 하나를 고릅니다.",
              tone: "secondary",
              options: [
                { title: "행동 A", detail: "주요 행동을 수행합니다.", tone: "secondary" },
                { title: "행동 B", detail: "다른 핵심 행동을 수행합니다.", tone: "secondary" }
              ]
            },
            { kind: "end", title: "턴 마무리", detail: "효과를 처리하고 다음 차례로 넘깁니다.", tone: "neutral" }
          ]
        : [
            { kind: "start", title: "내 차례 시작", detail: "턴 시작 상태와 즉시 효과를 확인합니다.", tone: "neutral" },
            { kind: "decision", title: "선택 가능 행동 확인", detail: "이번 턴에 가능한 행동과 조건을 봅니다.", tone: "primary" },
            {
              kind: "branch",
              title: "핵심 선택지",
              detail: "대표 행동 중 하나를 고릅니다.",
              tone: "secondary",
              options: [
                { title: "행동 A", detail: "선택한 행동의 비용과 효과를 처리합니다.", tone: "secondary" },
                { title: "행동 B", detail: "다른 행동의 비용과 효과를 처리합니다.", tone: "secondary" }
              ]
            },
            { kind: "merge", title: "후속 처리", detail: "행동 후 공통으로 확인할 효과를 처리합니다.", tone: "warning" },
            { kind: "end", title: "턴 종료", detail: "종료 조건을 확인하고 다음 플레이어로 넘깁니다.", tone: "neutral" }
          ]
  };
}

function normalizeFlowStepV2(step, index, docType) {
  const kind = sanitizeFlowText(step?.kind, index === 0 ? "start" : "action").toLowerCase();
  const title = shortenAtBoundary(step?.title || `단계 ${index + 1}`, docType === "B" ? 22 : 26);
  const detail = shortenAtBoundary(step?.detail, docType === "B" ? 62 : 80);
  const tone = sanitizeFlowText(step?.tone, kind === "decision" ? "primary" : "neutral").toLowerCase();
  const requirement = sanitizeFlowText(step?.requirement, "");
  const timing = shortenAtBoundary(step?.timing, 40, "");
  const options = Array.isArray(step?.options)
    ? step.options
        .slice(0, 4)
        .map((item, optionIndex) => ({
          title: shortenAtBoundary(item?.title || `선택 ${optionIndex + 1}`, 24, `선택 ${optionIndex + 1}`),
          detail: shortenAtBoundary(item?.detail, 58, ""),
          tone: sanitizeFlowText(item?.tone, "secondary"),
          requirement: sanitizeFlowText(item?.requirement, ""),
          timing: shortenAtBoundary(item?.timing, 34, "")
        }))
    : [];

  return { kind, title, detail, tone, requirement, timing, options };
}

function normalizeFlowData(flowData, docType) {
  const source = flowData && Array.isArray(flowData.steps) && flowData.steps.length ? flowData : getFallbackFlowData(docType);

  return {
    lead: shortenAtBoundary(source.lead || getFallbackFlowData(docType).lead, docType === "B" ? 78 : 96),
    steps: source.steps
      .slice(0, docType === "B" ? 6 : 8)
      .map((step, index) => normalizeFlowStepV2(step, index, docType))
  };
}

function requirementLabel(value) {
  const normalized = sanitizeText(value).toLowerCase();
  if (normalized === "required") return "필수";
  if (normalized === "optional") return "선택";
  if (normalized === "free") return "프리액션";
  if (normalized === "cleanup") return "정리";
  return "";
}

function buildFlowMetaBadges(requirement, timing) {
  const chips = [];
  const requirementText = requirementLabel(requirement);
  const timingText = sanitizeText(timing);

  if (requirementText) {
    chips.push(`<span class="action-flow-badge action-flow-badge--requirement">${escapeHtml(requirementText)}</span>`);
  }

  if (timingText) {
    chips.push(`<span class="action-flow-badge action-flow-badge--timing">${escapeHtml(timingText)}</span>`);
  }

  return chips.length ? `<div class="action-flow-step__meta">${chips.join("")}</div>` : "";
}

function renderFlowSteps(flowData) {
  return flowData.steps
    .map((item, index) => {
      const arrow =
        index === flowData.steps.length - 1
          ? ""
          : '<div class="action-flow-arrow action-flow-arrow--vertical" aria-hidden="true">↓</div>';

      if (item.kind === "branch") {
        const options = item.options
          .map(
            (option) => `
              <div class="action-flow-branch-option">
                ${buildFlowMetaBadges(option.requirement, option.timing)}
                <strong>${escapeHtml(option.title)}</strong>
                <p>${escapeHtml(option.detail)}</p>
              </div>
            `
          )
          .join("");

        return `
          <div class="action-flow-branch action-flow-branch--${escapeHtml(item.tone || "secondary")}">
            <div class="action-flow-branch__label">${escapeHtml(item.title)}</div>
            ${item.detail ? `<p class="action-flow-branch__detail">${escapeHtml(item.detail)}</p>` : ""}
            <div class="action-flow-branch__options">${options}</div>
          </div>
          ${arrow}
        `;
      }

      const extraClass =
        item.kind === "decision"
          ? "action-flow-node--decision"
          : item.kind === "merge"
            ? "action-flow-node--merge"
            : "";

      return `
        <div class="action-flow-node action-flow-node--${escapeHtml(item.tone || "neutral")} ${extraClass}">
          <div class="action-flow-step">
            ${buildFlowMetaBadges(item.requirement, item.timing)}
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.detail)}</p>
          </div>
        </div>
        ${arrow}
      `;
    })
    .join("");
}

function buildActionFlowSectionV2(docType, flowData) {
  const normalized = normalizeFlowData(flowData, docType);
  const title = docType === "B" ? "2-1. 플레이어 턴 흐름도 (간소화)" : "2-1. 플레이어 턴 흐름도";

  return [
    `<section class="action-flow-section">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<p class="action-flow-section__lead">${escapeHtml(normalized.lead)}</p>`,
    `<div class="action-flow action-flow--vertical">`,
    renderFlowSteps(normalized),
    `</div>`,
    `</section>`
  ].join("");
}

function ensureActionFlowSectionV2(html, docType, flowData) {
  if (/class=["'][^"']*action-flow-section/.test(html)) {
    return html.replace(
      /<section class="action-flow-section">[\s\S]*?<\/section>/i,
      buildActionFlowSectionV2(docType, flowData)
    );
  }

  const sectionHtml = buildActionFlowSectionV2(docType, flowData);
  const headingPatterns =
    docType === "B"
      ? ["플레이어 턴 흐름도 (간소화)", "핵심 행동 요약"]
      : ["플레이어 턴 흐름도", "핵심 행동 상세 설명"];

  const inserted = insertAfterHeading(html, headingPatterns, sectionHtml);
  return inserted === html ? `${html}${sectionHtml}` : inserted;
}

function buildSectionPlan(docType) {
  if (docType === "B") {
    return [
      {
        title: "셋업 참고 이미지",
        lead: "설명 전에 실제 배치 상태를 빠르게 확인할 수 있는 이미지만 넣습니다.",
        variant: "standard",
        maxCount: 1,
        minScore: 82,
        headingPatterns: ["셋업 체크리스트"],
        requiredBuckets: ["setup", "boards"]
      },
      {
        title: "핵심 아이콘 카드",
        lead: "설명 중 자주 가리키는 아이콘만 작은 카드 형태로 정리합니다.",
        variant: "icon",
        maxCount: 4,
        minScore: 86,
        headingPatterns: ["핵심 아이콘 카드"],
        requiredBuckets: ["icons"]
      },
      {
        title: "보드 위치 안내 이미지",
        lead: "설명자가 바로 가리킬 수 있는 위치 이미지가 있을 때만 넣습니다.",
        variant: "standard",
        maxCount: 1,
        minScore: 82,
        headingPatterns: ["보드 위치 안내"],
        requiredBuckets: ["boards", "setup"]
      }
    ];
  }

  return [
    {
      title: "셋업 참고 이미지",
      lead: "게임 준비와 시작 상태를 이해하는 데 직접 도움이 되는 이미지만 넣습니다.",
      variant: "standard",
        maxCount: 1,
        minScore: 82,
      headingPatterns: ["게임 준비와 시작 상태", "게임 준비 개요"],
      requiredBuckets: ["setup", "boards"]
    },
    {
      title: "점수/트랙 참고 이미지",
      lead: "점수 계산이나 트랙 연결을 빠르게 이해하는 데 도움이 되는 이미지만 넣습니다.",
      variant: "standard",
      maxCount: 1,
        minScore: 86,
      headingPatterns: ["자원·트랙·상태·위치의 연결", "점수/승리 조건 이해"],
      requiredBuckets: ["scoring", "boards"]
    },
    {
      title: "구성물 해설 이미지",
      lead: "구성물을 실제로 구분할 필요가 있을 때만 넣습니다.",
      variant: "standard",
        maxCount: 2,
        minScore: 84,
      headingPatterns: ["구성물 해설"],
      requiredBuckets: ["components"]
    },
    {
      title: "아이콘/기호 사전",
      lead: "아이콘 중심 게임일 때만 핵심 아이콘을 작게 정리합니다.",
      variant: "icon",
        maxCount: 4,
        minScore: 88,
      headingPatterns: ["아이콘/기호 사전"],
      requiredBuckets: ["icons"]
    },
    {
      title: "보드/개인판 구조 참고 이미지",
      lead: "보드 구조가 실제 이해에 중요할 때만 넣습니다.",
      variant: "standard",
        maxCount: 1,
        minScore: 86,
      headingPatterns: ["보드/개인판 구조 설명"],
      requiredBuckets: ["boards"]
    }
  ];
}

function buildSectionPlanV2(docType) {
  if (docType === "B") {
    return [
      {
        title: "보드 위치 안내 이미지",
        lead: "설명자가 실제 위치를 가리키기 쉬운 경우에만 이미지를 넣습니다.",
        variant: "standard",
        maxCount: 1,
        minScore: 84,
        headingPatterns: ["보드 위치 안내"],
        requiredBuckets: ["boards", "setup"]
      }
    ];
  }

  return [
    {
      title: "점수/트랙 참고 이미지",
      lead: "점수 흐름이나 트랙 연결을 이해하는 데 직접 도움이 될 때만 이미지를 넣습니다.",
      variant: "standard",
      maxCount: 1,
      minScore: 86,
      headingPatterns: ["자원", "트랙", "점수/승리 조건", "점수"],
      requiredBuckets: ["scoring", "boards"]
    },
    {
      title: "구성물 해설 이미지",
      lead: "실제로 구분이 필요한 구성물만 제한적으로 보여줍니다.",
      variant: "standard",
      maxCount: 1,
      minScore: 86,
      headingPatterns: ["구성물 해설"],
      requiredBuckets: ["components"]
    },
    {
      title: "보드 구조 참고 이미지",
      lead: "보드 구조를 글만으로 이해하기 어려울 때만 보조 이미지를 넣습니다.",
      variant: "standard",
      maxCount: 1,
      minScore: 88,
      headingPatterns: ["보드/개인판 구조 설명"],
      requiredBuckets: ["boards"]
    }
  ];
}

function pickItemsForPlan(plan, classified, usedGlobal = new Set()) {
  const selected = [];

  for (const bucket of plan.requiredBuckets) {
    const bucketItems = dedupeAndLimit(classified[bucket] || [], plan.maxCount * 2);
    for (const item of bucketItems) {
      if (usedGlobal.has(item.image.id)) {
        continue;
      }
      if ((item.score || 0) < (plan.minScore || 0)) {
        continue;
      }
      selected.push(item);
      usedGlobal.add(item.image.id);
      if (selected.length >= plan.maxCount) {
        return selected;
      }
    }
  }

  return selected;
}

function injectAutomaticGalleries(html, extraction, docType) {
  const plan = buildSectionPlanV2(docType);
  const classified = collectClassifiedImages(extraction);
  const usedGlobal = new Set();
  let result = html;

  for (const section of plan) {
    if (!containsHeading(result, section.headingPatterns)) {
      continue;
    }

    const items = pickItemsForPlan(section, classified, usedGlobal);
    if (!items.length) {
      continue;
    }

    const galleryHtml = buildGallerySection(section.title, section.lead, items, section.variant);
    result = insertAfterHeading(result, section.headingPatterns, galleryHtml);
  }

  return result;
}

function normalizeSectionNames(html) {
  return html
    .replace(/핵심 아이콘 카드/g, "핵심 아이콘 설명")
    .replace(/셋업 참고 이미지/g, "")
    .replace(/행동 위치 참고 이미지/g, "")
    .replace(/핵심 아이콘 설명\s*\/\s*설명 중 자주 가리키는 아이콘만 작은 카드 형태로 정리합니다\./g, "핵심 아이콘 설명")
    .replace(/셋업 참고 이미지\s*\/\s*설명 전에 실제 배치 상태를 빠르게 확인할 수 있는 이미지만 넣습니다\./g, "")
    .replace(/핵심 아이콘 카드\s*\/\s*설명 중 자주 가리키는 아이콘만 작은 카드 형태로 정리합니다\./g, "핵심 아이콘 설명");
}

function removeHelperCopy(html) {
  return html
    .replace(/<p[^>]*>[^<]*(참고 이미지|이미지만 넣습니다|작은 카드 형태|빠르게 확인할 수 있는 이미지만)[^<]*<\/p>/gi, "")
    .replace(/<li[^>]*>[^<]*(참고 이미지|이미지만 넣습니다|작은 카드 형태|빠르게 확인할 수 있는 이미지만)[^<]*<\/li>/gi, "");
}

function removeForbiddenGalleries(html, docType) {
  const forbidden =
    docType === "B"
      ? ["셋업 체크리스트", "핵심 아이콘 설명", "핵심 아이콘 카드", "플레이어 턴 흐름도 (간소화)"]
      : ["게임 준비와 시작 상태", "아이콘/기호 사전", "플레이어 턴 흐름도"];

  let result = html;
  for (const heading of forbidden) {
    const regex = new RegExp(
      `(<h[23][^>]*>[^<]*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^<]*<\\/h[23]>)([\\s\\S]*?)(<section class="auto-image-gallery[\\s\\S]*?<\\/section>)`,
      "i"
    );
    result = result.replace(regex, "$1$2");
  }

  return result;
}

function sectionShouldUseOrderedList(headingText) {
  return /게임 준비와 시작 상태|셋업 체크리스트/i.test(headingText);
}

function convertSectionParagraphsToOutline(sectionHtml) {
  if (/action-flow-section|auto-image-gallery/i.test(sectionHtml)) {
    return sectionHtml;
  }

  const headingMatch = sectionHtml.match(/<h[23][^>]*>(.*?)<\/h[23]>/i);
  if (!headingMatch) {
    return sectionHtml;
  }

  const headingText = stripTags(headingMatch[1]);
  const paragraphMatches = [...sectionHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  if (!paragraphMatches.length) {
    return sectionHtml;
  }

  const bulletLines = paragraphMatches
    .flatMap((match) => splitIntoBulletLines(stripTags(match[1])))
    .filter(Boolean)
    .filter((line) => !/(참고 이미지|이미지만 넣습니다|작은 카드 형태|빠르게 확인)/i.test(line));

  if (!bulletLines.length) {
    return sectionHtml.replace(/<p[^>]*>[\s\S]*?<\/p>/gi, "");
  }

  const listTag = sectionShouldUseOrderedList(headingText) ? "ol" : "ul";
  const listHtml = `<${listTag} class="playready-outline">${bulletLines
    .map((line) => `<li>${escapeHtml(completeSentence(line, line))}</li>`)
    .join("")}</${listTag}>`;

  return sectionHtml
    .replace(/<p[^>]*>[\s\S]*?<\/p>/gi, "")
    .replace(/(<h[23][^>]*>[\s\S]*?<\/h[23]>)/i, `$1${listHtml}`);
}

function convertHtmlToOutline(html) {
  return html.replace(/<section\b[^>]*>[\s\S]*?<\/section>/gi, (section) =>
    convertSectionParagraphsToOutline(section)
  );
}

export function injectImagesIntoHtml(html, extraction, docType = "A", flowData = null) {
  const images = extraction?.images || [];
  const withSlots = replaceImageSlots(html, images);
  const withActionFlow = ensureActionFlowSectionV2(withSlots, docType, flowData);
  const withNormalizedTitles = normalizeSectionNames(withActionFlow);
  const withOutline = convertHtmlToOutline(withNormalizedTitles);
  const withGalleries = injectAutomaticGalleries(withOutline, extraction, docType);
  const withoutForbiddenGalleries = removeForbiddenGalleries(withGalleries, docType);
  return removeHelperCopy(withoutForbiddenGalleries);
}
