const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../src/llm.js");
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
  assert.deepEqual(readTranslation('```json\n["使用 ⟦0⟧",null]\n```', parts), ["使用 ⟦0⟧", null]);
  for (const bad of ['["使用"]', '["使用",null]', '["⟦0⟧⟦0⟧",null]', '["⟦0⟧","extra"]', "bad"]) {
    assert.throws(() => readTranslation(bad, parts));
  }
});

// Boot a fresh service worker around the same persisted profile to exercise its public message path.
function profile() {
  return {
    llm: { enabled: true, revision: "r1", model: "test-model", endpoint: "https://example.test/v1",
      apiKey: "test-key", prompt: DEFAULT_PROMPT },
    cache: new Map(), requests: [], language: "zh-CN", permission: true, status: 200
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
    PoeLLM, importScripts() {}, chrome, crypto: require("node:crypto").webcrypto, TextEncoder, AbortSignal,
    readCache: async key => p.cache.get(key), writeCache: async (key, value) => p.cache.set(key, { value }),
    clearCache: async () => p.cache.clear(),
    async fetch(url, options) {
      p.requests.push({ url: url.href, options });
      await new Promise(resolve => setTimeout(resolve, 10));
      const parts = JSON.parse(JSON.parse(options.body).messages[1].content);
      return { ok: p.status === 200, status: p.status,
        json: async () => ({ choices: [{ message: { content: p.output ?? JSON.stringify(parts) } }] }) };
    }
  });
  return (message = {}, sender = { frameId: 0, url: "https://mobalytics.gg/poe/builds/fixture" }) =>
    new Promise(resolve => listener({ type: "TRANSLATE_PROSE", revision: p.llm.revision, language: p.language,
      parts: ["Use ⟦0⟧ to cross gaps."], ...message }, sender, resolve));
}

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
