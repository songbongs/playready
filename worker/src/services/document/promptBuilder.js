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
    "아래 원본 자료를 바탕으로 문서 전체에서 공통으로 사용할 용어집만 JSON으로 작성하세요.",
    "반환 형식:",
    '{"glossary":[{"term":"","selectedKorean":"","source":"official|community|literal","note":""}]}',
    "",
    "주의:",
    "- PDF 추출 결과와 FAQ/정오표, BGG 포럼 데이터를 모두 참고하세요.",
    "- FAQ/정오표가 룰북과 다르면 FAQ/정오표를 우선하세요.",
    "- 용어는 최대 40개까지 허용합니다.",
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
    "아래 순서와 제목 체계를 가능한 한 그대로 유지해서 HTML로 작성하세요.",
    "",
    "문서 A 필수 구조:",
    "1. 게임 정체성 파악",
    "2. 구성물 완전 해설",
    "3. 게임 준비 단계별 가이드",
    "4. 턴 진행 전체 흐름 + 3가지 행동 상세 해설",
    "   4-1. 플레이어 턴 흐름도",
    "   4-2. 작업 배치 상세",
    "   4-3. 기술자 승급 상세",
    "   4-4. 패스",
    "5. 작업 아이콘 완전 백과",
    "6. 4가지 발전 트랙 연동 구조",
    "7. 통신기지 타일 3종 완전 해설",
    "8. 라운드 종료 6단계 체크리스트",
    "9. 점수 계산 완전 가이드",
    "10. 공식 FAQ와 자주 묻는 규칙 정리",
    "11. 1인 게임 또는 특수 모드가 있으면 별도 가이드",
    "",
    "문서 A 작성 원칙:",
    "- 학습용이므로 WHY와 예외 규칙까지 충분히 설명하세요.",
    "- 각 섹션은 h2, 세부 항목은 h3를 사용하세요.",
    "- 구성물, 준비, 보드, 아이콘, 점수 계산처럼 시각 자료가 필요한 곳은 자연스럽게 읽히는 설명을 먼저 쓰세요.",
    "- 4-1 플레이어 턴 흐름도 섹션에는 반드시 <section class=\"action-flow-section\">를 포함하세요.",
    "- action-flow-section 안에는 위에서 아래로 흐르는 세로형 단계가 보이도록 <div class=\"action-flow action-flow--vertical\">를 사용하세요.",
    "- 각 단계는 <div class=\"action-flow-step\">로 작성하고, 선택 분기 단계가 있으면 같은 단계 안에 선택지를 줄바꿈 목록처럼 정리하세요.",
    "- 흐름도에는 최소한 '내 차례 시작 -> 목표 달성 가능 여부 -> 3가지 행동 중 하나 선택 -> 추가 처리 -> 라운드 종료 조건 확인 -> 종료 아님/라운드 종료' 흐름이 보이게 하세요."
  ].join("\n");
}

function buildDocumentBStructurePrompt() {
  return [
    "문서 B는 다른 플레이어에게 설명할 때 쓰는 설명 보조용 대본/참조 자료입니다.",
    "아래 순서와 제목 체계를 가능한 한 그대로 유지해서 HTML로 작성하세요.",
    "",
    "문서 B 필수 구조:",
    "1. 30초 게임 소개 멘트",
    "2. 셋업 체크리스트",
    "3. 턴 흐름 간소 버전 + 3가지 행동 요약 카드",
    "4. 첫 라운드 설명 스크립트",
    "5. 핵심 아이콘 사전",
    "6. 자주 헷갈리는 규칙 Q&A",
    "7. 라운드 종료 체크리스트",
    "8. 게임 종료와 점수 계산 순서 카드",
    "9. 공식 용어 사전",
    "",
    "문서 B 작성 원칙:",
    "- 설명자가 테이블에서 그대로 읽거나 보여주기 쉽게 짧고 분명하게 쓰세요.",
    "- 문단보다 체크리스트, 짧은 문장, 요약 카드 형태를 우선하세요.",
    "- 3. 턴 흐름 간소 버전 섹션에는 반드시 <section class=\"action-flow-section\">를 포함하세요.",
    "- action-flow-section 안에는 위에서 아래로 흐르는 세로형 단계가 보이도록 <div class=\"action-flow action-flow--vertical\">를 사용하세요.",
    "- 흐름도에는 최소한 '내 차례 시작 -> 선택 행동 1개 -> 효과 처리 -> 차례 종료/다음 플레이어' 흐름이 보여야 합니다.",
    "- 첫 라운드 설명 스크립트는 실제 말하듯 자연스럽게 작성하세요."
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
    "- 확정 용어집을 반드시 일관되게 따르세요.",
    "- FAQ/정오표가 제공되면 룰북보다 우선합니다.",
    '- FAQ/정오표에서 수정된 규칙은 반드시 "※ 정오표 반영" 표시를 붙이세요.',
    "- 입력 자료에 없는 사실은 추가하지 마세요.",
    "- BGG 내용은 '커뮤니티 의견'과 '디자이너 공식 답변'을 구분하세요.",
    "- 불확실한 내용은 '확인 필요'로 표시하세요.",
    "- 결과는 반드시 HTML 조각만 넣고, markdown 코드블록은 쓰지 마세요.",
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
