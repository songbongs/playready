import { GEMINI_SYSTEM_PROMPT } from "../../config/constants.js";

function stripImageBase64(images = []) {
  return images.map((image) => ({
    id: image.id,
    page: image.page,
    bbox: image.bbox,
    mimeType: image.mimeType,
    nearestTextBlockId: image.nearestTextBlockId || null,
    sourceType: image.sourceType || "rulebook"
  }));
}

function buildSourceBundle(input) {
  return {
    gameName: input.gameName,
    bggId: input.bggId,
    pdfExtraction: {
      gameName: input.pdfExtraction?.gameName || input.gameName,
      pageCount: Number(input.pdfExtraction?.pageCount || 0),
      textBlocks: input.pdfExtraction?.textBlocks || [],
      images: stripImageBase64(input.pdfExtraction?.images || [])
    },
    faqExtraction: {
      gameName: input.faqExtraction?.gameName || input.gameName,
      pageCount: Number(input.faqExtraction?.pageCount || 0),
      textBlocks: input.faqExtraction?.textBlocks || [],
      images: stripImageBase64(input.faqExtraction?.images || [])
    },
    bggForumData: input.bggForumData || { forums: [] },
    additionalMaterials: input.additionalMaterials || []
  };
}

function buildPayload(userPrompt, maxOutputTokens) {
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
      temperature: 0.3,
      responseMimeType: "application/json",
      maxOutputTokens
    }
  };
}

export function buildGlossaryPayload(input) {
  const sources = buildSourceBundle(input);
  const prompt = [
    `게임 이름: ${sources.gameName}`,
    `BGG ID: ${sources.bggId}`,
    "",
    "아래 원본 자료를 바탕으로 문서 전체에서 공통으로 사용할 용어집만 JSON으로 작성하세요.",
    "반환 형식:",
    '{"glossary":[{"term":"","selectedKorean":"","source":"official|community|literal","note":""}]}',
    "",
    "주의:",
    "- PDF 추출 결과와 FAQ/정오표, BGG 포럼 데이터를 함께 참고하세요.",
    "- FAQ/정오표가 룰북과 다르면 FAQ/정오표를 우선하세요.",
    "- 용어는 최대 40개까지 허용합니다.",
    "",
    `원본 자료: ${JSON.stringify(sources)}`
  ].join("\n");

  return buildPayload(prompt, 8192);
}

export function buildDocumentPayload(input, glossary, documentType) {
  const sources = buildSourceBundle(input);
  const targetPrompt =
    documentType === "A"
      ? "문서 A를 HTML로 작성하세요. 반드시 게임 목표, 구성물, 턴 순서, 핵심 메커니즘, 예외 규칙, BGG 유저 FAQ, 전략 팁을 포함하세요."
      : "문서 B를 HTML로 작성하세요. 반드시 소개 스크립트, 셋업 체크리스트, 첫 라운드 진행 가이드, 자주 헷갈리는 규칙 Q&A, 요약 참조 카드, 용어집을 포함하세요.";

  const prompt = [
    `게임 이름: ${sources.gameName}`,
    `BGG ID: ${sources.bggId}`,
    "",
    targetPrompt,
    "반환 형식:",
    '{"documentHtml":"<section>...</section>"}',
    "",
    "주의:",
    "- 확정 용어집을 반드시 따르세요.",
    "- FAQ/정오표가 제공되면 룰북보다 우선합니다.",
    '- FAQ/정오표에서 수정된 내용은 "※ 정오표 반영" 표시를 붙이세요.',
    "- 이미지가 필요한 위치에는 [IMAGE_SLOT:image-id] 토큰을 넣으세요.",
    "- 입력 자료에 없는 사실은 추가하지 마세요.",
    "- BGG 내용은 '커뮤니티 의견'과 '디자이너 공식 답변'을 구분하세요.",
    "- 불확실한 내용은 '확인 필요'라고 표시하세요.",
    "",
    `확정 용어집: ${JSON.stringify(glossary || [])}`,
    `원본 자료: ${JSON.stringify(sources)}`
  ].join("\n");

  return buildPayload(prompt, 65536);
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
