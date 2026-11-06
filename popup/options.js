"use strict";

const $ = id => document.getElementById(id);
const { DEFAULT_PROMPT, endpointURL, hostPattern } = globalThis.PoeLLM;
let savedOrigin, savedKey;

async function loadConfig() {
  // Set the access boundary before storing even the first credential.
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const { llm = {} } = await chrome.storage.local.get("llm");
  $("enabled").checked = !!llm.enabled;
  $("endpoint").value = llm.endpoint || "";
  $("model").value = llm.model || "";
  $("body-timeout").value = PoeLLM.bodyTimeoutSeconds(llm.bodyTimeoutSeconds);
  $("api-key").value = llm.apiKey || "";
  savedOrigin = llm.endpoint && endpointURL(llm.endpoint).origin;
  savedKey = $("api-key").value;
  $("prompt").value = llm.prompt || DEFAULT_PROMPT;
  $("save").disabled = false;
}

$("endpoint").onchange = () => {
  let origin;
  try { origin = endpointURL($("endpoint").value.trim()).origin; } catch { return; }
  if (savedOrigin && savedOrigin !== origin && savedKey && $("api-key").value === savedKey) {
    $("api-key").value = "";
    $("feedback").textContent = "已切换服务地址，请填写新服务的密钥。";
  }
};

$("config").onsubmit = async event => {
  event.preventDefault();
  $("save").disabled = true;
  try {
    const enabled = $("enabled").checked, model = $("model").value.trim();
    const endpoint = $("endpoint").value.trim(), prompt = $("prompt").value.trim();
    const url = endpoint ? endpointURL(endpoint) : null;
    if (enabled && (!url || !model)) throw new Error("请填写 API 端点和模型名称。");
    if (!prompt) throw new Error("请填写翻译提示词。");
    if (url && model && !await chrome.permissions.request({ origins: [hostPattern(url)] })) {
      throw new Error("未获得端点访问权限，设置尚未保存。");
    }
    const llm = { enabled, endpoint: url?.href || "", model, apiKey: $("api-key").value.trim(), prompt,
      bodyTimeoutSeconds: $("body-timeout").valueAsNumber, revision: crypto.randomUUID() };
    await chrome.storage.local.set({ llm });
    savedOrigin = url?.origin;
    savedKey = llm.apiKey;
    $("feedback").textContent = "设置已保存";
  } catch (error) { $("feedback").textContent = error.message; }
  finally { $("save").disabled = false; }
};
$("restore").onclick = () => {
  $("prompt").value = DEFAULT_PROMPT;
  $("feedback").textContent = "已填入默认提示词，保存后生效。";
};
$("clear").onclick = async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_PROSE_CACHE" });
    $("cache-feedback").textContent = response?.ok ? "缓存已清空" : "清空失败，请重试。";
    await showPage("cache", 0);
  } catch { $("cache-feedback").textContent = "清空失败，请重试。"; }
};

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function localTime(timestamp) { return new Date(timestamp).toLocaleString("zh-CN", { hour12: false }); }
function cacheRow(row) {
  const details = document.createElement("details");
  const join = parts => parts.map(p => p ?? "〔本地词条〕").join(" ");
  const translated = join(row.value);
  details.append(element("summary", translated.slice(0, 85)),
    element("small", [localTime(row.created), row.language, row.model].filter(Boolean).join(" · ")),
    element("h3", "待译片段"), element("pre", row.source ? join(row.source) : "旧版缓存仅保存了译文。"),
    element("h3", "译文"), element("pre", translated));
  return details;
}
function logRow(row) {
  const details = document.createElement("details");
  const summary = element("summary", [localTime(row.created), row.ok ? "成功" : row.stage, row.status && "HTTP " + row.status, (row.paragraphs ?? 1) + " 段", row.model].filter(Boolean).join(" · "));
  summary.className = row.ok ? "success" : "failure";
  const lines = [
    "POST " + row.endpoint,
    "目标语言 " + row.language + " · " + row.parts + " 个片段 · " + row.chars + " 字符 · " + row.duration + " ms",
    row.headersMs != null && `收到响应头用时 ${row.headersMs} ms · 正文等待上限 ${row.bodyTimeoutSeconds} 秒`,
    row.inputTokens != null && "输入 token  " + row.inputTokens,
    row.outputTokens != null && "输出 token  " + row.outputTokens,
    "Content-Type  " + (row.contentType || "未收到"),
    row.requestId && "Request ID  " + row.requestId,
    row.error, row.detail
  ];
  details.append(summary, element("pre", lines.filter(Boolean).join("\n")));
  if (!row.ok) details.append(element("h3", "服务端响应"), element("pre", row.preview || "（无响应正文）"));
  return details;
}
const pages = { cache: 0, log: 0 };
const versions = { cache: 0, log: 0 };
async function showPage(kind, page) {
  const version = ++versions[kind];
  const cache = kind === "cache";
  try {
    const result = await listPage(cache ? "paragraphs" : "apiLogs", page);
    if (versions[kind] !== version) return;
    pages[kind] = result.page;
    const totalPages = Math.ceil(result.count / PAGE_SIZE);
    $(kind + "-list").replaceChildren(...result.rows.map(cache ? cacheRow : logRow));
    $(kind + "-page").textContent = totalPages ? (result.page + 1) + " / " + totalPages + " 页" : cache ? "暂无译文缓存" : "暂无 API 日志";
    $(kind + "-prev").disabled = !result.page;
    $(kind + "-next").disabled = result.page + 1 >= totalPages;
    if (cache) {
      $("cache-count").textContent = "已缓存 " + result.count.toLocaleString() + " / " + result.limit.toLocaleString() + " 条";
      $("cache-usage").max = result.limit;
      $("cache-usage").value = result.count;
      if (!$("limit").value) $("limit").value = result.limit;
    }
  } catch (error) { $(kind + "-feedback").textContent = "读取失败：" + error.message; }
}
for (const kind of ["cache", "log"]) {
  $(kind + "-prev").onclick = () => showPage(kind, pages[kind] - 1);
  $(kind + "-next").onclick = () => showPage(kind, pages[kind] + 1);
  $(kind + "-refresh").onclick = () => showPage(kind, pages[kind]);
  void showPage(kind, 0);
}
$("capacity").onsubmit = async event => {
  event.preventDefault();
  try {
    await setCacheLimit($("limit").valueAsNumber);
    $("cache-feedback").textContent = "缓存上限已生效";
    await showPage("cache", 0);
  } catch (error) { $("cache-feedback").textContent = error.message; }
};
$("clear-logs").onclick = async () => {
  try {
    await clearApiLogs();
    $("log-feedback").textContent = "日志已清空";
    await showPage("log", 0);
  } catch (error) { $("log-feedback").textContent = error.message; }
};
loadConfig().catch(() => { $("feedback").textContent = "无法读取本地设置，请重载扩展。"; });
