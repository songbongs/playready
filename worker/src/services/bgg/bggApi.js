import { createUserError } from "../security/inputValidator.js";
import { ensureArray, parseXml } from "../../utils/xml.js";
import { SUPPORTED_POST_LANGUAGES } from "../../config/constants.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchXml(url, init, errorMessage) {
  const retryableStatuses = new Set([202, 408, 425, 429, 500, 502, 503, 504]);
  const maxAttempts = 5;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          accept: "application/xml",
          "user-agent": "playready-worker/1.0 (+https://songbongs.github.io/playready)",
          ...(init?.headers || {})
        }
      });
    } catch {
      if (attempt < maxAttempts) {
        await sleep(2500 * attempt);
        continue;
      }
      throw createUserError(errorMessage, 502, "BGG_UNAVAILABLE");
    }

    lastStatus = response.status;
    if (response.ok) {
      return parseXml(await response.text());
    }

    if (!retryableStatuses.has(response.status) || attempt === maxAttempts) {
      throw createUserError(errorMessage, 502, "BGG_UNAVAILABLE");
    }

    await sleep(2500 * attempt);
  }

  throw createUserError(`${errorMessage} (status: ${lastStatus})`, 502, "BGG_UNAVAILABLE");
}

async function fetchXmlOrNull(url, init, errorMessage, onProgress) {
  try {
    return await fetchXml(url, init, errorMessage);
  } catch {
    await onProgress?.("BGG 응답이 지연되어 일부 자료를 건너뛰고 있습니다... (1/3)", {
      stage: "bgg-warning",
      url
    });
    return null;
  }
}

function normalizeLanguage(raw) {
  const value = String(raw || "").toLowerCase();
  if (SUPPORTED_POST_LANGUAGES.includes(value)) return value;
  if (value.startsWith("en")) return "en";
  if (value.startsWith("de")) return "de";
  if (value.startsWith("fr")) return "fr";
  if (value.startsWith("es")) return "es";
  if (value.startsWith("ko")) return "ko";
  if (value.startsWith("ja")) return "ja";
  return "unknown";
}

function parseArticles(rawArticles) {
  return ensureArray(rawArticles)
    .map((article) => ({
      username: article.username || "unknown",
      postedAt: article.postdate || null,
      editedAt: article.editdate || null,
      language: normalizeLanguage(article.language || article.lang),
      subject: article.subject || "",
      body: article.body || article.content || "",
      isDesignerReply: /designer/i.test(String(article.username || "")) || Boolean(article.designer)
    }))
    .filter((article) => SUPPORTED_POST_LANGUAGES.includes(article.language));
}

function pickName(names) {
  const items = ensureArray(names);
  const primary = items.find((item) => item.type === "primary");
  return primary?.value || items[0]?.value || "";
}

function parseThingInfo(xml) {
  const item = ensureArray(xml?.items?.item || xml?.item)[0] || {};
  const links = ensureArray(item.link);

  return {
    id: String(item.id || ""),
    name: pickName(item.name),
    yearPublished: Number(item.yearpublished?.value || 0) || null,
    minPlayers: Number(item.minplayers?.value || 0) || null,
    maxPlayers: Number(item.maxplayers?.value || 0) || null,
    playingTime: Number(item.playingtime?.value || 0) || null,
    minAge: Number(item.minage?.value || 0) || null,
    description:
      typeof item.description === "string" ? item.description : item.description?.value || "",
    mechanics: links
      .filter((link) => link.type === "boardgamemechanic")
      .map((link) => link.value)
      .filter(Boolean),
    categories: links
      .filter((link) => link.type === "boardgamecategory")
      .map((link) => link.value)
      .filter(Boolean),
    families: links
      .filter((link) => link.type === "boardgamefamily")
      .map((link) => link.value)
      .filter(Boolean)
  };
}

function buildFallbackThingInfo(bggId, gameName, thingInfo) {
  return {
    id: String(thingInfo?.id || bggId || ""),
    name: thingInfo?.name || gameName || "",
    yearPublished: thingInfo?.yearPublished || null,
    minPlayers: thingInfo?.minPlayers || null,
    maxPlayers: thingInfo?.maxPlayers || null,
    playingTime: thingInfo?.playingTime || null,
    minAge: thingInfo?.minAge || null,
    description: thingInfo?.description || "",
    mechanics: thingInfo?.mechanics || [],
    categories: thingInfo?.categories || [],
    families: thingInfo?.families || []
  };
}

export async function collectBggForumData(bggId, gameName, config, onProgress) {
  const thingUrl = `${config.bggApiBase}/thing?id=${bggId}&stats=1`;
  const thingXml = await fetchXmlOrNull(
    thingUrl,
    {},
    "BGG 서버에서 게임 기본 정보를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.",
    onProgress
  );
  const thingInfo = buildFallbackThingInfo(bggId, gameName, thingXml ? parseThingInfo(thingXml) : null);

  const forumListUrl = `${config.bggApiBase}/forumlist?id=${bggId}&type=thing`;
  const forumListXml = await fetchXmlOrNull(
    forumListUrl,
    {},
    "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요.",
    onProgress
  );

  if (!forumListXml) {
    return {
      bggId,
      collectedAt: new Date().toISOString(),
      warning: "BGG 포럼 응답이 지연되어 포럼 자료 없이 계속 진행합니다.",
      thingInfo,
      forums: []
    };
  }

  const forums = ensureArray(forumListXml?.items?.forum || forumListXml?.forums?.forum);
  const forumResults = [];

  for (const [forumIndex, forum] of forums.entries()) {
    await onProgress?.("BGG 포럼 데이터를 수집하고 있습니다... (1/3)", {
      stage: "bgg",
      forumIndex: forumIndex + 1,
      forumCount: forums.length,
      forumTitle: forum.title || "forum"
    });

    await sleep(config.bggDelayMs);

    const forumUrl = `${config.bggApiBase}/forum?id=${forum.id}&page=1`;
    const forumXml = await fetchXmlOrNull(
      forumUrl,
      {},
      "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요.",
      onProgress
    );

    if (!forumXml) {
      continue;
    }

    const threads = ensureArray(forumXml?.forum?.threads?.thread || forumXml?.forum?.thread);
    const threadResults = [];

    for (const thread of threads) {
      await sleep(config.bggDelayMs);
      const threadUrl = `${config.bggApiBase}/thread?id=${thread.id}`;
      const threadXml = await fetchXmlOrNull(
        threadUrl,
        {},
        "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요.",
        onProgress
      );

      if (!threadXml) {
        continue;
      }

      const comments = parseArticles(threadXml?.thread?.articles?.article || threadXml?.thread?.article);
      if (!comments.length) {
        continue;
      }

      threadResults.push({
        id: thread.id,
        subject: thread.subject || "",
        author: thread.author || "",
        postCount: Number(thread.numarticles || comments.length),
        comments
      });
    }

    forumResults.push({
      id: forum.id,
      title: forum.title || "",
      group: forum.group || "",
      threads: threadResults
    });
  }

  return {
    bggId,
    collectedAt: new Date().toISOString(),
    thingInfo,
    forums: forumResults
  };
}
