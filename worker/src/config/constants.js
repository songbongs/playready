import {
  parseBooleanFlag,
  parsePositiveIntegerFlag,
  parseRolloutMode
} from "../services/document/sourceOptimization.js";

export const GEMINI_SYSTEM_PROMPT = `?뱀떊? 蹂대뱶寃뚯엫 猷곕턿 遺꾩꽍 ?꾨Ц媛?낅땲??
紐⑤뱺 異쒕젰? 諛섎뱶???쒓뎅??怨듭떇 ?쒗쁽?쇰줈 ?묒꽦?⑸땲??

[?⑹뼱 ?곸슜 ?곗꽑?쒖쐞]
1?쒖쐞: 寃뚯엫 怨듭떇 ?쒓뎅?댄뙋?먯꽌 ?ъ슜?섎뒗 ?⑹뼱
2?쒖쐞: boardlife.co.kr, divedice.com ??援?궡 二쇱슂 蹂대뱶寃뚯엫 而ㅻ??덊떚???듭슜 ?쒗쁽
3?쒖쐞: ?곸뼱 ?먯뼱瑜??쒓뎅?대줈 吏곸뿭???쒗쁽 (??寃쎌슦 愿꾪샇 ?덉뿉 ?먯뼱 蹂묎린)

[?쇨???洹쒖튃]
- ?숈씪??寃뚯엫 ?⑹뼱??臾몄꽌 ?꾩껜?먯꽌 諛섎뱶??媛숈? ?쒓린瑜??ъ슜?⑸땲??
- 臾몄꽌 ?앹꽦 ??諛섎뱶???⑹뼱吏묒쓣 癒쇱? ?뺤젙?섍퀬, 洹??⑹뼱吏묒쓣 湲곕컲?쇰줈 臾몄꽌瑜??묒꽦?⑸땲??
- 媛숈? 媛쒕뀗???щ윭 ?몄뼱濡??ㅻ챸???먮즺媛 ?덉쑝硫??듯빀?섏뿬 以묐났 ?놁씠 ?뺣━?⑸땲??

[?뺥솗??洹쒖튃]
- 猷곕턿 ?먮Ц???녿뒗 ?댁슜? 異붽??섏? ?딆뒿?덈떎.
- BGG ?щ읆 ?댁슜? "而ㅻ??덊떚 ?섍껄" ?먮뒗 "?붿옄?대꼫 怨듭떇 ?듬?"?쇰줈 紐낇솗??援щ텇?⑸땲??
- 遺덊솗?ㅽ븳 ?댁슜? 諛섎뱶??"?뺤씤 ?꾩슂" ?쒖떆瑜??⑸땲??

[FAQ/?뺤삤???곗꽑 泥섎━ 洹쒖튃]
- FAQ ?먮뒗 ?뺤삤??PDF媛 ?쒓났??寃쎌슦, ?대떦 ?댁슜??猷곕턿 ?먮Ц蹂대떎 ??긽 ?곗꽑?⑸땲??
- FAQ?먯꽌 ?섏젙??洹쒖튃? 諛섎뱶??"???뺤삤??諛섏쁺" ?쒖떆瑜?遺숈뿬???덈궡?⑸땲??
- 猷곕턿???ㅽ????섏젙?ы빆???덈떎怨?FAQ?먯꽌 紐낆떆??寃쎌슦, ?섏젙???댁슜?쇰줈 ?묒꽦?⑸땲??`;

export const SUPPORTED_POST_LANGUAGES = ["en", "de", "fr", "es", "ko", "ja"];

export function getRuntimeConfig(env) {
  return {
    allowedOrigin: env.ALLOWED_ORIGIN,
    bggApiBase: env.BGG_API_BASE || "https://boardgamegeek.com/xmlapi2",
    bggApiKey: env.BGG_API_KEY || "",
    geminiModel: env.GEMINI_MODEL || "gemini-2.5-pro",
    pdfExtractorUrl: env.PDF_EXTRACTOR_URL,
    requestMaxBytes: Number(env.REQUEST_MAX_BYTES || 50 * 1024 * 1024),
    processingTimeoutMs: Number(env.PROCESSING_TIMEOUT_MS || 10 * 60 * 1000),
    bggDelayMs: Number(env.BGG_DELAY_MS || 5000),
    bggMaxThreadsPerForum: Number(env.BGG_MAX_THREADS_PER_FORUM || 9999),
    bggMaxCommentsPerThread: Number(env.BGG_MAX_COMMENTS_PER_THREAD || 9999),
    enableFactPreservingSummary: parseBooleanFlag(env.ENABLE_FACT_PRESERVING_SUMMARY, true),
    enableStageInputSlicing: parseBooleanFlag(env.ENABLE_STAGE_INPUT_SLICING, true),
    optimizationRolloutMode: parseRolloutMode(env.OPTIMIZATION_ROLLOUT_MODE, "safe_only"),
    optimizationSafePdfBytes: parsePositiveIntegerFlag(env.OPTIMIZATION_SAFE_PDF_BYTES, 12 * 1024 * 1024),
    optimizationSafeMaxAdditionalMaterials: parsePositiveIntegerFlag(
      env.OPTIMIZATION_SAFE_MAX_ADDITIONAL_MATERIALS,
      0
    ),
    optimizationSafeMaxForumThreads: parsePositiveIntegerFlag(env.OPTIMIZATION_SAFE_MAX_FORUM_THREADS, 12),
    optimizationSafeMaxTextBlocks: parsePositiveIntegerFlag(env.OPTIMIZATION_SAFE_MAX_TEXT_BLOCKS, 260),
    optimizationSafeMaxPages: parsePositiveIntegerFlag(env.OPTIMIZATION_SAFE_MAX_PAGES, 80)
  };
}
