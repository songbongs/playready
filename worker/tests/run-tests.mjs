import assert from "node:assert/strict";

import { collectBggForumData } from "../src/services/bgg/bggApi.js";

function createConfig(overrides = {}) {
  return {
    bggApiBase: "https://example.test/xmlapi2",
    bggApiKey: "",
    bggDelayMs: 0,
    bggRequestTimeoutMs: 1000,
    bggCollectionTimeoutMs: 5000,
    bggMaxForums: 2,
    bggMaxThreadsPerForum: 2,
    bggMaxCommentsPerThread: 2,
    ...overrides
  };
}

function xmlResponse(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return body;
    }
  };
}

async function testRepresentativeCollection() {
  const urls = [];
  const progressStages = [];

  globalThis.fetch = async (url) => {
    urls.push(url);

    if (url.includes("/thing?")) {
      return xmlResponse(`
        <items>
          <item id="312484">
            <name type="primary" value="Lost Ruins of Arnak" />
            <yearpublished value="2020" />
            <minplayers value="1" />
            <maxplayers value="4" />
            <playingtime value="120" />
            <minage value="12" />
            <description>desc</description>
            <statistics>
              <ratings>
                <averageweight value="2.9" />
              </ratings>
            </statistics>
          </item>
        </items>
      `);
    }

    if (url.includes("/forumlist?")) {
      return xmlResponse(`
        <items>
          <forum id="1" title="General Discussion" group="General" />
          <forum id="2" title="Rules" group="Rules" />
          <forum id="3" title="Variants" group="Variants" />
        </items>
      `);
    }

    if (url.includes("/forum?id=2")) {
      return xmlResponse(`
        <forum>
          <threads>
            <thread id="21" subject="Official rules clarification" author="mod" numarticles="18" postdate="2026-03-01" lastpostdate="2026-03-20" />
            <thread id="22" subject="Beginner help" author="player" numarticles="8" postdate="2026-02-01" lastpostdate="2026-03-15" />
            <thread id="23" subject="Old chat" author="player" numarticles="1" postdate="2025-01-01" lastpostdate="2025-01-02" />
          </threads>
        </forum>
      `);
    }

    if (url.includes("/forum?id=1")) {
      return xmlResponse(`
        <forum>
          <threads>
            <thread id="11" subject="Question about setup" author="player" numarticles="10" postdate="2026-03-05" lastpostdate="2026-03-18" />
            <thread id="12" subject="Strategy tips" author="player" numarticles="7" postdate="2026-03-03" lastpostdate="2026-03-17" />
            <thread id="13" subject="Loose talk" author="player" numarticles="2" postdate="2025-08-01" lastpostdate="2025-08-02" />
          </threads>
        </forum>
      `);
    }

    if (url.includes("/thread?id=21")) {
      return xmlResponse(`
        <thread>
          <articles>
            <article username="mod" language="en" subject="A" body="1" />
            <article username="mod" language="en" subject="B" body="2" />
            <article username="mod" language="en" subject="C" body="3" />
          </articles>
        </thread>
      `);
    }

    if (url.includes("/thread?id=22")) {
      return xmlResponse(`
        <thread>
          <articles>
            <article username="player" language="en" subject="A" body="1" />
            <article username="player" language="ko" subject="B" body="2" />
          </articles>
        </thread>
      `);
    }

    if (url.includes("/thread?id=11")) {
      return xmlResponse(`
        <thread>
          <articles>
            <article username="player" language="en" subject="A" body="1" />
            <article username="player" language="en" subject="B" body="2" />
            <article username="player" language="en" subject="C" body="3" />
          </articles>
        </thread>
      `);
    }

    if (url.includes("/thread?id=12")) {
      return xmlResponse(`
        <thread>
          <articles>
            <article username="player" language="en" subject="A" body="1" />
          </articles>
        </thread>
      `);
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await collectBggForumData(
    "312484",
    "Lost Ruins of Arnak",
    createConfig(),
    async (_message, detail) => {
      progressStages.push(detail.stage);
    }
  );

  assert.equal(result.thingInfo.name, "Lost Ruins of Arnak");
  assert.equal(result.forums.length, 2);
  assert.equal(result.forums[0].title, "Rules");
  assert.equal(result.forums[1].title, "General Discussion");
  assert.equal(result.forums[0].threads.length, 2);
  assert.equal(result.forums[1].threads.length, 2);
  assert.equal(result.forums[0].threads[0].comments.length, 2);
  assert.deepEqual(
    progressStages.filter(Boolean).slice(0, 4),
    ["bgg-thing", "bgg-forumlist", "bgg-forum", "bgg-thread"]
  );
  assert.ok(urls.some((url) => url.includes("/forum?id=2")));
  assert.ok(!urls.some((url) => url.includes("/forum?id=3")));
}

async function testBudgetTimeoutFallback() {
  globalThis.fetch = async (url) => {
    if (url.includes("/thing?")) {
      return xmlResponse(`
        <items>
          <item id="312484">
            <name type="primary" value="Lost Ruins of Arnak" />
          </item>
        </items>
      `);
    }

    if (url.includes("/forumlist?")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return xmlResponse(`
        <items>
          <forum id="2" title="Rules" group="Rules" />
        </items>
      `);
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await collectBggForumData(
    "312484",
    "Lost Ruins of Arnak",
    createConfig({
      bggCollectionTimeoutMs: 5
    }),
    async () => {}
  );

  assert.equal(result.thingInfo.name, "Lost Ruins of Arnak");
  assert.equal(result.forums.length, 0);
  assert.match(result.warning, /시간 제한/);
}

async function run() {
  const tests = [
    ["대표 포럼/스레드/댓글 제한 수집", testRepresentativeCollection],
    ["BGG 시간 예산 초과 시 부분 결과 반환", testBudgetTimeoutFallback]
  ];

  for (const [label, fn] of tests) {
    await fn();
    console.log(`PASS ${label}`);
  }
}

run().catch((error) => {
  console.error("TEST FAILED");
  console.error(error);
  process.exitCode = 1;
});
