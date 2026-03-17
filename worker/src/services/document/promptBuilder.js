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
    "문서 A는 개인 학습용 상세 가이드입니다.",
    "특정 게임 전용 목차를 억지로 만들지 말고, 어떤 게임에도 적용 가능한 범용 구조를 사용하세요.",
    "최상위 섹션은 h2로 작성하고, 아래 고정 섹션은 가능한 한 같은 제목으로 유지하세요.",
    "",
    "문서 A 고정 섹션:",
    "1. 게임 개요",
    "2. 게임 준비 개요",
    "3. 플레이 흐름 개요",
    "4. 핵심 행동/선택지 설명",
    "5. 자원·트랙·상태·위치의 연결",
    "6. 라운드 종료와 게임 종료",
    "7. 점수/승리 조건 이해",
    "8. 헷갈리기 쉬운 규칙 정리",
    "",
    "문서 A 조건부 섹션:",
    "- 구성물 해설",
    "- 아이콘/기호 사전",
    "- 보드/개인판 구조 설명",
    "- 모드별 규칙",
    "- 전략 팁",
    "",
    "문서 A 작성 원칙:",
    "- 고정 섹션 8개는 모두 작성하세요.",
    "- 조건부 섹션은 자료가 충분할 때만 추가하세요.",
    "- 구성물 개수, 카드 장수 같은 세부 수량표는 길게 옮기지 말고 역할 중심으로 요약하세요.",
    "- 이미지가 없거나 부정확하면 이미지 언급을 억지로 넣지 마세요.",
    "- 아이콘 설명이 빈약한 게임이라면 아이콘/기호 사전을 생략해도 됩니다.",
    "- 보드나 개인판이 핵심 구조가 아닌 게임이면 보드/개인판 구조 설명을 생략해도 됩니다.",
    "- 학습용 문서이므로 왜 이 규칙이 중요한지, 어디서 자주 헷갈리는지, 어떤 연결 구조가 있는지 설명하세요.",
    "- 규칙 원문을 길게 다시 베끼지 말고 이해용 요약 문장으로 쓰세요.",
    "- '플레이 흐름 개요' 섹션에는 반드시 <section class=\"action-flow-section\">를 포함하세요.",
    "- action-flow-section 안에는 <div class=\"action-flow action-flow--vertical\">를 사용해 위에서 아래로 흐르는 턴 흐름도를 넣으세요.",
    "- 흐름도는 게임 고유 행동명을 그대로 쓰되, 최소한 '내 차례 시작 -> 선택 가능한 행동/결정 -> 효과 처리 -> 종료/다음 단계' 흐름이 보여야 합니다.",
    "- HTML만 반환하고, markdown 코드블록은 쓰지 마세요."
  ].join("\n");
}

function buildDocumentBStructurePrompt() {
  return [
    "문서 B는 다른 플레이어에게 게임을 설명할 때 쓰는 설명 보조 자료입니다.",
    "특정 게임 전용 목차를 억지로 만들지 말고, 어떤 게임에도 적용 가능한 범용 구조를 사용하세요.",
    "최상위 섹션은 h2로 작성하고, 아래 고정 섹션은 가능한 한 같은 제목으로 유지하세요.",
    "",
    "문서 B 고정 섹션:",
    "1. 30초 소개 멘트",
    "2. 셋업 체크리스트",
    "3. 내 턴에는 이렇게 진행합니다",
    "4. 핵심 행동 요약",
    "5. 첫 라운드 설명 스크립트",
    "6. 자주 헷갈리는 질문",
    "7. 라운드 종료 / 게임 종료 체크리스트",
    "8. 용어 / 참조 카드",
    "",
    "문서 B 조건부 섹션:",
    "- 핵심 아이콘 카드",
    "- 보드 위치 안내",
    "- 장르별 특수 규칙 요약",
    "- 모드별 보충 설명",
    "",
    "문서 B 작성 원칙:",
    "- 고정 섹션 8개는 모두 작성하세요.",
    "- 조건부 섹션은 설명할 때 실제 도움이 될 정도로 자료가 충분할 때만 추가하세요.",
    "- 문장은 짧고 분명하게 쓰고, 테이블/체크리스트/짧은 문단 중심으로 정리하세요.",
    "- 설명자가 그대로 읽거나 옆 사람에게 보여주기 쉬운 형태여야 합니다.",
    "- 이미지나 아이콘이 없으면 텍스트 중심으로만 구성해도 됩니다.",
    "- '내 턴에는 이렇게 진행합니다' 섹션에는 반드시 <section class=\"action-flow-section\">를 포함하세요.",
    "- action-flow-section 안에는 <div class=\"action-flow action-flow--vertical\">를 사용해 위에서 아래로 흐르는 간단한 턴 흐름도를 넣으세요.",
    "- 흐름도는 복잡한 예외보다 설명 순서가 먼저 보이도록 간결하게 정리하세요.",
    "- 첫 라운드 설명 스크립트는 실제 말하듯 자연스럽게 작성하세요.",
    "- HTML만 반환하고, markdown 코드블록은 쓰지 마세요."
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
    "- 문서 구조는 범용적으로 유지하되, 게임 특수 요소는 해당되는 섹션 안에서 자연스럽게 설명하세요.",
    "- 이미지나 아이콘 관련 섹션은 자료가 있을 때만 만들고, 없으면 생략하세요.",
    "",
    `확정 용어집: ${JSON.stringify(glossary || [])}`,
    `원본 자료: ${JSON.stringify(sources)}`
  ].join("\n");

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
