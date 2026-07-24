(function startMobalyticsTranslation() {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    language: "zh-CN",
    displayMode: "translated"
  });
  const IGNORED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "CODE",
    "PRE"
  ]);
  const TRANSLATABLE_ATTRIBUTES = ["title", "aria-label"];

  const entries = globalThis.POE1_SKILL_GEMS ?? [];
  const { createLookup, translateText } = globalThis.PoeTranslationCore;
  const lookup = createLookup(entries);
  const originalText = new WeakMap();
  const renderedText = new WeakMap();
  const originalAttributes = new WeakMap();
  const renderedAttributes = new WeakMap();

  let settings = { ...DEFAULT_SETTINGS };
  let translatedNodes = 0;
  let observer;
  let scheduled = false;
  let floatingControls;
  const pendingRoots = new Set();

  function createFloatingControls() {
    if (document.querySelector("#poe-cn-translator-root")) return;

    const host = document.createElement("div");
    host.id = "poe-cn-translator-root";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          color-scheme: dark;
          font-family: Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        button,
        input {
          font: inherit;
        }

        .launcher {
          position: fixed;
          right: 24px;
          bottom: 24px;
          z-index: 2147483646;
          display: grid;
          width: 48px;
          height: 48px;
          padding: 0;
          place-items: center;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 15px;
          background: linear-gradient(145deg, #8d6cff, #5935dd);
          box-shadow: 0 10px 32px rgba(33, 19, 91, 0.5);
          color: #fff;
          cursor: pointer;
          font-size: 20px;
          font-weight: 800;
          transition: transform 150ms ease, box-shadow 150ms ease;
        }

        .launcher:hover {
          transform: translateY(-2px);
          box-shadow: 0 14px 38px rgba(33, 19, 91, 0.62);
        }

        .launcher:focus-visible,
        .close:focus-visible,
        .languages button:focus-visible,
        .switch input:focus-visible + span {
          outline: 2px solid #c5b8ff;
          outline-offset: 3px;
        }

        .panel {
          position: fixed;
          right: 24px;
          bottom: 82px;
          z-index: 2147483647;
          width: min(330px, calc(100vw - 32px));
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          background:
            radial-gradient(circle at 92% -18%, rgba(117, 87, 255, 0.3), transparent 48%),
            #111522;
          box-shadow: 0 20px 55px rgba(0, 0, 0, 0.55);
          color: #f4f5f8;
          animation: appear 140ms ease-out;
        }

        .panel[hidden] {
          display: none;
        }

        @keyframes appear {
          from {
            opacity: 0;
            transform: translateY(7px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 16px 12px;
        }

        .eyebrow {
          margin: 0 0 2px;
          color: #9299aa;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        h2 {
          margin: 0;
          font-size: 15px;
          line-height: 1.35;
        }

        .close {
          display: grid;
          width: 30px;
          height: 30px;
          padding: 0;
          place-items: center;
          border: 0;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.06);
          color: #aeb4c2;
          cursor: pointer;
          font-size: 18px;
        }

        .close:hover {
          background: rgba(255, 255, 255, 0.11);
          color: #fff;
        }

        .content {
          padding: 0 16px 16px;
        }

        .label {
          display: block;
          margin: 8px 0 8px;
          color: #aeb4c2;
          font-size: 11px;
          font-weight: 650;
        }

        .languages {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 5px;
          padding: 4px;
          border-radius: 11px;
          background: #0c0f19;
        }

        .languages button {
          min-width: 0;
          padding: 8px 5px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: #9299aa;
          cursor: pointer;
          font-size: 12px;
        }

        .languages button[aria-pressed="true"] {
          background: #6f50ee;
          box-shadow: 0 4px 12px rgba(74, 44, 190, 0.35);
          color: #fff;
        }

        .option {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 12px;
          padding: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 11px;
          background: rgba(255, 255, 255, 0.035);
        }

        .option strong {
          display: block;
          margin-bottom: 2px;
          font-size: 12px;
        }

        .option small {
          color: #8f96a7;
          font-size: 10px;
        }

        .switch {
          position: relative;
          flex: 0 0 auto;
        }

        .switch input {
          position: absolute;
          opacity: 0;
        }

        .switch span {
          display: block;
          width: 40px;
          height: 23px;
          padding: 3px;
          border-radius: 99px;
          background: #353b4a;
          cursor: pointer;
          transition: 150ms ease;
        }

        .switch span::after {
          display: block;
          width: 17px;
          height: 17px;
          border-radius: 50%;
          background: #fff;
          content: "";
          transition: 150ms ease;
        }

        .switch input:checked + span {
          background: #6f50ee;
        }

        .switch input:checked + span::after {
          transform: translateX(17px);
        }

        .status {
          display: flex;
          align-items: center;
          gap: 7px;
          margin: 12px 2px 0;
          color: #858c9d;
          font-size: 10px;
        }

        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #55d6a6;
          box-shadow: 0 0 0 3px rgba(85, 214, 166, 0.12);
        }

        @media (max-width: 540px) {
          .launcher {
            right: 16px;
            bottom: 16px;
          }

          .panel {
            right: 16px;
            bottom: 72px;
          }
        }
      </style>

      <button
        class="launcher"
        type="button"
        aria-label="打开 PoE 中文化设置"
        aria-expanded="false"
        title="PoE 中文化"
      >译</button>

      <section class="panel" aria-label="PoE 中文化设置" hidden>
        <div class="header">
          <div>
            <p class="eyebrow">Mobalytics · PoE 1</p>
            <h2>技能石中文化</h2>
          </div>
          <button class="close" type="button" aria-label="隐藏设置">×</button>
        </div>
        <div class="content">
          <span class="label">显示语言</span>
          <div class="languages" role="group" aria-label="显示语言">
            <button type="button" data-language="zh-CN">简体</button>
            <button type="button" data-language="zh-TW">繁體</button>
            <button type="button" data-language="en">English</button>
          </div>
          <div class="option">
            <div>
              <strong>保留英文</strong>
              <small>重盾冲锋 (Shield Charge)</small>
            </div>
            <label class="switch">
              <input type="checkbox" aria-label="保留英文">
              <span aria-hidden="true"></span>
            </label>
          </div>
          <div class="status">
            <span class="dot" aria-hidden="true"></span>
            <span>已载入 ${entries.length} 条 PoE 1 技能石词条</span>
          </div>
        </div>
      </section>
    `;

    const launcher = shadow.querySelector(".launcher");
    const panel = shadow.querySelector(".panel");
    const close = shadow.querySelector(".close");
    const languageButtons = [...shadow.querySelectorAll("[data-language]")];
    const bilingual = shadow.querySelector('input[type="checkbox"]');

    function setOpen(open) {
      panel.hidden = !open;
      launcher.setAttribute("aria-expanded", String(open));
      launcher.setAttribute(
        "aria-label",
        open ? "隐藏 PoE 中文化设置" : "打开 PoE 中文化设置"
      );
    }

    launcher.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));
    shadow.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        launcher.focus();
      }
    });

    for (const button of languageButtons) {
      button.addEventListener("click", () => {
        chrome.storage.sync.set({ language: button.dataset.language });
      });
    }

    bilingual.addEventListener("change", () => {
      chrome.storage.sync.set({
        displayMode: bilingual.checked ? "bilingual" : "translated"
      });
    });

    document.body.append(host);
    floatingControls = {
      update(nextSettings) {
        for (const button of languageButtons) {
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.language === nextSettings.language)
          );
        }
        bilingual.checked = nextSettings.displayMode === "bilingual";
      }
    };
  }

  function shouldIgnore(node) {
    const parent = node.parentElement;
    return !parent || IGNORED_TAGS.has(parent.tagName) || parent.isContentEditable;
  }

  function translateTextNode(node) {
    if (shouldIgnore(node)) return;

    const current = node.nodeValue ?? "";
    const lastRendered = renderedText.get(node);
    if (!originalText.has(node) || (lastRendered !== undefined && current !== lastRendered)) {
      originalText.set(node, current);
    }

    const source = originalText.get(node);
    const output = translateText(source, lookup, settings);
    renderedText.set(node, output);

    if (output !== current) node.nodeValue = output;
    if (output !== source) translatedNodes += 1;
  }

  function translateElementAttributes(element) {
    if (IGNORED_TAGS.has(element.tagName)) return;

    let originals = originalAttributes.get(element);
    let rendered = renderedAttributes.get(element);
    if (!originals) {
      originals = new Map();
      originalAttributes.set(element, originals);
    }
    if (!rendered) {
      rendered = new Map();
      renderedAttributes.set(element, rendered);
    }

    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      if (!element.hasAttribute(attribute)) continue;

      const current = element.getAttribute(attribute) ?? "";
      if (!originals.has(attribute) || (
        rendered.has(attribute) && current !== rendered.get(attribute)
      )) {
        originals.set(attribute, current);
      }

      const source = originals.get(attribute);
      const output = translateText(source, lookup, settings);
      rendered.set(attribute, output);
      if (output !== current) element.setAttribute(attribute, output);
    }
  }

  function translateRoot(root) {
    if (!root || !root.isConnected) return;
    translatedNodes = 0;

    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
      return;
    }

    if (root.nodeType === Node.ELEMENT_NODE) translateElementAttributes(root);

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    );
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        translateTextNode(node);
      } else {
        translateElementAttributes(node);
      }
      node = walker.nextNode();
    }
  }

  function scheduleTranslation(root) {
    pendingRoots.add(root.nodeType === Node.TEXT_NODE ? root.parentElement : root);
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      for (const pendingRoot of roots) translateRoot(pendingRoot);
    });
  }

  function observePage() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          scheduleTranslation(mutation.target);
          continue;
        }
        if (mutation.type === "attributes") {
          scheduleTranslation(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes) {
          scheduleTranslation(node);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRIBUTES
    });
  }

  function applySettings(nextSettings) {
    settings = { ...DEFAULT_SETTINGS, ...nextSettings };
    floatingControls?.update(settings);
    translateRoot(document.body);
  }

  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    createFloatingControls();
    applySettings(stored);
    observePage();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    const next = { ...settings };
    if (changes.language) next.language = changes.language.newValue;
    if (changes.displayMode) next.displayMode = changes.displayMode.newValue;
    applySettings(next);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_TRANSLATION_STATUS") return;
    sendResponse({
      active: settings.language !== "en",
      language: settings.language,
      displayMode: settings.displayMode,
      dictionarySize: entries.length,
      translatedNodes
    });
  });
})();
