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
    const llm = { enabled, endpoint: url?.href || "", model, apiKey: $("api-key").value.trim(), prompt, revision: crypto.randomUUID() };
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
  } catch { $("cache-feedback").textContent = "清空失败，请重试。"; }
};
loadConfig().catch(() => { $("feedback").textContent = "无法读取本地设置，请重载扩展。"; });
