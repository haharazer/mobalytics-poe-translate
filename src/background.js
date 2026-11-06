"use strict";
importScripts("guide-sites.js", "llm.js", "llm-cache.js");

const { endpointURL, hostPattern, messages, PROTOCOL, validParts, fitsBatch, readBatch } = PoeLLM;
const inFlight = new Map();
const privateStorage = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let cacheEpoch = 0;

function diagnosticText(value, apiKey, maxLength = 4096) {
  let text = String(value ?? "");
  if (apiKey) {
    for (const secret of [apiKey, JSON.stringify(apiKey).slice(1, -1)]) {
      text = text.replaceAll(secret, "[已隐藏]");
    }
  }
  text = text.replace(/(Bearer\s+)[^\s"',<>]+/gi, "$1[已隐藏]")
    .replace(/("(?:api[_-]?key|access_token|authorization)"\s*:\s*")[^"]*/gi, "$1[已隐藏]");
  return text.length > maxLength ? text.slice(0, maxLength) + "\n…（已截断）" : text;
}

async function requestTranslation(url, config, language, paragraphs) {
  const clean = (value, length) => diagnosticText(value, config.apiKey, length);
  const parts = paragraphs.flat();
  const log = {
    created: Date.now(), endpoint: clean(url.href, 1024), model: clean(config.model, 200),
    language, paragraphs: paragraphs.length, parts: parts.length, chars: parts.join("").length, stage: "连接 API"
  };
  const headerTimeoutMs = 28000;
  const bodySeconds = PoeLLM.bodyTimeoutSeconds(config.bodyTimeoutSeconds);
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("插件等待响应超时", "TimeoutError"));
  let timer = setTimeout(abort, headerTimeoutMs);
  let keepAlive;
  let raw = "";
  try {
    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
    const response = await fetch(url, {
      method: "POST", headers, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      signal: controller.signal,
      body: JSON.stringify({ model: config.model, messages: messages(config.prompt, language, paragraphs), stream: false })
    });
    clearTimeout(timer);
    log.headersMs = Date.now() - log.created;
    log.bodyTimeoutSeconds = bodySeconds;
    timer = setTimeout(abort, bodySeconds * 1000);
    // Keep the MV3 worker awake only while an active response body is pending.
    keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);
    log.status = response.status;
    log.contentType = clean(response.headers.get("content-type"), 200);
    log.requestId = clean(response.headers.get("x-request-id") || response.headers.get("request-id"), 200);
    log.stage = "读取响应正文";
    raw = await response.text();
    if (!response.ok) {
      log.stage = "HTTP 错误";
      throw new Error("API 返回 HTTP " + response.status + "。");
    }
    log.stage = "解析 API 响应";
    let data;
    try { data = JSON.parse(raw); }
    catch (e) {
      log.detail = clean(e.message, 500);
      if (!raw.trim()) throw new Error("API 返回了空响应。");
      if (/^\s*</.test(raw)) throw new Error("API 返回了标记页面，请检查端点或代理。");
      if (/text\/event-stream/i.test(log.contentType)) throw new Error("API 返回了事件流，请检查非流式请求的兼容性。");
      throw new Error("API 未返回有效 JSON。");
    }
    log.stage = "读取模型回复";
    if (Number.isSafeInteger(data?.usage?.prompt_tokens)) log.inputTokens = data.usage.prompt_tokens;
    if (Number.isSafeInteger(data?.usage?.completion_tokens)) log.outputTokens = data.usage.completion_tokens;
    if (data?.error) throw new Error("API 在响应中报告错误。");
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("模型输出被截断。");
    if (typeof choice?.message?.content !== "string") throw new Error("API 响应缺少 choices[0].message.content 文本。");
    log.stage = "校验译文格式";
    const result = readBatch(choice.message.content, paragraphs);
    const errors = result.filter(row => row.error);
    log.ok = errors.length === 0;
    if (log.ok) log.stage = "完成";
    else {
      log.error = errors.map(row => row.error).join("\n");
      log.preview = clean(raw);
    }
    return result;
  } catch (e) {
    log.ok = false;
    let summary = e.message;
    if (log.stage === "连接 API" || log.stage === "读取响应正文") {
      log.detail = clean(e.name + " · " + e.message, 500);
      if (controller.signal.aborted) {
        summary = log.stage === "连接 API" ? "插件等待 API 响应头超过 28 秒，已取消请求。"
          : `已收到响应头，插件等待完整响应正文超过 ${bodySeconds} 秒，已取消请求。`;
      } else {
        summary = log.stage === "连接 API" ? "获取 API 响应头失败。" : "读取 API 响应正文时连接中断。";
      }
    }
    log.error = clean(summary, 500);
    log.preview = clean(raw);
    throw new Error(log.error + " 详见设置页「API 日志」。");
  } finally {
    clearTimeout(timer);
    clearInterval(keepAlive);
    log.duration = Date.now() - log.created;
    // Diagnostics must not turn a valid, paid response into a translation failure.
    await addApiLog(log).catch(() => {});
  }
}

async function paragraphKey(url, config, language, parts) {
  const input = JSON.stringify([PROTOCOL, url.href, config.model, config.prompt, language, parts]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}

async function translateBatch(config, language, paragraphs) {
  const url = endpointURL(config.endpoint);
  const epoch = cacheEpoch;
  const keys = await Promise.all(paragraphs.map(parts => paragraphKey(url, config, language, parts)));
  const owned = [];
  // Reserve all keys before awaiting storage so overlapping batches cannot bill twice.
  const replies = keys.map((key, i) => {
    if (!inFlight.has(key)) {
      const task = new Promise(resolve => owned.push({ key, parts: paragraphs[i], resolve }));
      inFlight.set(key, task);
    }
    return inFlight.get(key);
  });
  try {
    const cached = await Promise.all(owned.map(job => readCache(job.key)));
    const missing = owned.filter((job, i) => {
      if (cached[i]) job.resolve({ result: cached[i].value });
      return !cached[i];
    });
    if (missing.length) {
      if (!await chrome.permissions.contains({ origins: [hostPattern(url)] })) {
        throw new Error("缺少 API 站点权限，请在正文翻译设置中重新保存。");
      }
      const rows = await requestTranslation(url, config, language, missing.map(job => job.parts));
      await Promise.all(missing.map(async (job, i) => {
        const row = rows[i];
        if (row.result && epoch === cacheEpoch) {
          try { await writeCache(job.key, row.result, { source: job.parts, language, model: config.model }); }
          catch (e) { job.resolve({ error: e.message }); return; }
        }
        job.resolve(row.error ? { ...row, error: row.error + " 详见设置页「API 日志」。" } : row);
      }));
    }
  } catch (e) {
    for (const job of owned) job.resolve({ error: e.message });
  } finally {
    for (const job of owned) inFlight.delete(job.key);
  }
  return Promise.all(replies);
}

async function handleMessage(message, sender) {
  if (message.type === "CLEAR_PROSE_CACHE") {
    if (sender.url?.split("#")[0] !== chrome.runtime.getURL("popup/options.html")) throw new Error("来源无效。");
    cacheEpoch++;
    await clearCache();
    return { ok: true };
  }
  if (sender.frameId !== 0 || !PoeGuideSites.forURL(sender.url)) throw new Error("仅支持 PoE 1 攻略页。");
  if (message.type === "OPEN_PROSE_OPTIONS") {
    if (message.showLogs) await chrome.tabs.create({ url: chrome.runtime.getURL("popup/options.html#api-logs") });
    else await chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  await privateStorage;
  const { llm } = await chrome.storage.local.get("llm");
  const revision = llm?.endpoint && llm.model ? llm.revision : null;
  if (message.type === "PROSE_STATE") return { revision, automatic: !!llm?.enabled };
  const { language } = await chrome.storage.sync.get({ language: "zh-CN" });
  if (!revision || (!llm.enabled && message.manual !== true) || revision !== message.revision || message.language !== language ||
      !["zh-CN", "zh-TW"].includes(language)) return { stale: true };
  const batch = message.type === "TRANSLATE_PROSE_BATCH";
  const paragraphs = batch ? message.paragraphs : [message.parts];
  if (!Array.isArray(paragraphs) || !paragraphs.length || paragraphs.length > 16 || !paragraphs.every(validParts)) {
    throw new Error("段落超过处理限制或内容格式有误。");
  }
  const parts = paragraphs.flat();
  if (!fitsBatch(paragraphs.length, parts.join("").length, parts.length)) throw new Error("批量请求超过处理限制。");
  const rows = await translateBatch(llm, language, paragraphs);
  return batch ? { rows } : rows[0];
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!["PROSE_STATE", "TRANSLATE_PROSE", "TRANSLATE_PROSE_BATCH", "CLEAR_PROSE_CACHE", "OPEN_PROSE_OPTIONS"].includes(message?.type)) return;
  handleMessage(message, sender).then(respond, error => respond({ error: error.message }));
  return true;
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.llm) return;
  // Tabs need only the revision; the trusted settings page owns the credentials.
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "REFRESH_PROSE" }).catch(() => {});
  }
});
