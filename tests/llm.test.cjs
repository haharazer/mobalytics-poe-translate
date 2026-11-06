const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../src/llm.js");
require("../src/guide-sites.js");
require("../src/guide-prose.js");
const { DEFAULT_PROMPT, endpointURL, hostPattern, readTranslation } = globalThis.PoeLLM;

test("oversized paragraphs split into valid request batches without breaking locked terms", () => {
  const long = "X".repeat(11999) + "⟦123⟧" + "y".repeat(1000);
  const parts = [null, long, ...Array(280).fill("More text.")];
  const grouped = [...PoeGuideProse.batches(parts)];
  assert.ok(grouped.length >= 4);
  assert.ok(grouped.every(group => PoeLLM.validParts(group.map(row => row.piece))));
  const pieces = grouped.flat().filter(row => row.index === 1).map(row => row.piece);
  assert.equal(pieces.join(""), long);
  assert.ok(pieces.some(p => p.includes("⟦123⟧")));
});

test("endpoint handling supports compatible base paths, exact endpoints and loopback", () => {
  assert.equal(endpointURL("https://example.com").pathname, "/v1/chat/completions");
  assert.equal(endpointURL("https://example.com/gateway/v1/").pathname, "/gateway/v1/chat/completions");
  const local = endpointURL("http://127.0.0.1:8181/v1/chat/completions");
  assert.equal(local.port, "8181");
  assert.equal(hostPattern(local), "http://127.0.0.1/*");
  for (const bad of ["file:///tmp/key", "http://remote.example/v1", "https://user:pass@host/v1", "https://host/?token=x"]) {
    assert.throws(() => endpointURL(bad));
  }
});

test("model output must preserve fragment boundaries and dictionary placeholders", () => {
  const parts = ["Use ⟦0⟧", null];
  assert.deepEqual(readTranslation('```json\n[["使用 ",""],null]\n```', parts), ["使用 ⟦0⟧", null]);
  for (const bad of ['["使用"]', '["使用",null]', '["⟦0⟧⟦0⟧",null]', '["⟦0⟧","extra"]', "bad"]) {
    assert.throws(() => readTranslation(bad, parts));
  }
});

test("rich-text terms stay in their source DOM fragments even with repeated local IDs", async () => {
  const p = profile(), send = boot(p);
  const parts = ["Your minions inflict ⟦0⟧", null, "on hit with ⟦0⟧ and ⟦1⟧.", "Chaos", "damage."];
  p.output = JSON.stringify({ p0: ["玩法"], p1: [["你的召唤物施加", ""], null, ["击中时使用", "和", "。"], "混沌", "伤害。"] });
  const { rows } = await send({ type: "TRANSLATE_PROSE_BATCH", paragraphs: [["Gameplay"], parts] });
  const payload = JSON.parse(JSON.parse(p.requests[0].options.body).messages[1].content);
  assert.deepEqual(payload.p1, [["Your minions inflict ", ""], null, ["on hit with ", " and ", "."], "Chaos", "damage."]);
  const expected = ["你的召唤物施加⟦0⟧", null, "击中时使用⟦0⟧和⟦1⟧。", "混沌", "伤害。"];
  assert.deepEqual(Array.from(rows[1].result), expected);
  assert.deepEqual(Array.from((await boot(p)({ parts })).result), expected);
  assert.equal(p.requests.length, 1);
  for (const reply of [
    ["你的召唤物通过", null, "在击中时施加 ⟦0⟧", "混沌", "伤害。"],
    [["甲", "乙"], null, ["甲", "乙", "丙"], "混沌", "伤害。"],
    [["甲", ""], null, ["⟦9⟧", "乙", "丙"], "混沌", "伤害。"]
  ]) assert.throws(() => readTranslation(JSON.stringify(reply), parts));
});

// Boot a fresh service worker around the same persisted profile to exercise its public message path.
function profile() {
  return {
    llm: { enabled: true, revision: "r1", model: "test-model", endpoint: "https://example.test/v1",
      apiKey: "test-key", prompt: DEFAULT_PROMPT },
    cache: new Map(), requests: [], logs: [], language: "zh-CN", permission: true, status: 200
  };
}
function boot(p) {
  let listener;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: s => "chrome-extension://fixture/" + s },
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({ llm: p.llm }) }, sync: { get: async () => ({ language: p.language }) },
      onChanged: { addListener() {} } },
    permissions: { contains: async () => p.permission }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"), {
    PoeLLM, PoeGuideSites, importScripts() {}, chrome, crypto: require("node:crypto").webcrypto, TextEncoder, AbortController, DOMException,
    setTimeout: p.setTimeout || setTimeout, clearTimeout, setInterval, clearInterval,
    readCache: async key => p.cache.get(key), writeCache: async (key, value, meta) => p.cache.set(key, { value, ...meta }),
    addApiLog: async row => { if (p.logError) throw Error("disk full"); p.logs.push(row); },
    clearCache: async () => p.cache.clear(),
    async fetch(url, options) {
      p.requests.push({ url: url.href, options });
      const untilAbort = () => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      if (p.hang === "headers") return untilAbort();
      await new Promise(resolve => setTimeout(resolve, 10));
      const parts = JSON.parse(JSON.parse(options.body).messages[1].content);
      if (p.networkError) throw p.networkError;
      return { ok: p.status === 200, status: p.status,
        headers: { get: name => ({ "content-type": p.mime ?? "application/json", "x-request-id": "fixture-id" })[name] },
        text: async () => p.hang === "body" ? untilAbort() : p.raw ?? JSON.stringify({ usage: p.usage, choices: [{ message: { content: p.output ?? JSON.stringify(parts) } }] }) };
    }
  });
  return (message = {}, sender = { frameId: 0, url: "https://mobalytics.gg/poe/builds/fixture" }) =>
    new Promise(resolve => listener({ type: "TRANSLATE_PROSE", revision: p.llm.revision, language: p.language,
      parts: ["Use ⟦0⟧ to cross gaps."], ...message }, sender, resolve));
}

test("header and body deadlines are independent, logged by stage and never auto-retried", async () => {
  for (const stage of ["headers", "body"]) {
    const p = profile(), deadlines = [];
    p.hang = stage;
    p.llm.bodyTimeoutSeconds = 180;
    p.setTimeout = (fn, ms) => {
      deadlines.push(ms);
      return setTimeout(fn, stage === "headers" || ms === 180000 ? 0 : 500);
    };
    const reply = await boot(p)();
    assert.match(reply.error, stage === "headers" ? /响应头超过 28 秒/ : /响应正文超过 180 秒/);
    assert.deepEqual(deadlines, stage === "headers" ? [28000] : [28000, 180000]);
    assert.equal(p.logs.length, 1);
    assert.equal(p.requests.length, 1);
    assert.equal(p.cache.size, 0);
  }
  for (const invalid of [undefined, 0, 241, "60"]) assert.equal(PoeLLM.bodyTimeoutSeconds(invalid), 120);
});

test("identical concurrent requests share a POST and a restarted worker reuses the cached translation", async () => {
  const p = profile(), send = boot(p);
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results[0].result, results[1].result);
  assert.equal(p.requests.length, 1);
  const { options, url } = p.requests[0];
  assert.equal(url, "https://example.test/v1/chat/completions");
  assert.equal(options.headers.Authorization, "Bearer test-key");
  assert.equal(options.redirect, "error");
  assert.equal(options.credentials, "omit");
  assert.doesNotMatch(options.body, /test-key|mobalytics\.gg/);
  p.llm.apiKey = "rotated";
  p.llm.revision = "r2";
  await boot(p)();
  assert.equal(p.requests.length, 1);
  assert.equal(p.logs.length, 1);
  assert.equal(p.logs[0].ok, true);
  assert.equal(p.logs[0].preview, undefined);
  assert.equal([...p.cache.values()][0].source[0], "Use ⟦0⟧ to cross gaps.");
  for (const change of [() => { p.language = "zh-TW"; }, () => { p.llm.model += "2"; },
    () => { p.llm.prompt += " 自定义"; }, () => { p.llm.endpoint += "/other"; }]) {
    const before = p.requests.length;
    change();
    assert.ok((await send()).result);
    assert.equal(p.requests.length, before + 1);
  }
  await send({ parts: ["New author text."] });
  assert.equal(p.requests.length, 6);
  assert.equal((await send({ type: "CLEAR_PROSE_CACHE" })).ok, undefined);
  assert.equal(p.cache.size, 6);
  await send({ type: "CLEAR_PROSE_CACHE" }, { url: "chrome-extension://fixture/popup/options.html" });
  assert.equal(p.cache.size, 0);
});

test("failure logs identify the response layer, bound the preview and mask credentials", async () => {
  const p = profile(), send = boot(p);
  p.mime = "text/html";
  p.raw = "<html>gateway test-key Bearer secondary-token</html>" + "x".repeat(5000);
  assert.match((await send()).error, /API 日志/);
  let log = p.logs.at(-1);
  assert.equal(log.stage, "解析 API 响应");
  assert.equal(log.status, 200);
  assert.equal(log.contentType, "text/html");
  assert.equal(log.requestId, "fixture-id");
  assert.match(log.preview, /<html>gateway.*已隐藏/);
  assert.match(log.preview, /已截断/);
  assert.doesNotMatch(JSON.stringify(log), /test-key|secondary-token/);
  p.status = 429;
  p.raw = '{"error":{"code":"quota_exceeded"}}';
  await send();
  assert.match(p.logs.at(-1).preview, /quota_exceeded/);
  assert.equal(p.logs.at(-1).stage, "HTTP 错误");
  p.status = 200;
  p.raw = undefined;
  p.output = '["wrong"]';
  assert.match((await send()).error, /术语占位符/);
  assert.equal(p.logs.at(-1).stage, "校验译文格式");
  p.networkError = new TypeError("Failed to fetch");
  await send();
  log = p.logs.at(-1);
  assert.equal(log.status, undefined);
  assert.match(log.detail, /TypeError.*Failed to fetch/);
  assert.equal(p.cache.size, 0);
  p.networkError = null;
  p.output = null;
  p.logError = true;
  assert.ok((await send()).result);
});

test("Maxroll build guides use the same cache; other hosts, games, paths and subframes cannot request translation", async () => {
  const p = profile(), send = boot(p);
  const url = "https://maxroll.gg/poe/build-guides/example";
  await send();
  for (const host of [url, url.replace("maxroll.gg", "www.maxroll.gg")]) {
    assert.ok((await send({}, { frameId: 0, url: host })).result);
  }
  assert.equal(p.requests.length, 1);
  for (const invalid of [url.replace("/poe/", "/poe2/"), url.replace("maxroll.gg", "maxroll.gg.example"),
    url.replace("/build-guides/", "/planner/"), url.replace("https:", "http:")]) {
    assert.ok((await send({}, { frameId: 0, url: invalid })).error);
  }
  assert.ok((await send({}, { frameId: 1, url })).error);
});

test("failed requests and malformed outputs remain retryable; disabled, stale and untrusted callers cannot bill", async () => {
  const p = profile(), send = boot(p);
  assert.equal(JSON.stringify(await send({ type: "PROSE_STATE" })), '{"revision":"r1","automatic":true}');
  assert.ok((await send({}, { frameId: 0, url: "https://other.example/" })).error);
  assert.ok((await send({ language: "en" })).stale);
  assert.ok((await send({ revision: "old" })).stale);
  assert.ok((await send({ parts: [] })).error);
  p.llm.enabled = false;
  assert.ok((await send()).stale);
  p.llm.enabled = true;
  p.permission = false;
  assert.ok((await send()).error);
  assert.equal(p.requests.length, 0);
  p.permission = true;
  p.status = 429;
  assert.match((await send()).error, /429/);
  p.status = 200;
  p.output = '["invalid placeholder"]';
  assert.ok((await send()).error);
  assert.equal(p.cache.size, 0);
  p.output = null;
  assert.ok((await send()).result);
  assert.equal(p.cache.size, 1);
});

test("configured manual requests share the automatic cache and still require a current revision and Chinese language", async () => {
  const p = profile(), send = boot(p);
  p.llm.enabled = false;
  assert.ok((await send()).stale);
  assert.ok((await send({ manual: true, revision: "old" })).stale);
  assert.ok((await send({ manual: true, language: "en" })).stale);
  assert.equal(p.requests.length, 0);
  assert.ok((await send({ manual: true })).result);
  p.llm.enabled = true;
  assert.ok((await send()).result);
  assert.equal(p.requests.length, 1);
});

test("sixteen paragraphs share one prompt, and cached or duplicate rows are never resubmitted", async () => {
  const p = profile(), send = boot(p);
  const paragraphs = Array.from({ length: 16 }, (_, i) => ["Use setup " + i, null]);
  p.usage = { prompt_tokens: 240, completion_tokens: 85 };
  const batch = paragraphs => send({ type: "TRANSLATE_PROSE_BATCH", paragraphs });
  const first = await batch(paragraphs);
  assert.deepEqual(JSON.parse(JSON.stringify(first.rows.map(row => row.result))), paragraphs);
  assert.equal(p.requests.length, 1);
  const messages = JSON.parse(p.requests[0].options.body).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content.split(DEFAULT_PROMPT).length, 2);
  assert.equal(Object.keys(JSON.parse(messages[1].content)).length, 16);
  assert.equal(p.logs[0].paragraphs, 16);
  assert.equal(p.logs[0].inputTokens, 240);
  assert.equal(p.logs[0].outputTokens, 85);
  const fresh = ["Only new line"];
  const mixed = await batch([paragraphs[4], fresh, fresh, paragraphs[2]]);
  assert.deepEqual(mixed.rows[1], mixed.rows[2]);
  assert.equal(p.requests.length, 2);
  assert.deepEqual(JSON.parse(JSON.parse(p.requests[1].options.body).messages[1].content), fresh);
  await boot(p)({ parts: paragraphs[10] });
  assert.equal(p.requests.length, 2);
});

test("partial and reordered replies keep valid paragraphs and retry only the failed row", async () => {
  const p = profile(), send = boot(p);
  const paragraphs = [["First"], ["Second ⟦0⟧"], ["Third"]];
  const batch = () => send({ type: "TRANSLATE_PROSE_BATCH", paragraphs });
  p.output = JSON.stringify({ p2: ["三"], p1: ["二"], p0: ["一"] });
  const first = await batch();
  assert.equal(first.rows[0].result[0], "一");
  assert.match(first.rows[1].error, /p1.*占位符/);
  assert.equal(first.rows[2].result[0], "三");
  assert.equal(p.cache.size, 2);
  assert.equal(p.logs[0].ok, false);
  p.output = '["二 ⟦0⟧"]';
  assert.equal((await batch()).rows[1].result[0], "二 ⟦0⟧");
  assert.equal(p.logs[1].paragraphs, 1);
  assert.equal(p.cache.size, 3);
});

test("overlapping batches reserve identical cache keys, and over-limit messages cannot bill", async () => {
  const p = profile(), send = boot(p);
  const batch = paragraphs => send({ type: "TRANSLATE_PROSE_BATCH", paragraphs });
  const [a, b] = await Promise.all([batch([["A"], ["B"]]), batch([["B"], ["C"]])]);
  assert.deepEqual(a.rows[1], b.rows[0]);
  assert.equal(p.logs.reduce((sum, log) => sum + log.paragraphs, 0), 3);
  for (const invalid of [[], Array(17).fill(["A"]), [["x".repeat(6000)], ["B"]], [Array(120).fill("x"), ["B"]]]) {
    assert.ok((await batch(invalid)).error);
  }
  assert.equal(p.cache.size, 3);
  assert.equal(p.requests.length, 2);
});
