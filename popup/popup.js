"use strict";

const { normalizeSettings, CATEGORY_LABELS } = globalThis.PoeTranslationCore;
const DEFAULT_SETTINGS = normalizeSettings();
let currentSettings = DEFAULT_SETTINGS;

const languageInputs = [...document.querySelectorAll('input[name="language"]')];
const bilingualInput = document.querySelector("#bilingual");
const statusElement = document.querySelector("#status");
const statusDot = document.querySelector(".status-dot");
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
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id || !tab.url?.match(/^https:\/\/(www\.)?mobalytics\.gg\/poe\/builds\//)) {
      statusElement.textContent = "请在 Mobalytics PoE 攻略页使用";
      statusDot.classList.remove("active");
      return;
    }

    chrome.tabs.sendMessage(
      tab.id,
      { type: "GET_TRANSLATION_STATUS" },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          statusElement.textContent = "刷新页面后即可启用";
          statusDot.classList.remove("active");
          return;
        }

        statusElement.textContent =
          response.language === "en"
            ? `已载入 ${response.dictionarySize} 条词条 · 当前显示英文`
            : `已载入 ${response.dictionarySize} 条词条 · ${response.active ? "翻译已启用" : "翻译已关闭"}`;
        statusDot.classList.toggle("active", response.active);
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

chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
  renderSettings(settings);
  updateStatus();
});

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
