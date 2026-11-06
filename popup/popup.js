"use strict";

const { normalizeSettings, CATEGORY_LABELS } = globalThis.PoeTranslationCore;
const DEFAULT_SETTINGS = normalizeSettings();
let currentSettings = DEFAULT_SETTINGS;

const languageInputs = [...document.querySelectorAll('input[name="language"]')];
const bilingualInput = document.querySelector("#bilingual");
const statusElement = document.querySelector("#status");
const statusDot = document.querySelector(".status-dot");
const startProse = document.querySelector("#start-prose");
const proseStatus = document.querySelector("#prose-status");
const categoryContainer = document.querySelector("#categories");
const categoryInputs = Object.entries(CATEGORY_LABELS).map(([key, label]) => {
  const row = document.createElement("label");
  row.className = "category-row";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.category = key;
  row.append(text, input);
  categoryContainer.append(row);
  input.addEventListener("change", () => {
    saveSettings({ categories: { ...currentSettings.categories, [key]: input.checked } });
    window.setTimeout(updateStatus, 80);
  });
  return input;
});

function saveSettings(partial) {
  currentSettings = normalizeSettings({ ...currentSettings, ...partial });
  chrome.storage.sync.set(partial);
}

function updateStatus() {
  clearTimeout(statusTimer);
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id || !globalThis.PoeGuideSites.forURL(tab.url)) {
      statusElement.textContent = "请在 Mobalytics 或 Maxroll 的 PoE 1 攻略页使用";
      statusDot.classList.remove("active");
      startProse.disabled = true;
      proseStatus.textContent = "请先打开 PoE 1 攻略页";
      return;
    }

    chrome.tabs.sendMessage(
      tab.id,
      { type: "GET_TRANSLATION_STATUS" },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          statusElement.textContent = "刷新页面后即可启用";
          statusDot.classList.remove("active");
          startProse.disabled = true;
          proseStatus.textContent = "请刷新攻略页以加载扩展";
          return;
        }

        statusElement.textContent =
          response.language === "en"
            ? `已载入 ${response.dictionarySize} 条词条 · 当前显示英文`
            : `已载入 ${response.dictionarySize} 条词条 · ${response.active ? "翻译已启用" : "翻译已关闭"}`;
        statusDot.classList.toggle("active", response.active);
        proseStatus.textContent = response.proseCanStart === undefined ? "请刷新攻略页以加载新版本。" : response.proseStatus;
        startProse.disabled = !response.proseCanStart;
        document.querySelector("#open-logs").hidden = !response.proseFailed;
        startProse.textContent = response.proseFailed ? "重试正文翻译" : "翻译本页正文";
        if (response.proseBusy) statusTimer = setTimeout(updateStatus, 1800);
      }
    );
  });
}

function renderSettings(stored) {
  const settings = normalizeSettings(stored);
  currentSettings = settings;
  const selected = languageInputs.find((input) => input.value === settings.language);
  if (selected) selected.checked = true;
  bilingualInput.checked = settings.displayMode === "bilingual";
  for (const input of categoryInputs) input.checked = settings.categories[input.dataset.category];
}

let statusTimer;
chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
  renderSettings(settings);
  updateStatus();
});

document.querySelector("#open-options").onclick = () => chrome.runtime.openOptionsPage();
document.querySelector("#open-logs").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("popup/options.html#api-logs") });
startProse.onclick = async () => {
  startProse.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "START_PROSE" });
    updateStatus();
  } catch { proseStatus.textContent = "请刷新攻略页后重试"; }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const next = { ...currentSettings };
  for (const key of ["language", "displayMode", "categories"]) {
    if (changes[key]) next[key] = changes[key].newValue;
  }
  renderSettings(next);
  updateStatus();
});

for (const input of languageInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    saveSettings({ language: input.value });
    window.setTimeout(updateStatus, 80);
  });
}

bilingualInput.addEventListener("change", () => {
  saveSettings({
    displayMode: bilingualInput.checked ? "bilingual" : "translated"
  });
  window.setTimeout(updateStatus, 80);
});
