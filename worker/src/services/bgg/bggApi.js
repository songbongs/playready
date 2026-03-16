import { createUserError } from "../security/inputValidator.js";
import { ensureArray, parseXml } from "../../utils/xml.js";
import { SUPPORTED_POST_LANGUAGES } from "../../config/constants.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchXml(url, init, errorMessage) {
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw createUserError(errorMessage, 502, "BGG_UNAVAILABLE");
  }

  if (!response.ok) {
    throw createUserError(errorMessage, 502, "BGG_UNAVAILABLE");
  }

  return parseXml(await response.text());
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

function pickForums(rawForums) {
  return ensureArray(rawForums).filter((forum) => {
    const title = String(forum.title || "").toLowerCase();
    return /faq|rules|strategy|general|clarification|question|variant/.test(title);
  });
}

function parseArticles(rawArticles, maxComments) {
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
    .filter((article) => SUPPORTED_POST_LANGUAGES.includes(article.language))
    .slice(0, maxComments);
}

export async function collectBggForumData(bggId, config, onProgress) {
  const forumListUrl = `${config.bggApiBase}/forumlist?id=${bggId}&type=thing`;
  const forumListXml = await fetchXml(
    forumListUrl,
    { headers: { accept: "application/xml" } },
    "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요."
  );

  const rawForums = forumListXml?.items?.forum || forumListXml?.forums?.forum;
  const forums = pickForums(rawForums);
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
    const forumXml = await fetchXml(
      forumUrl,
      { headers: { accept: "application/xml" } },
      "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요."
    );

    const threads = ensureArray(forumXml?.forum?.threads?.thread || forumXml?.forum?.thread).slice(
      0,
      config.bggMaxThreadsPerForum
    );

    const threadResults = [];
    for (const thread of threads) {
      await sleep(config.bggDelayMs);
      const threadUrl = `${config.bggApiBase}/thread?id=${thread.id}`;
      const threadXml = await fetchXml(
        threadUrl,
        { headers: { accept: "application/xml" } },
        "BGG 서버에서 응답이 없습니다. 잠시 후 다시 시도해주세요."
      );

      const comments = parseArticles(
        threadXml?.thread?.articles?.article || threadXml?.thread?.article,
        config.bggMaxCommentsPerThread
      );

      if (!comments.length) continue;

      threadResults.push({
        id: thread.id,
        subject: thread.subject || "",
        author: thread.author || "",
        postCount: Number(thread.numarticles || comments.length),
        comments
      });
    }

    if (threadResults.length) {
      forumResults.push({
        id: forum.id,
        title: forum.title || "",
        group: forum.group || "",
        threads: threadResults
      });
    }
  }

  return {
    bggId,
    collectedAt: new Date().toISOString(),
    forums: forumResults
  };
}
