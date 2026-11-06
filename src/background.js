"use strict";
importScripts("llm.js", "llm-cache.js");

const { endpointURL, hostPattern, messages, PROTOCOL, validParts, readTranslation } = PoeLLM;
const inFlight = new Map();
const guidePage = /^https:\/\/(?:www\.)?mobalytics\.gg\/poe\/builds\//;
const privateStorage = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let cacheEpoch = 0;

async function translateParagraph(config, language, parts) {
  const url = endpointURL(config.endpoint);
  const input = JSON.stringify([PROTOCOL, url.href, config.model, config.prompt, language, parts]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const key = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
  if (inFlight.has(key)) return inFlight.get(key);
  const epoch = cacheEpoch;
  const task = (async () => {
    const cached = await readCache(key);
    if (cached) return cached.value;
    if (!await chrome.permissions.contains({ origins: [hostPattern(url)] })) {
      throw new Error("缺少 API 站点权限，请在正文翻译设置中重新保存。");
    }
    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
    let response;
    try {
      response = await fetch(url, {
        method: "POST", headers, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(28000),
        body: JSON.stringify({ model: config.model, messages: messages(config.prompt, language, parts), stream: false })
      });
    } catch {
      throw new Error("API 连接失败或超时，请检查端点和网络。");
    }
    if (!response.ok) throw new Error("API 返回 HTTP " + response.status + "，请检查密钥、模型、额度或服务状态。");
    let data;
    try { data = await response.json(); } catch { throw new Error("API 未返回有效 JSON，请检查端点。"); }
    if (data?.choices?.[0]?.finish_reason === "length") throw new Error("模型输出被截断，请调整模型后重试。");
    const result = readTranslation(data?.choices?.[0]?.message?.content, parts);
    if (epoch === cacheEpoch) await writeCache(key, result);
    return result;
  })();
  inFlight.set(key, task);
  try { return await task; } finally { inFlight.delete(key); }
}

async function handleMessage(message, sender) {
  if (message.type === "CLEAR_PROSE_CACHE") {
    if (sender.url !== chrome.runtime.getURL("popup/options.html")) throw new Error("来源无效。");
    cacheEpoch++;
    await clearCache();
    return { ok: true };
  }
  if (sender.frameId !== 0 || !guidePage.test(sender.url)) throw new Error("仅支持 PoE 1 攻略页。");
  if (message.type === "OPEN_PROSE_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  await privateStorage;
  const { llm } = await chrome.storage.local.get("llm");
  const revision = llm?.endpoint && llm.model ? llm.revision : null;
  if (message.type === "PROSE_STATE") return { revision, automatic: !!llm?.enabled };
  const { language } = await chrome.storage.sync.get({ language: "zh-CN" });
  if (!revision || (!llm.enabled && message.manual !== true) || revision !== message.revision || message.language !== language ||
      !["zh-CN", "zh-TW"].includes(language)) return { stale: true };
  if (!validParts(message.parts)) throw new Error("段落超过处理限制或内容格式有误。");
  return { result: await translateParagraph(llm, language, message.parts) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!["PROSE_STATE", "TRANSLATE_PROSE", "CLEAR_PROSE_CACHE", "OPEN_PROSE_OPTIONS"].includes(message?.type)) return;
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
