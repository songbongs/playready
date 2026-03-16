import { GEMINI_SYSTEM_PROMPT } from "../../config/constants.js";

function stringifyJson(title, value) {
  return `## ${title}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

export function buildGeminiPayload(input) {
  const { gameName, bggId, pdfExtraction, bggForumData, additionalMaterials } = input;

  const materialSummary = (additionalMaterials || []).map((item, index) => ({
    index: index + 1,
    fileName: item.fileName,
    mimeType: item.mimeType,
    textContent: item.textContent || ""
  }));

  const userPrompt = [
    `게임 이름: ${gameName}`,
    `BGG ID: ${bggId}`,
    "",
    "아래 자료를 기반으로 문서 A와 문서 B를 HTML로 작성하세요.",
    "출력은 아래 JSON 스키마를 반드시 지켜주세요.",
    "",
    "JSON 스키마:",
    "{",
    '  "glossary": [{"term":"", "selectedKorean":"", "source":"official|community|literal", "note":""}],',
    '  "documentAHtml": "<section>...</section>",',
    '  "documentBHtml": "<section>...</section>"',
    "}",
    "",
    "중요 지시:",
    "- 문서 A에는 게임 목표, 구성물, 턴 순서, 핵심 메커니즘, 예외 규칙, BGG 유저 FAQ, 전략 팁을 포함하세요.",
    "- 문서 B에는 소개 스크립트, 셋업 체크리스트, 첫 라운드 진행 가이드, 자주 헷갈리는 규칙 Q&A, 요약 참조 카드, 용어집을 포함하세요.",
    "- 이미지가 필요한 위치에는 반드시 [IMAGE_SLOT:image-id] 형식의 토큰을 넣어주세요.",
    "- BGG 답변은 '커뮤니티 의견'과 '디자이너 공식 답변'을 구분해서 적으세요.",
    "- 불확실한 내용은 '확인 필요'라고 표시하세요.",
    "",
    stringifyJson("PDF 추출 결과", pdfExtraction),
    "",
    stringifyJson("BGG 포럼 데이터", bggForumData),
    "",
    stringifyJson("추가 자료", materialSummary)
  ].join("\n");

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
      responseMimeType: "application/json"
    }
  };
}

export function parseGeminiJsonResponse(result) {
  const text = result?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  return JSON.parse(text);
}
