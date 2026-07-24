"use strict";

const DEFAULT_SETTINGS = {
  language: "zh-CN",
  displayMode: "translated"
};

const languageInputs = [...document.querySelectorAll('input[name="language"]')];
const bilingualInput = document.querySelector("#bilingual");
const statusElement = document.querySelector("#status");
const statusDot = document.querySelector(".status-dot");

function saveSettings(partial) {
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
            : `已载入 ${response.dictionarySize} 条词条 · 翻译已启用`;
        statusDot.classList.toggle("active", response.active);
      }
    );
  });
}

chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
  const selected = languageInputs.find((input) => input.value === settings.language);
  if (selected) selected.checked = true;
  bilingualInput.checked = settings.displayMode === "bilingual";
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
