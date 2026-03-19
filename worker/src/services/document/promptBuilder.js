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
    "- Keep sentences short and direct.",
    "- One sentence should express only one idea.",
    "- Prefer two short sentences over one long sentence.",
    "- Document A must stay complete enough for self-study, but avoid long paragraphs.",
    "- Document B must sound easy to speak aloud and stay shorter than Document A.",
    "- Do not recreate the turn flowchart in prose. The dedicated flow section handles that job.",
    "- If an image is not clearly matched to the section meaning, do not rely on that image in the writing.",
    "",
    "아래 자료를 바탕으로 문서 전체에서 공통으로 쓸 용어집만 JSON으로 정리하세요.",
    "반환 형식:",
    '{"glossary":[{"term":"","selectedKorean":"","source":"official|community|literal","note":""}]}',
    "",
    "용어집 작성 규칙:",
    "- 공식 룰북, FAQ/정오표, BGG 자료를 함께 참고하세요.",
    "- FAQ/정오표가 룰북보다 우선합니다.",
    "- 실제 문서 작성에 반복적으로 쓸 핵심 용어만 남기세요.",
    "- 용어 수는 최대 28개까지만 정리하세요.",
    "- note는 길게 쓰지 말고 1문장 이내로 쓰세요.",
    "",
    `원본 자료: ${JSON.stringify(sources)}`
  ].join("\n");

  return buildPayload(prompt, 6144, {
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

export function buildTurnFlowPayload(input, glossary) {
  const sources = buildSourceBundle(input);
  const prompt = [
    `Game name: ${sources.gameName}`,
    `BGG ID: ${sources.bggId}`,
    "",
    "Analyze the actual turn or round flow for this specific board game.",
    "Do not output a generic board-game template.",
    "The flowchart is the most important element in both documents.",
    "Return only JSON for two flowchart data sets:",
    "- detailed: for Document A (self-study)",
    "- simplified: for Document B (teach-at-the-table)",
    "",
    "Turn flow priorities:",
    "- Use only the real flow supported by the supplied rulebook, FAQ, and BGG data.",
    "- If the game uses rounds instead of turns, reflect the real round structure.",
    "- If the game has both round flow and player-turn flow, focus on the player-facing decision flow.",
    "- Show real branch points only when the player must choose between meaningfully different actions.",
    "- If free actions, pre-actions, upkeep, or cleanup exist, place them at the correct timing.",
    "- If FAQ or errata changes the flow, follow FAQ or errata.",
    "",
    "Document A flow rules:",
    "- This flow is for learning. It must help a new player understand what happens, why the flow branches, and what follows next.",
    "- Preserve meaningful choices and follow-up effects.",
    "- Prefer 5 to 8 total steps.",
    "- Branches should usually have 2 to 4 options.",
    "",
    "Document B flow rules:",
    "- This flow is for teaching. It must be simple enough for someone to explain aloud at the table.",
    "- Keep only the explanation-critical path.",
    "- Prefer 3 to 5 total steps.",
    "- Avoid extra branches unless the choice is essential for a first explanation.",
    "",
    "Output rules:",
    "- Mark each step as required, optional, free, or cleanup when the sources support that distinction.",
    "- Keep each title short and concrete.",
    "- Keep each detail to one short sentence.",
    "- Do not leave empty branches or placeholder options.",
    "- Do not invent actions, timings, or choices that are not in the sources.",
    "",
    "Return format:",
    '{"detailed":{"lead":"","steps":[{"kind":"start|decision|branch|merge|end","title":"","detail":"","tone":"neutral|primary|secondary|warning","requirement":"required|optional|free|cleanup","timing":"","options":[{"title":"","detail":"","tone":"secondary","requirement":"required|optional|free","timing":""}]}]},"simplified":{"lead":"","steps":[]}}',
    "",
    `Glossary: ${JSON.stringify(glossary || [])}`,
    `Sources: ${JSON.stringify(sources)}`
  ].join("\n");

  return buildPayload(prompt, 8192, {
    type: "OBJECT",
    properties: {
      detailed: {
        type: "OBJECT",
        properties: {
          lead: { type: "STRING" },
          steps: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                kind: { type: "STRING" },
                title: { type: "STRING" },
                detail: { type: "STRING" },
                tone: { type: "STRING" },
                requirement: { type: "STRING" },
                timing: { type: "STRING" },
                options: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      detail: { type: "STRING" },
                      tone: { type: "STRING" },
                      requirement: { type: "STRING" },
                      timing: { type: "STRING" }
                    },
                    required: ["title", "detail", "tone"]
                  }
                }
              },
              required: ["kind", "title", "detail", "tone"]
            }
          }
        },
        required: ["lead", "steps"]
      },
      simplified: {
        type: "OBJECT",
        properties: {
          lead: { type: "STRING" },
          steps: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                kind: { type: "STRING" },
                title: { type: "STRING" },
                detail: { type: "STRING" },
                tone: { type: "STRING" },
                requirement: { type: "STRING" },
                timing: { type: "STRING" },
                options: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      detail: { type: "STRING" },
                      tone: { type: "STRING" },
                      requirement: { type: "STRING" },
                      timing: { type: "STRING" }
                    },
                    required: ["title", "detail", "tone"]
                  }
                }
              },
              required: ["kind", "title", "detail", "tone"]
            }
          }
        },
        required: ["lead", "steps"]
      }
    },
    required: ["detailed", "simplified"]
  });
}

function summarizeTurnFlowForPrompt(turnFlowData, documentType) {
  const flow = documentType === "B" ? turnFlowData?.simplified : turnFlowData?.detailed;
  const steps = Array.isArray(flow?.steps) ? flow.steps.slice(0, documentType === "B" ? 5 : 7) : [];

  if (!steps.length) {
    return "";
  }

  const summary = steps
    .map((step) => {
      const base = [step?.title, step?.detail].filter(Boolean).join(": ");
      if (step?.kind === "branch" && Array.isArray(step?.options) && step.options.length) {
        const options = step.options
          .slice(0, 4)
          .map((item) => item?.title)
          .filter(Boolean)
          .join(", ");
        return `${base} [options: ${options}]`;
      }
      return base;
    })
    .filter(Boolean)
    .join(" -> ");

  return `게임별 턴 흐름 요약 (${documentType === "B" ? "설명용 간소 버전" : "학습용 상세 버전"}): ${summary}`;
}

function buildDocumentAStructurePrompt() {
  return [
    "문서 A는 개인 학습용 가이드입니다.",
    "핵심은 '게임을 스스로 이해하게 돕는 것'입니다.",
    "룰북을 통째로 다시 쓰지 말고, 이해에 꼭 필요한 설명만 추려서 정리하세요.",
    "",
    "문서 A 고정 섹션:",
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
    "문서 A 길이 규칙:",
    "- 각 고정 섹션은 너무 짧지 않게 쓰되, 3~5개의 짧은 문단 정도로 정리하세요.",
    "- 한 문단은 1~2문장 정도로 유지하세요.",
    "- 한 문장은 가능한 한 한 가지 뜻만 담으세요.",
    "- 섹션 하나에 7문단 이상 길게 늘어놓지 마세요.",
    "- 예외 규칙은 필요한 것만 남기고, 세부 수량표나 구성물 개수 나열은 최소화하세요.",
    "",
    "턴 흐름도 섹션 규칙:",
    "- '2. 플레이어 턴 흐름도' 섹션은 h2 제목과 아주 짧은 소개 문단 1개만 작성하세요.",
    "- 흐름도 HTML, 도형, 화살표, 분기 박스는 AI가 직접 만들지 마세요.",
    "- 서버가 뒤에서 세로형 흐름도를 자동으로 붙입니다.",
    "",
    "조건부 섹션 규칙:",
    "- 자료 근거가 약하면 조건부 섹션을 만들지 마세요.",
    "- 이미지 섹션, 아이콘 섹션, 보드 섹션은 '정말 맞는 자료가 있을 때만' 짧게 만드세요.",
    "- 애매한 경우에는 이미지나 아이콘 섹션을 생략하세요.",
    "",
    "HTML 규칙:",
    "- 최상위 섹션은 h2를 사용하세요.",
    "- 필요하면 h3를 쓰되, 과도하게 세분화하지 마세요.",
    "- 표는 꼭 필요할 때만 짧게 쓰세요.",
    "- HTML 본문만 반환하고 markdown 코드블록은 사용하지 마세요."
  ].join("\n");
}

function buildDocumentBStructurePrompt() {
  return [
    "문서 B는 설명 보조용 자료입니다.",
    "핵심은 '다른 사람에게 빠르게 설명할 수 있게 돕는 것'입니다.",
    "읽기 쉬운 짧은 문장과 바로 말할 수 있는 표현을 우선하세요.",
    "",
    "문서 B 고정 섹션:",
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
    "문서 B 길이 규칙:",
    "- 각 고정 섹션은 2~4개의 짧은 문단이나 짧은 목록으로 정리하세요.",
    "- 한 문장은 짧게 쓰고, 한 문장에는 한 뜻만 넣으세요.",
    "- 설명자가 그대로 읽을 수 있는 말투를 우선하세요.",
    "- 긴 배경 설명이나 긴 예외 설명은 줄이세요.",
    "- B문서는 A문서보다 더 짧고 더 빠르게 훑히도록 만드세요.",
    "",
    "턴 흐름도 섹션 규칙:",
    "- '2. 플레이어 턴 흐름도 (간소화)' 섹션은 h2 제목과 짧은 소개 문단 1개만 작성하세요.",
    "- 흐름도 HTML, 도형, 화살표, 분기 박스는 AI가 직접 만들지 마세요.",
    "- 서버가 뒤에서 세로형 간소 흐름도를 자동으로 붙입니다.",
    "",
    "조건부 섹션 규칙:",
    "- 이미지가 없어도 충분히 설명 가능하면 이미지 섹션을 만들지 마세요.",
    "- 핵심 아이콘 카드나 보드 위치 안내는 자료 근거가 확실할 때만 짧게 만드세요.",
    "",
    "HTML 규칙:",
    "- 최상위 섹션은 h2를 사용하세요.",
    "- h3는 꼭 필요할 때만 사용하세요.",
    "- HTML 본문만 반환하고 markdown 코드블록은 사용하지 마세요."
  ].join("\n");
}

function buildDocumentAStructurePromptV2() {
  return [
    "Document A is a self-study guide.",
    "Its job is to help a beginner understand the game alone.",
    "Do not rewrite the rulebook page by page. Extract only what is needed for understanding.",
    "",
    "Document A fixed sections:",
    "1. 게임 개요",
    "2. 플레이어가 하게 되는 일",
    "3. 플레이어 턴 흐름",
    "4. 게임 준비와 시작 상태",
    "5. 이 게임의 핵심 시스템 이해",
    "6. 종료 조건과 결과 판단",
    "7. 자주 헷갈리는 규칙 정리",
    "",
    "Document A conditional sections:",
    "- 구성물 안내",
    "- 아이콘/기호 사전",
    "- 카드/타일/주사위 등 핵심 요소 설명",
    "- 개인판/공용판 구조 설명",
    "- 특수 모드 또는 확장 규칙",
    "",
    "Document A structure rules:",
    "- Use a game-neutral high-level structure. Do not assume every game has combat, cards, or rounds in the same way.",
    "- In section 5, explain only the core systems that actually matter for this game.",
    "- If a system does not exist in this game, omit it.",
    "- The turn-flow section is the most important section. The prose should support the flowchart, not replace it.",
    "",
    "Document A length rules:",
    "- Use bullet lists or numbered lists for most content.",
    "- Each section should be concise but complete enough for self-study.",
    "- Prefer 3 to 6 short bullets or short paragraphs per section.",
    "- Avoid long wall-of-text paragraphs.",
    "",
    "HTML rules:",
    "- Use h2 for top-level sections and h3 only when truly needed.",
    "- Return HTML body only.",
    "- Do not output markdown fences."
  ].join("\n");
}

function buildDocumentBStructurePromptV2() {
  return [
    "Document B is a teaching aid.",
    "Its job is to help someone explain the game quickly to other players.",
    "Prefer short lines that are easy to say aloud.",
    "",
    "Document B fixed sections:",
    "1. 30초 소개 멘트",
    "2. 플레이어가 하는 일 한눈에 보기",
    "3. 플레이어 턴 흐름 요약",
    "4. 첫 턴 또는 첫 라운드 설명 스크립트",
    "5. 자주 나오는 질문",
    "6. 종료/점수 빠른 체크리스트",
    "7. 핵심 참고 카드",
    "",
    "Document B conditional sections:",
    "- 세팅 체크리스트",
    "- 핵심 아이콘 설명",
    "- 보드 위치 안내",
    "- 모드별 차이 요약",
    "",
    "Document B structure rules:",
    "- Use the same game-neutral high-level structure, but compress it for teaching.",
    "- Keep only what is needed to teach a first play.",
    "- The turn-flow section is the most important section. It must be simple enough to read aloud.",
    "- Avoid detailed background systems unless they are essential for first-time explanation.",
    "",
    "Document B length rules:",
    "- Use bullets, checklist lines, and short script lines.",
    "- Keep almost every line short.",
    "- Make Document B clearly shorter and faster to scan than Document A.",
    "",
    "HTML rules:",
    "- Use h2 for top-level sections and h3 only when truly needed.",
    "- Return HTML body only.",
    "- Do not output markdown fences."
  ].join("\n");
}

function summarizeTurnFlowForPromptV2(turnFlowData, documentType) {
  const flow = documentType === "B" ? turnFlowData?.simplified : turnFlowData?.detailed;
  const steps = Array.isArray(flow?.steps) ? flow.steps.slice(0, documentType === "B" ? 5 : 7) : [];

  if (!steps.length) {
    return "";
  }

  const summary = steps
    .map((step) => {
      const base = [step?.title, step?.detail].filter(Boolean).join(": ");
      if (step?.kind === "branch" && Array.isArray(step?.options) && step.options.length) {
        const options = step.options
          .slice(0, 4)
          .map((item) => item?.title)
          .filter(Boolean)
          .join(", ");
        return `${base} [options: ${options}]`;
      }
      return base;
    })
    .filter(Boolean)
    .join(" -> ");

  return `Turn flow summary (${documentType === "B" ? "teaching version" : "study version"}): ${summary}`;
}

function buildDocumentBStructurePromptV3() {
  return [
    "Document B is a teaching aid.",
    "Its job is to help someone explain the game quickly to other players.",
    "Prefer short lines that are easy to say aloud.",
    "",
    "Document B fixed sections:",
    "1. 30초 소개 멘트",
    "2. 플레이어가 하는 일 한눈에 보기",
    "3. 플레이어 턴 흐름 요약",
    "4. 첫 턴 또는 첫 라운드 설명 스크립트",
    "5. 자주 나오는 질문",
    "6. 종료/점수 빠른 체크리스트",
    "7. 핵심 참고사항",
    "",
    "Document B conditional sections:",
    "- 세팅 체크리스트",
    "- 핵심 아이콘 설명",
    "- 보드 위치 안내",
    "- 모드별 차이 요약",
    "",
    "Document B structure rules:",
    "- Use the exact Korean section headings listed above.",
    "- Keep only what is needed to teach a first play.",
    "- The turn-flow section is the most important section. It must be simple enough to read aloud.",
    "- Make section titles feel clearly separate from their body content.",
    "- Right under each h2, start with a short paragraph, list, checklist, or script block so the section looks structurally distinct.",
    "- Rename any section that would have been called '핵심 참고 카드' to '핵심 참고사항'.",
    "",
    "Document B length rules:",
    "- Use bullets, checklist lines, and short script lines.",
    "- Keep almost every line short.",
    "- Make Document B clearly shorter and faster to scan than Document A.",
    "",
    "HTML rules:",
    "- Use h2 for top-level sections and h3 only when truly needed.",
    "- Return HTML body only.",
    "- Do not output markdown fences."
  ].join("\n");
}

export function buildDocumentPayload(input, glossary, documentType, turnFlowData = null) {
  const sources = buildSourceBundle(input);
  const structurePrompt =
    documentType === "A" ? buildDocumentAStructurePromptV2() : buildDocumentBStructurePromptV3();
  const maxOutputTokens = documentType === "A" ? 28672 : 20480;
  const turnFlowGuide = summarizeTurnFlowForPromptV2(turnFlowData, documentType);
  const sectionTuning =
    documentType === "A"
      ? [
          "Document A section tuning:",
          "- Use bullet lists or numbered lists for almost all body content.",
          "- '4. 게임 준비와 시작 상태' should read like a step-by-step setup guide the reader can follow in order.",
          "- '5. 자원·보드·트랙·상태 연결' must explain the game-specific systems: what each key card, resource, track, state, or board area does, why it matters, and how it changes during play.",
          "- In '아이콘/기호 사전', explain every symbol meaning in text. Do not depend on images there.",
          "- Avoid helper copy such as '참고 이미지' or '이미지만 넣습니다'."
        ].join("\n")
      : [
          "Document B section tuning:",
          "- Use bullets, checklist lines, or short script lines for almost all body content.",
          "- Keep every line short enough to say aloud naturally.",
          "- '셋업 체크리스트' should be checklist bullets only. Do not add setup image helper copy.",
          "- Use the heading '핵심 아이콘 설명' instead of '핵심 아이콘 카드'.",
          "- In '핵심 아이콘 설명', explain only the most important symbols in text and keep each item very short.",
          "- Avoid helper copy such as '참고 이미지' or '이미지만 넣습니다'."
        ].join("\n");
  const brevityRules = [
    "Keep sentences short and direct.",
    "One sentence should express only one idea.",
    "Prefer two short sentences over one long sentence.",
    "Document A must stay complete enough for self-study, but avoid long paragraphs.",
    "Document B must sound easy to speak aloud and stay shorter than Document A.",
    "Do not recreate the turn flowchart in prose. The dedicated flow section handles that job.",
    "If an image is not clearly matched to the section meaning, do not rely on that image in the writing.",
    "Use bullet lists and short checklist structures instead of paragraph-heavy prose."
  ].join("\n");

  const prompt = [
    `게임 이름: ${sources.gameName}`,
    `BGG ID: ${sources.bggId}`,
    "",
    structurePrompt,
    turnFlowGuide,
    brevityRules,
    sectionTuning,
    "",
    "반환 형식:",
    '{"documentHtml":"<section>...</section>"}',
    "",
    "공통 작성 규칙:",
    "- 고정 용어집을 일관되게 사용하세요.",
    "- FAQ/정오표가 제공되면 룰북보다 우선합니다.",
    '- FAQ/정오표로 수정된 규칙은 반드시 "※ 정오표 반영" 표시를 붙이세요.',
    "- 입력 자료에 없는 사실은 추측해서 추가하지 마세요.",
    "- BGG 내용은 공식 정보와 커뮤니티 의견을 구분해서 설명하세요.",
    "- 불확실하면 단정하지 말고 주의 문구로 표현하세요.",
    "- 이미지/아이콘 섹션은 기본적으로 생략하고, 자료 근거가 확실할 때만 조건부로 추가하세요.",
    "- 플레이어 턴 흐름도 섹션과 핵심 행동 요약 근처에는 이미지 섹션을 넣지 마세요.",
    "- 같은 이미지를 여러 곳에 반복해서 쓰지 않는 방향으로 서술하세요.",
    "- 문장 수를 불필요하게 늘리지 말고, 각 섹션의 목적을 달성할 만큼만 충분히 쓰세요.",
    "",
    `고정 용어집: ${JSON.stringify(glossary || [])}`,
    `원본 자료: ${JSON.stringify(sources)}`
  ].join("\n\n");

  return buildPayload(prompt, maxOutputTokens, {
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
