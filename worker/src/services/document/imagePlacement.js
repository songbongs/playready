function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildImageTag(image, caption) {
  const sourceLabel = image.sourceType === "faq" ? "FAQ/정오표" : "룰북";
  const alt = escapeHtml(`${sourceLabel} ${image.page}페이지 이미지`);
  const safeCaption = escapeHtml(caption || `${sourceLabel} ${image.page}페이지`);

  return [
    `<figure class="auto-image-card" data-image-id="${escapeHtml(image.id)}">`,
    `<img src="data:${image.mimeType};base64,${image.base64}" alt="${alt}" loading="lazy" />`,
    `<figcaption>${safeCaption}</figcaption>`,
    `</figure>`
  ].join("");
}

function replaceImageSlots(html, images) {
  return html.replace(/\[IMAGE_SLOT:([^\]]+)\]/g, (_, imageId) => {
    const image = images.find((item) => item.id === imageId);
    return image ? buildImageTag(image, `${image.sourceType === "faq" ? "FAQ/정오표" : "룰북"} ${image.page}페이지`) : "";
  });
}

function buildTextBlockMap(extraction) {
  return new Map((extraction?.textBlocks || []).map((block) => [block.id, block]));
}

function matchAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function classifyImage(image, textBlockMap) {
  const block = textBlockMap.get(image.nearestTextBlockId);
  const context = normalize(`${block?.heading || ""} ${block?.text || ""}`);

  if (!context) {
    return null;
  }

  if (matchAny(context, ["아이콘", "icon", "기호", "심볼", "작업 아이콘"])) {
    return {
      bucket: "icons",
      caption: `${block?.heading || "주요 아이콘"} | ${image.sourceType === "faq" ? "FAQ/정오표" : "룰북"} ${image.page}페이지`
    };
  }

  if (matchAny(context, ["구성물", "컴포넌트", "components", "materials"])) {
    return {
      bucket: "components",
      caption: `${block?.heading || "구성물"} | ${image.sourceType === "faq" ? "FAQ/정오표" : "룰북"} ${image.page}페이지`
    };
  }

  if (matchAny(context, ["준비", "세팅", "setup", "set up", "배치", "개인 준비", "공용 준비"])) {
    return {
      bucket: "setup",
      caption: `${block?.heading || "세팅 참고"} | ${image.sourceType === "faq" ? "FAQ/정오표" : "룰북"} ${image.page}페이지`
    };
  }

  if (matchAny(context, ["개인 보드", "메인 보드", "작업 보드", "player board", "main board", "board"])) {
    return {
      bucket: "boards",
      caption: `${block?.heading || "보드 참고"} | ${image.sourceType === "faq" ? "FAQ/정오표" : "룰북"} ${image.page}페이지`
    };
  }

  return null;
}

function uniqueImages(items, maxCount = 6) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (!item?.image?.id || seen.has(item.image.id)) {
      continue;
    }
    seen.add(item.image.id);
    result.push(item);
    if (result.length >= maxCount) {
      break;
    }
  }

  return result;
}

function buildGallerySection(title, lead, items) {
  if (!items.length) {
    return "";
  }

  const cards = items
    .map((item) => buildImageTag(item.image, item.caption))
    .join("");

  return [
    `<section class="auto-image-gallery">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<p>${escapeHtml(lead)}</p>`,
    `<div class="auto-image-grid">${cards}</div>`,
    `</section>`
  ].join("");
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

function buildAutomaticSections(extraction) {
  const textBlockMap = buildTextBlockMap(extraction);
  const classified = {
    components: [],
    setup: [],
    icons: [],
    boards: []
  };

  for (const image of extraction?.images || []) {
    const result = classifyImage(image, textBlockMap);
    if (!result) {
      continue;
    }
    classified[result.bucket].push({
      image,
      caption: result.caption
    });
  }

  return {
    components: buildGallerySection(
      "주요 구성물 이미지",
      "룰북과 FAQ에서 구성물 설명 근처에 있던 이미지를 자동으로 모았습니다.",
      uniqueImages(classified.components)
    ),
    setup: buildGallerySection(
      "세팅 참고 이미지",
      "공용 준비와 개인 준비를 이해하기 쉬운 이미지를 자동으로 정리했습니다.",
      uniqueImages(classified.setup)
    ),
    icons: buildGallerySection(
      "주요 아이콘 모음",
      "아이콘 설명이나 작업 아이콘 근처에 있던 이미지를 자동으로 정리했습니다.",
      uniqueImages(classified.icons)
    ),
    boards: buildGallerySection(
      "개인 보드/공용 보드 예시",
      "보드 설명 근처에 있던 이미지를 자동으로 모아 빠르게 참고할 수 있게 했습니다.",
      uniqueImages(classified.boards)
    )
  };
}

function injectAutomaticGalleries(html, extraction) {
  const sections = buildAutomaticSections(extraction);
  let result = html;

  result = insertAfterHeading(result, ["구성물", "components", "materials"], sections.components);
  result = insertAfterHeading(result, ["준비", "세팅", "setup"], sections.setup);
  result = insertAfterHeading(result, ["아이콘", "icon", "기호"], sections.icons);
  result = insertAfterHeading(result, ["보드", "player board", "main board"], sections.boards);

  return result;
}

export function injectImagesIntoHtml(html, extraction) {
  const images = extraction?.images || [];
  const withManualSlots = replaceImageSlots(html, images);
  return injectAutomaticGalleries(withManualSlots, extraction);
}
