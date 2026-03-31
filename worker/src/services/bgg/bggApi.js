import { createUserError } from "../security/inputValidator.js";
import { ensureArray, parseXml } from "../../utils/xml.js";
import { SUPPORTED_POST_LANGUAGES } from "../../config/constants.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId)
  };
}

function createBggBudget(config) {
  const startedAt = Date.now();
  return {
    startedAt,
    hasTimeLeft() {
      return Date.now() - startedAt < config.bggCollectionTimeoutMs;
    },
    remainingMs() {
      return Math.max(0, config.bggCollectionTimeoutMs - (Date.now() - startedAt));
    }
  };
}

function forumPriorityScore(forum, index) {
  const text = `${forum?.group || ""} ${forum?.title || ""}`.toLowerCase();
  let score = Math.max(0, 30 - index);

  if (/rule|faq|official|clarification|errata/.test(text)) score += 160;
  if (/strategy|tips|help|how to play|teaching/.test(text)) score += 110;
  if (/general|session|first play|question/.test(text)) score += 70;
  if (/variant|solo|campaign|expansion/.test(text)) score += 35;

  return score;
}

function toTimestamp(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function threadPriorityScore(thread, index) {
  const subject = String(thread?.subject || "").toLowerCase();
  const postCount = Number(thread?.numarticles || 0);
  const recentAt = Math.max(
    toTimestamp(thread?.lastpostdate),
    toTimestamp(thread?.lastpost),
    toTimestamp(thread?.postdate)
  );
  const recentDays = recentAt ? (Date.now() - recentAt) / (1000 * 60 * 60 * 24) : Number.POSITIVE_INFINITY;
  const recencyBonus =
    recentDays <= 14 ? 80 : recentDays <= 60 ? 50 : recentDays <= 180 ? 25 : recentAt ? 8 : 0;

  let score = Math.max(0, 20 - index) + Math.min(postCount, 40) * 3 + recencyBonus;
  if (/rule|faq|clarification|errata|official|timing/.test(subject)) score += 120;
  if (/strategy|tips|help|beginner|teaching|question/.test(subject)) score += 70;
  if (/solo|variant|campaign|expansion/.test(subject)) score += 25;
  return score;
}

function sortForums(forums = []) {
  return [...forums].sort((left, right) => {
    const scoreDiff = forumPriorityScore(right, 0) - forumPriorityScore(left, 0);
    if (scoreDiff) return scoreDiff;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
}

function sortThreads(threads = []) {
  return [...threads]
    .map((thread, index) => ({ thread, index }))
    .sort((left, right) => {
      const scoreDiff = threadPriorityScore(right.thread, right.index) - threadPriorityScore(left.thread, left.index);
      if (scoreDiff) return scoreDiff;
      return String(left.thread?.id || "").localeCompare(String(right.thread?.id || ""));
    })
    .map((item) => item.thread);
}

async function fetchXml(url, init, errorMessage, config) {
  const retryableStatuses = new Set([202, 408, 425, 429, 500, 502, 503, 504]);
  const maxAttempts = 5;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeout = createTimeoutSignal(config.bggRequestTimeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: "application/xml",
          "user-agent": "playready-worker/1.0 (+https://songbongs.github.io/playready)",
          ...(config.bggApiKey ? { authorization: `Bearer ${config.bggApiKey}` } : {}),
          ...(init?.headers || {})
        },
        signal: timeout.signal
      });
      timeout.clear();

      lastStatus = response.status;
      if (response.ok) {
        return parseXml(await response.text());
      }

      if (!retryableStatuses.has(response.status) || attempt === maxAttempts) {
        throw createUserError(errorMessage, 502, "BGG_UNAVAILABLE");
      }
    } catch (error) {
      timeout.clear();
      if (attempt === maxAttempts) {
        throw createUserError(errorMessage, 502, "BGG_UNAVAILABLE");
      }

      if (error?.name !== "AbortError") {
        lastStatus = lastStatus || 0;
      }
    }

    await sleep(500 * attempt);
  }

  throw createUserError(`${errorMessage} (status: ${lastStatus})`, 502, "BGG_UNAVAILABLE");
}

async function fetchXmlOrNull(url, init, errorMessage, onProgress, config) {
  try {
    return await fetchXml(url, init, errorMessage, config);
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
    weight: Number(item.statistics?.ratings?.averageweight?.value || 0) || null,
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
    weight: thingInfo?.weight || null,
    minAge: thingInfo?.minAge || null,
    description: thingInfo?.description || "",
    mechanics: thingInfo?.mechanics || [],
    categories: thingInfo?.categories || [],
    families: thingInfo?.families || []
  };
}

export async function collectBggForumData(bggId, gameName, config, onProgress, control = null) {
  const budget = createBggBudget(config);
  const warningMessages = [];

  const ensureContinuing = async (stage = "bgg", message = "") => {
    if (control?.assertActive) {
      await control.assertActive(stage, message);
    }
    if (!budget.hasTimeLeft()) {
      warningMessages.push("BGG 수집 시간 제한에 도달해 대표 포럼 일부만 사용합니다.");
      return false;
    }
    return true;
  };

  await onProgress?.("BGG 기본 정보를 읽고 있습니다... (1/3)", {
    stage: "bgg-thing"
  });
  if (!(await ensureContinuing("bgg-thing", "BGG 기본 정보를 읽고 있습니다."))) {
    return {
      bggId,
      collectedAt: new Date().toISOString(),
      warning: warningMessages.join(" "),
      thingInfo: buildFallbackThingInfo(bggId, gameName, null),
      forums: []
    };
  }

  const thingUrl = `${config.bggApiBase}/thing?id=${bggId}&stats=1`;
  const thingXml = await fetchXmlOrNull(
    thingUrl,
    {},
    "BGG 서버에서 게임 기본 정보를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.",
    onProgress,
    config
  );
  const thingInfo = buildFallbackThingInfo(bggId, gameName, thingXml ? parseThingInfo(thingXml) : null);

  await onProgress?.("BGG 포럼 목록을 정리하고 있습니다... (1/3)", {
    stage: "bgg-forumlist"
  });
  if (!(await ensureContinuing("bgg-forumlist", "BGG 포럼 목록을 정리하고 있습니다."))) {
    return {
      bggId,
      collectedAt: new Date().toISOString(),
      warning: warningMessages.join(" "),
      thingInfo,
      forums: []
    };
  }

  const forumListUrl = `${config.bggApiBase}/forumlist?id=${bggId}&type=thing`;
  const forumListXml = await fetchXmlOrNull(
    forumListUrl,
    {},
    "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요.",
    onProgress,
    config
  );

  if (!forumListXml) {
    warningMessages.push("BGG 포럼 응답이 지연되어 포럼 자료 없이 계속 진행합니다.");
    return {
      bggId,
      collectedAt: new Date().toISOString(),
      warning: warningMessages.join(" "),
      thingInfo,
      forums: []
    };
  }

  const allForums = ensureArray(forumListXml?.items?.forum || forumListXml?.forums?.forum);
  const forums = sortForums(allForums).slice(0, config.bggMaxForums);
  const forumResults = [];

  for (const [forumIndex, forum] of forums.entries()) {
    await onProgress?.(
      `BGG 대표 포럼 ${forumIndex + 1}/${forums.length}을 읽고 있습니다... (1/3)`,
      {
        stage: "bgg-forum",
        forumIndex: forumIndex + 1,
        forumCount: forums.length,
        forumTitle: forum.title || forum.group || "forum"
      }
    );

    if (!(await ensureContinuing("bgg-forum", `BGG 대표 포럼 ${forumIndex + 1}/${forums.length}을 읽고 있습니다.`))) {
      break;
    }

    await sleep(config.bggDelayMs);

    const forumUrl = `${config.bggApiBase}/forum?id=${forum.id}&page=1`;
    const forumXml = await fetchXmlOrNull(
      forumUrl,
      {},
      "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요.",
      onProgress,
      config
    );

    if (!forumXml) {
      continue;
    }

    const rawThreads = ensureArray(forumXml?.forum?.threads?.thread || forumXml?.forum?.thread);
    const threads = sortThreads(rawThreads).slice(0, config.bggMaxThreadsPerForum);
    const threadResults = [];

    for (const [threadIndex, thread] of threads.entries()) {
      await onProgress?.(
        `BGG 포럼 ${forumIndex + 1}/${forums.length}의 스레드 ${threadIndex + 1}/${threads.length}을 읽고 있습니다... (1/3)`,
        {
          stage: "bgg-thread",
          forumIndex: forumIndex + 1,
          forumCount: forums.length,
          threadIndex: threadIndex + 1,
          threadCount: threads.length,
          forumTitle: forum.title || forum.group || "forum",
          threadSubject: thread.subject || ""
        }
      );

      if (
        !(await ensureContinuing(
          "bgg-thread",
          `BGG 포럼 ${forumIndex + 1}/${forums.length}의 스레드 ${threadIndex + 1}/${threads.length}을 읽고 있습니다.`
        ))
      ) {
        break;
      }

      await sleep(config.bggDelayMs);
      const threadUrl = `${config.bggApiBase}/thread?id=${thread.id}`;
      const threadXml = await fetchXmlOrNull(
        threadUrl,
        {},
        "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요.",
        onProgress,
        config
      );

      if (!threadXml) {
        continue;
      }

      const comments = parseArticles(threadXml?.thread?.articles?.article || threadXml?.thread?.article).slice(
        0,
        config.bggMaxCommentsPerThread
      );
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

  if (!budget.hasTimeLeft()) {
    await onProgress?.("BGG 대표 자료만 사용하고 다음 단계로 넘어갑니다... (1/3)", {
      stage: "bgg-warning"
    });
  }

  return {
    bggId,
    collectedAt: new Date().toISOString(),
    warning: warningMessages.join(" "),
    thingInfo,
    forums: forumResults
  };
}
