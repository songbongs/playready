import { GEMINI_SYSTEM_PROMPT } from "../../config/constants.js";

function stripImageBase64(images = []) {
  return images.map((image) => ({
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

function buildPayload(userPrompt, maxOutputTokens, responseSchema) {
  const generationConfig = {
    temperature: 0.3,
    responseMimeType: "application/json",
    maxOutputTokens
  };

  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }

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
    generationConfig
  };
}

export function buildGlossaryPayload(input) {
  const sources = buildSourceBundle(input);
  const prompt = [
    `게임 이름: ${sources.gameName}`,
    `BGG ID: ${sources.bggId}`,
    "",
    "아래 자료를 바탕으로 문서 전체에서 공통으로 사용할 용어집만 JSON으로 작성하세요.",
    "반환 형식:",
    '{"glossary":[{"term":"","selectedKorean":"","source":"official|community|literal","note":""}]}',
    "",
    "주의:",
    "- PDF 추출 결과, FAQ/정오표, BGG 포럼과 게임 기본 정보를 함께 참고하세요.",
    "- FAQ/정오표가 룰북과 다르면 FAQ/정오표를 우선하세요.",
    "- 용어는 최대 40개까지만 정리합니다.",
    "- 실제 문서에 반복 등장할 핵심 용어만 추립니다.",
    "",
    `원본 자료: ${JSON.stringify(sources)}`
  ].join("\n");

  return buildPayload(prompt, 8192, {
    type: "OBJECT",
    properties: {
      glossary: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            term: { type: "STRING" },
            selectedKorean: { type: "STRING" },
            source: { type: "STRING" },
            note: { type: "STRING" }
          },
          required: ["term", "selectedKorean", "source", "note"]
        }
      }
    },
    required: ["glossary"]
  });
}

function buildDocumentAStructurePrompt() {
  return [
    "문서 A는 개인 학습 가이드입니다.",
    "playready_document_structure_v2.1.md 기준으로 아래 구조를 가능한 한 그대로 유지해서 HTML로 작성하세요.",
    "최상위 섹션은 h2로 작성합니다.",
    "",
    "문서 A 구조:",
    "1. 게임 개요",
    "2. 플레이어 턴 흐름도",
    "3. 핵심 행동 상세 설명",
    "4. 게임 준비와 시작 상태",
    "5. 자원·보드·트랙·상태 연결",
    "6. 라운드 종료와 게임 종료",
    "7. 점수/승리 조건 이해",
    "8. 자주 헷갈리는 규칙 정리",
    "",
    "문서 A 조건부 섹션:",
    "- 구성물 해설",
    "- 아이콘/기호 사전",
    "- 목표/임무/카드 시스템",
    "- 플레이어 간 상호작용",
    "- 특수 모드",
    "",
    "문서 A 작성 규칙:",
    "- 위 1~8번 고정 섹션은 모두 작성하세요.",
    "- 조건부 섹션은 해당 자료가 있을 때만 추가하세요.",
    "- 규칙을 다시 베끼지 말고 공부용 요약과 연결 구조를 설명하세요.",
    "- 세부 수량표나 구성물 개수는 최소화하고 역할 중심으로 정리하세요.",
    "- FAQ/정오표가 있으면 반드시 우선 반영하세요.",
    "- '2. 플레이어 턴 흐름도' 섹션에는 반드시 <section class=\"action-flow-section\">를 포함하세요.",
    "- 흐름도는 반드시 <div class=\"action-flow action-flow--vertical\"> 구조를 사용하세요.",
    "- 흐름도는 반드시 위에서 아래로 흘러야 하며, 가로형 흐름도는 금지합니다.",
    "- 흐름도는 도형 박스, 화살표, 분기, 분기 후 재합류가 보이게 작성하세요.",
    "- 최소한 다음 단계가 보여야 합니다: 내 차례 시작 -> 현재 상태/시작 효과 확인 -> 선택 가능한 행동 또는 결정 지점 -> 행동 선택 -> 행동 효과 처리 -> 추가 처리/예외 확인 -> 종료 조건 확인 -> 다음 플레이어 또는 라운드 종료.",
    "- 행동이 2개 이상이면 반드시 분기 형태로 표현하세요.",
    "- 각 박스 안에는 제목 1줄과 설명 1~2줄만 넣고 장문 설명은 금지합니다.",
    "- 예외 규칙은 흐름도 안에 길게 넣지 말고 흐름도 아래 본문에서 설명하세요.",
    "- HTML만 반환하고 markdown 코드블록은 쓰지 마세요."
  ].join("\n");
}

function buildDocumentBStructurePrompt() {
  return [
    "문서 B는 설명 보조용 자료입니다.",
    "playready_document_structure_v2.1.md 기준으로 아래 구조를 가능한 한 그대로 유지해서 HTML로 작성하세요.",
    "최상위 섹션은 h2로 작성합니다.",
    "",
    "문서 B 구조:",
    "1. 30초 소개 멘트",
    "2. 플레이어 턴 흐름도 (간소화)",
    "3. 핵심 행동 요약",
    "4. 첫 라운드 설명 스크립트",
    "5. 자주 헷갈리는 질문",
    "6. 라운드 종료 / 게임 종료 체크리스트",
    "7. 용어 / 참조 카드",
    "",
    "문서 B 조건부 섹션:",
    "- 셋업 체크리스트",
    "- 핵심 아이콘 카드",
    "- 보드 위치 안내",
    "- 장르별 특수 규칙 요약",
    "- 모드별 보충 설명",
    "",
    "문서 B 작성 규칙:",
    "- 위 1~7번 고정 섹션은 모두 작성하세요.",
    "- 조건부 섹션은 실제 설명에 도움이 될 때만 추가하세요.",
    "- 설명자가 그대로 읽거나 보여주기 쉽게 짧고 직관적으로 쓰세요.",
    "- '2. 플레이어 턴 흐름도 (간소화)' 섹션에는 반드시 <section class=\"action-flow-section\">를 포함하세요.",
    "- 흐름도는 반드시 <div class=\"action-flow action-flow--vertical\"> 구조를 사용하세요.",
    "- 흐름도는 반드시 위에서 아래로 흘러야 하며, 가로형 흐름도는 금지합니다.",
    "- 흐름도는 도형 박스, 화살표, 분기, 분기 후 재합류가 보이게 작성하세요.",
    "- 최소한 다음 단계가 보여야 합니다: 내 차례 시작 -> 가능한 행동 확인 -> 행동 1개 선택 -> 효과 처리 -> 종료 확인 -> 다음 플레이어 또는 라운드 종료.",
    "- 분기는 있더라도 2~3개 선택지 정도로 단순하게 유지하세요.",
    "- 각 박스 안에는 제목 1줄과 설명 1~2줄만 넣고 긴 문단은 금지합니다.",
    "- B문서 흐름도는 A문서보다 더 짧고 직관적이어야 합니다.",
    "- HTML만 반환하고 markdown 코드블록은 쓰지 마세요."
  ].join("\n");
}

export function buildDocumentPayload(input, glossary, documentType) {
  const sources = buildSourceBundle(input);
  const structurePrompt =
    documentType === "A" ? buildDocumentAStructurePrompt() : buildDocumentBStructurePrompt();

  const prompt = [
    `게임 이름: ${sources.gameName}`,
    `BGG ID: ${sources.bggId}`,
    "",
    structurePrompt,
    "",
    "반환 형식:",
    '{"documentHtml":"<section>...</section>"}',
    "",
    "공통 작성 규칙:",
    "- 확정 용어집을 반드시 일관되게 사용하세요.",
    "- FAQ/정오표가 제공되면 룰북보다 우선합니다.",
    '- FAQ/정오표에서 수정된 규칙은 반드시 "※ 정오표 반영" 표시를 붙이세요.',
    "- 입력 자료에 없는 사실은 추가하지 마세요.",
    "- BGG 내용은 '커뮤니티 의견'과 '디자이너 공식 답변'을 구분하세요.",
    "- 불확실한 내용은 '확인 필요'로 표시하세요.",
    "- 이미지나 아이콘 관련 섹션은 자료가 있을 때만 만들고, 없으면 생략하세요.",
    `확정 용어집: ${JSON.stringify(glossary || [])}`,
    `원본 자료: ${JSON.stringify(sources)}`
  ].join("\n\n");

  return buildPayload(prompt, 65536, {
    type: "OBJECT",
    properties: {
      documentHtml: { type: "STRING" }
    },
    required: ["documentHtml"]
  });
}

export function parseGeminiJsonResponse(result) {
  const candidate = result?.candidates?.[0] || {};
  const finishReason = String(candidate?.finishReason || "");
  const text = candidate?.content?.parts?.map((part) => part.text || "").join("") || "";
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!cleaned) {
    const error = new Error("empty gemini response");
    error.code = finishReason === "MAX_TOKENS" ? "GEMINI_OUTPUT_TOO_LARGE" : "GEMINI_EMPTY_RESPONSE";
    error.finishReason = finishReason;
    throw error;
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    const objectStart = cleaned.indexOf("{");
    const objectEnd = cleaned.lastIndexOf("}");

    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
      const sliced = cleaned.slice(objectStart, objectEnd + 1);
      try {
        return JSON.parse(sliced);
      } catch {
        // Fall through.
      }
    }

    const error = new Error("invalid gemini json");
    error.code = finishReason === "MAX_TOKENS" ? "GEMINI_OUTPUT_TOO_LARGE" : "GEMINI_RESPONSE_INVALID";
    error.finishReason = finishReason;
    error.preview = cleaned.slice(0, 500);
    throw error;
  }
}
