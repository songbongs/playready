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

function stripHtml(value) {
  return sanitizeText(
    String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|li|div|h2|h3|h4|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
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
  const aspectRatio = width && height ? width / height : pixelWidth && pixelHeight ? pixelWidth / pixelHeight : 1;

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
    setup: "세팅 참고 이미지",
    icons: "아이콘 참고 이미지",
    boards: "보드 참고 이미지",
    scoring: "점수 계산 참고 이미지"
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
  const looksLikeBoard = metrics.areaRatio >= 0.14 || metrics.aspectRatio >= 1.18;

  if (
    looksLikeIcon ||
    matchAny(context, ["아이콘", "기호", "효과", "symbol", "icon", "작업", "행동", "자원 획득"])
  ) {
    return {
      bucket: "icons",
      image,
      caption: inferCaption("icons", block, image),
      score: looksLikeIcon ? 95 : 78
    };
  }

  if (
    matchAny(context, ["점수", "정산", "건물 점수", "트랙 점수", "게임 종료", "scoring", "score"])
  ) {
    return {
      bucket: "scoring",
      image,
      caption: inferCaption("scoring", block, image),
      score: looksLikeBoard ? 82 : 68
    };
  }

  if (
    matchAny(context, ["구성물", "컴포넌트", "materials", "components", "자원", "토큰", "카드", "타일"]) &&
    metrics.areaRatio <= 0.38
  ) {
    return {
      bucket: "components",
      image,
      caption: inferCaption("components", block, image),
      score: 82 - Math.min(metrics.areaRatio * 100, 28)
    };
  }

  if (
    matchAny(context, ["세팅", "준비", "배치", "setup", "set up", "공용 준비", "개인 준비", "첫 라운드"])
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
    matchAny(context, ["보드", "개인 보드", "메인 보드", "공용 보드", "트랙", "player board", "main board"])
  ) {
    return {
      bucket: "boards",
      image,
      caption: inferCaption("boards", block, image),
      score: looksLikeBoard ? 86 : 72
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
  if (headingText) {
    return html.replace(headingText, `${headingText}${sectionHtml}`);
  }

  return html;
}

function buildSectionPlan(docType) {
  if (docType === "B") {
    return [
      {
        title: "게임 소개 참고 이미지",
        lead: "첫 30초 소개 때 바로 보여주기 좋은 대표 이미지입니다.",
        variant: "standard",
        maxCount: 1,
        headingPatterns: ["30초 게임 소개 멘트"],
        primaryBuckets: ["boards", "components"]
      },
      {
        title: "셋업 참고 이미지",
        lead: "설명 전에 보드를 어떻게 펼쳐 놓는지 바로 확인할 수 있게 정리했습니다.",
        variant: "standard",
        maxCount: 2,
        headingPatterns: ["셋업 체크리스트"],
        primaryBuckets: ["setup", "boards"]
      },
      {
        title: "행동 선택 보드 참고",
        lead: "세 가지 행동이 보드에서 어디와 연결되는지 빠르게 보여주는 이미지입니다.",
        variant: "standard",
        maxCount: 2,
        headingPatterns: ["턴 흐름도", "3가지 행동", "3-1", "3-2"],
        primaryBuckets: ["boards", "setup"]
      },
      {
        title: "핵심 아이콘 사전",
        lead: "설명 중 가장 자주 보는 아이콘만 작은 카드 형태로 정리했습니다.",
        variant: "icon",
        maxCount: 8,
        headingPatterns: ["핵심 아이콘 사전"],
        primaryBuckets: ["icons"]
      },
      {
        title: "점수 계산 참고 이미지",
        lead: "게임 종료 점수 계산 순서를 설명할 때 함께 보여줄 수 있는 이미지입니다.",
        variant: "standard",
        maxCount: 2,
        headingPatterns: ["게임 종료 점수 계산 순서 카드", "점수 계산"],
        primaryBuckets: ["scoring", "boards"]
      }
    ];
  }

  return [
    {
      title: "게임 전반 참고 이미지",
      lead: "이 게임이 어떤 보드와 구조로 진행되는지 처음부터 감을 잡을 수 있게 대표 이미지를 배치했습니다.",
      variant: "standard",
      maxCount: 2,
      headingPatterns: ["게임 정체성 파악"],
      primaryBuckets: ["boards", "components"]
    },
    {
      title: "구성물 완전 해설 이미지",
      lead: "공용 구성물과 개인 구성물을 비교해서 보기 쉽게 대표 이미지를 정리했습니다.",
      variant: "standard",
      maxCount: 4,
      headingPatterns: ["구성물 완전 해설"],
      primaryBuckets: ["components"]
    },
    {
      title: "준비 단계 참고 이미지",
      lead: "공용 준비와 플레이어별 준비를 실제 배치 예시로 확인할 수 있게 모았습니다.",
      variant: "standard",
      maxCount: 3,
      headingPatterns: ["게임 준비 단계별 가이드"],
      primaryBuckets: ["setup", "boards"]
    },
    {
      title: "턴 진행 보드 참고 이미지",
      lead: "작업 보드와 주요 선택 지점을 한눈에 볼 수 있도록 대표 이미지를 넣었습니다.",
      variant: "standard",
      maxCount: 2,
      headingPatterns: ["턴 진행 완전 흐름도", "3가지 행동 상세"],
      primaryBuckets: ["boards", "setup"]
    },
    {
      title: "작업 아이콘 완전 백과",
      lead: "작업 아이콘을 다시 찾아보기 쉽게 작은 참조 카드 형태로 정리했습니다.",
      variant: "icon",
      maxCount: 10,
      headingPatterns: ["작업 아이콘 완전 백과"],
      primaryBuckets: ["icons"]
    },
    {
      title: "트랙과 보드 구조 참고 이미지",
      lead: "핵심 트랙이 개인 보드에서 어떻게 연결되는지 보기 쉽게 대표 이미지로 정리했습니다.",
      variant: "standard",
      maxCount: 2,
      headingPatterns: ["4가지 핵심 트랙 연동 구조"],
      primaryBuckets: ["boards", "scoring"]
    },
    {
      title: "점수 계산 참고 이미지",
      lead: "최종 점수 계산에 관련된 보드와 트랙 이미지를 같이 볼 수 있게 정리했습니다.",
      variant: "standard",
      maxCount: 2,
      headingPatterns: ["점수 계산 완전 가이드"],
      primaryBuckets: ["scoring", "boards"]
    }
  ];
}

function pickItemsForPlan(plan, classified) {
  const selected = [];
  const used = new Set();

  for (const bucket of plan.primaryBuckets) {
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

function injectAutomaticGalleries(html, extraction, docType) {
  const plan = buildSectionPlan(docType);
  const classified = collectClassifiedImages(extraction);
  let result = html;

  for (const section of plan) {
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
      { title: "내 차례 시작", detail: "차례 시작 효과와 현재 목표 달성 가능 여부를 먼저 확인합니다.", tone: "neutral" },
      { title: "행동 1가지 선택", detail: "① 작업 배치 / ② 기술자 승급 / ③ 패스 중 하나를 고릅니다.", tone: "primary" },
      { title: "효과 처리", detail: "선택한 행동의 비용, 보상, 배치, 이동을 바로 처리합니다.", tone: "secondary" },
      { title: "추가 목표 달성 여부 확인", detail: "차례 끝낼 때 임무나 목표를 추가로 달성할 수 있는지 확인합니다.", tone: "warning" },
      { title: "내 차례 종료", detail: "다음 플레이어에게 차례를 넘기고, 모두 패스했으면 라운드 종료를 확인합니다.", tone: "neutral" }
    ];
  }

  return [
    { title: "내 차례 시작", detail: "차례 시작 시 발동 효과와 목표 달성 가능 여부를 먼저 확인합니다.", tone: "neutral" },
    { title: "목표 달성 가능? (선택)", detail: "임무 카드 완료 또는 설계도 타일 완료가 가능하면 차례 시작 시 1회 처리합니다.", tone: "warning" },
    { title: "3가지 행동 중 하나 선택", detail: "① 작업 배치 / ② 기술자 승급 / ③ 패스 중 하나를 반드시 고릅니다.", tone: "primary" },
    { title: "① 작업 배치", detail: "휴식 구역의 기술자 1명을 연결된 작업 칸에 배치하고 즉시 효과를 수행합니다.", tone: "secondary" },
    { title: "② 기술자 승급", detail: "기술자 1명을 1~2단계 높은 휴식 구역으로 올리고 필요한 연료를 지불합니다.", tone: "secondary" },
    { title: "③ 패스", detail: "이번 라운드의 내 차례를 끝내고 다음 라운드까지 기다립니다.", tone: "secondary" },
    { title: "IV단계 / 빠른 배치 추가 처리", detail: "IV단계 작업이면 특수 처리와 기술자 복귀를, 빠른 배치면 추가 비용과 즉시 배치를 확인합니다.", tone: "warning" },
    { title: "목표 달성 가능? (선택)", detail: "차례를 끝내기 전에도 임무 카드 또는 설계도 타일 완료를 1회 처리할 수 있습니다.", tone: "warning" },
    { title: "라운드 종료 조건 확인", detail: "모든 플레이어가 패스했거나 모든 기술자를 사용했는지 확인합니다.", tone: "neutral" },
    { title: "종료 아님 / 라운드 종료", detail: "조건 미충족이면 다음 플레이어 차례, 충족이면 라운드 종료 처리로 넘어갑니다.", tone: "neutral" }
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

function buildActionFlowSection(docType) {
  const title = docType === "B" ? "3-1. 간소화 턴 흐름도" : "4-1. 플레이어 턴 흐름도 (상세 버전)";
  const lead =
    docType === "B"
      ? "처음 설명할 때 바로 보여줄 수 있도록, 내 차례가 위에서 아래로 어떻게 흘러가는지 간단히 정리했습니다."
      : "혼자 공부할 때도 흐름을 놓치지 않도록, 내 차례의 선택과 후속 처리를 위에서 아래로 따라가며 볼 수 있게 정리했습니다.";

  return [
    `<section class="action-flow-section">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<p class="action-flow-section__lead">${escapeHtml(lead)}</p>`,
    `<div class="action-flow action-flow--vertical">`,
    buildVerticalActionFlow(buildActionFlowSteps(docType)),
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
      ? ["핵심: 간략 턴 흐름도", "간소화 턴 흐름도", "3가지 행동 요약"]
      : ["턴 진행 완전 흐름도", "3가지 행동 상세", "플레이어 턴 흐름도"];

  const inserted = insertAfterHeading(html, headingPatterns, sectionHtml);
  return inserted === html ? `${html}${sectionHtml}` : inserted;
}

function replaceHeadingText(html, fromPatterns, toText) {
  for (const pattern of fromPatterns) {
    const regex = new RegExp(`(<h2[^>]*>)([^<]*${pattern}[^<]*)(<\\/h2>)`, "i");
    if (regex.test(html)) {
      return html.replace(regex, `$1${toText}$3`);
    }
  }
  return html;
}

function normalizeDocumentStructureHtml(html, docType) {
  const replacements =
    docType === "B"
      ? [
          [["30초 게임 소개 멘트"], "1. 30초 게임 소개 멘트"],
          [["셋업 체크리스트"], "2. 셋업 체크리스트 (플레이어 수별)"],
          [["턴 흐름", "3가지 행동"], "3. ★ 핵심: 간략 턴 흐름도 + 3가지 행동 요약"],
          [["첫 라운드", "실황 스크립트"], "4. 첫 라운드 실황 스크립트"],
          [["핵심 아이콘 사전", "아이콘 사전"], "5. 핵심 아이콘 사전 (이미지 중심)"],
          [["자주 헷갈리는 규칙", "Q&A"], "6. 자주 헷갈리는 규칙 Q&A (5~8개)"],
          [["라운드 종료", "체크리스트"], "7. 라운드 종료 체크리스트 (빠른 확인용)"],
          [["점수 계산", "순서 카드"], "8. 게임 종료 점수 계산 순서 카드"],
          [["공식 용어 사전", "용어 사전"], "9. 용어 사전 (공식 한국어 표기 기준)"]
        ]
      : [
          [["게임 정체성 파악"], "1. 게임 정체성 파악 (1페이지)"],
          [["구성물 완전 해설"], "2. 구성물 완전 해설 (이미지 집중)"],
          [["게임 준비 단계별 가이드", "게임 준비"], "3. 게임 준비 단계별 가이드 (플레이어 수별)"],
          [["턴 진행", "3가지 행동"], "4. ★ 핵심: 턴 진행 흐름도 + 3가지 행동 상세 해설"],
          [["작업 아이콘 완전 백과", "아이콘 완전 백과"], "5. 작업 아이콘 완전 백과"],
          [["핵심 트랙", "트랙 연동"], "6. 4가지 핵심 트랙 연동 구조"],
          [["통신기", "타일"], "7. 통신기 타일 3종류 완전 해설"],
          [["라운드 종료"], "8. 라운드 종료 처리 6단계 체크리스트"],
          [["점수 계산"], "9. 점수 계산 완전 가이드 (수식 포함)"],
          [["공식 FAQ", "애매한 규칙", "정오표"], "10. ★ 애매한 규칙 완전 정리 (Q&A + 정오표)"],
          [["1인 게임", "크라켄"], "11. 1인 게임 (크라켄) 특별 가이드"]
        ];

  return replacements.reduce(
    (currentHtml, [patterns, target]) => replaceHeadingText(currentHtml, patterns, target),
    html
  );
}

export function injectImagesIntoHtml(html, extraction, docType = "A") {
  const images = extraction?.images || [];
  const withSlots = replaceImageSlots(html, images);
  const normalized = normalizeDocumentStructureHtml(withSlots, docType);
  const withActionFlow = ensureActionFlowSection(normalized, docType);
  return injectAutomaticGalleries(withActionFlow, extraction, docType);
}
