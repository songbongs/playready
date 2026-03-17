import { GEMINI_SYSTEM_PROMPT } from "../../config/constants.js";

function truncateText(text, maxLength) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[생략]`;
}

function summarizePdfExtraction(pdfExtraction) {
  const textBlocks = Array.isArray(pdfExtraction?.textBlocks) ? pdfExtraction.textBlocks : [];
  const images = Array.isArray(pdfExtraction?.images) ? pdfExtraction.images : [];

  return {
    pageCount: Number(pdfExtraction?.pageCount || 0),
    textHighlights: textBlocks.slice(0, 8).map((block) => ({
      page: block.page,
      heading: block.heading || "",
      summary: truncateText(block.text, 180)
    })),
    imageAnchors: images.slice(0, 5).map((image) => ({
      id: image.id,
      page: image.page,
      near: image.nearestTextBlockId || ""
    }))
  };
}

function summarizeBggForumData(bggForumData) {
  const forums = Array.isArray(bggForumData?.forums) ? bggForumData.forums : [];
  const highlights = [];

  for (const forum of forums.slice(0, 2)) {
    for (const thread of (forum.threads || []).slice(0, 2)) {
      const point = (thread.comments || [])
        .slice(0, 1)
        .map((comment) => ({
          type: comment.isDesignerReply ? "designer" : "community",
          language: comment.language,
          text: truncateText(comment.body || comment.subject, 140)
        }))[0];

      if (point) {
        highlights.push({
          forum: forum.title || "",
          subject: truncateText(thread.subject || "", 80),
          point
        });
      }
    }
  }

  return {
    warning: bggForumData?.warning || null,
    highlights: highlights.slice(0, 4)
  };
}

function summarizeAdditionalMaterials(additionalMaterials) {
  return (additionalMaterials || []).slice(0, 1).map((item) => ({
    fileName: item.fileName,
    summary: truncateText(item.textContent || "", 300)
  }));
}

function buildSourceBundle(input) {
  return {
    gameName: input.gameName,
    bggId: input.bggId,
    pdf: summarizePdfExtraction(input.pdfExtraction),
    bgg: summarizeBggForumData(input.bggForumData),
    extras: summarizeAdditionalMaterials(input.additionalMaterials)
  };
}

function applySourceScope(sourceBundle, scope = "full") {
  if (scope === "no-bgg") {
    return {
      ...sourceBundle,
      bgg: { warning: "BGG 데이터는 입력 한도 문제로 제외되었습니다.", highlights: [] }
    };
  }

  if (scope === "no-bgg-no-extras") {
    return {
      ...sourceBundle,
      bgg: { warning: "BGG 데이터는 입력 한도 문제로 제외되었습니다.", highlights: [] },
      extras: []
    };
  }

  if (scope === "minimal-only") {
    return {
      gameName: sourceBundle.gameName,
      bggId: sourceBundle.bggId,
      pdf: { pageCount: 0, textHighlights: [], imageAnchors: [] },
      bgg: { warning: "BGG 데이터는 입력 한도 문제로 제외되었습니다.", highlights: [] },
      extras: []
    };
  }

  return sourceBundle;
}

function buildPayload(userPrompt, maxOutputTokens = 4096) {
  return {
    systemInstruction: {
      parts: [{ text: GEMINI_SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      maxOutputTokens
    }
  };
}

export function buildGlossaryPayload(input, scope = "full") {
  const sources = applySourceScope(buildSourceBundle(input), scope);
  const prompt = [
    `게임 이름: ${sources.gameName}`,
    `BGG ID: ${sources.bggId}`,
    "",
    "아래 요약 자료를 바탕으로 문서 전체에 공통으로 쓸 용어집만 JSON으로 작성하세요.",
    "반환 형식:",
    '{"glossary":[{"term":"","selectedKorean":"","source":"official|community|literal","note":""}]}',
    "",
    "규칙:",
    "- 용어는 최대 20개까지만 고르세요.",
    "- 가장 중요한 게임 용어만 남기세요.",
    "- 모르면 note에 '확인 필요'를 넣으세요.",
    "",
    `자료: ${JSON.stringify(sources)}`
  ].join("\n");

  return buildPayload(prompt, 2048);
}

export function buildDocumentPayload(input, glossary, documentType, scope = "full") {
  const sources = applySourceScope(buildSourceBundle(input), scope);
  const target =
    documentType === "A"
      ? "문서 A를 HTML로 작성하세요. 포함 항목: 게임 목표, 구성물, 턴 순서, 핵심 메커니즘, 예외 규칙, BGG 유저 FAQ, 전략 팁."
      : "문서 B를 HTML로 작성하세요. 포함 항목: 소개 스크립트, 셋업 체크리스트, 첫 라운드 진행 가이드, 자주 헷갈리는 규칙 Q&A, 요약 참조 카드, 용어집.";

  const prompt = [
    `게임 이름: ${sources.gameName}`,
    `BGG ID: ${sources.bggId}`,
    "",
    target,
    "반환 형식:",
    documentType === "A"
      ? '{"documentHtml":"<section>...</section>"}'
      : '{"documentHtml":"<section>...</section>"}',
    "",
    "규칙:",
    "- 반드시 HTML만 담긴 JSON으로 반환하세요.",
    "- 이미지가 필요한 위치에는 [IMAGE_SLOT:image-id] 토큰을 사용하세요.",
    "- 입력 자료에 없는 내용은 추가하지 마세요.",
    "- BGG 내용은 '커뮤니티 의견'과 '디자이너 공식 답변'을 구분하세요.",
    "- 불확실한 내용은 '확인 필요'라고 표시하세요.",
    "",
    `확정 용어집: ${JSON.stringify(glossary || [])}`,
    `자료: ${JSON.stringify(sources)}`
  ].join("\n");

  return buildPayload(prompt, 4096);
}

export function parseGeminiJsonResponse(result) {
  const text =
    result?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned);
}
