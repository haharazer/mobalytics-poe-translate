(function startMobalyticsTranslation() {
  "use strict";

  const { createLookup, translateText, normalizeSettings, CATEGORY_LABELS } = globalThis.PoeTranslationCore;
  const { getContext } = globalThis.PoePageContext;
  const DEFAULT_SETTINGS = normalizeSettings();
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
  const INLINE_TAGS = new Set(["SPAN", "STRONG", "EM", "B", "I", "SMALL", "SUP", "SUB"]);

  const entries = [...(globalThis.POE1_SKILL_GEMS ?? []), ...(globalThis.POE1_CORE?.entries ?? []), ...(globalThis.POE1_EXTENDED?.entries ?? [])];
  const statRules = globalThis.POE1_EXTENDED?.statRules ?? [];
  const categorySizes = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((category) => [category,
    category === "stat" ? statRules.length : entries.filter((entry) => (entry.category ?? "skill") === category).length
  ]));
  const lookup = createLookup(entries, statRules);
  const originalText = new WeakMap();
  const renderedText = new WeakMap();
  const originalAttributes = new WeakMap();
  const renderedAttributes = new WeakMap();
  const composedGroups = new WeakSet();

  let settings = { ...DEFAULT_SETTINGS };
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
          max-height: calc(100dvh - 110px);
          overflow: auto;
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

        .categories .option {
          margin-top: 6px;
          padding: 8px 10px;
          font-size: 11px;
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
            <h2>PoE 核心内容中文化</h2>
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
          <div class="categories" role="group" aria-label="翻译范围">
            ${Object.entries(CATEGORY_LABELS).map(([key, label]) => `
              <label class="option"><span>${label} · ${categorySizes[key] ?? 0}</span>
                <input type="checkbox" data-category="${key}" aria-label="翻译${label}">
              </label>`).join("")}
          </div>
          <div class="status">
            <span class="dot" aria-hidden="true"></span>
            <span>已载入 ${entries.length} 条词条 · ${statRules.length} 条属性规则</span>
          </div>
        </div>
      </section>
    `;

    const launcher = shadow.querySelector(".launcher");
    const panel = shadow.querySelector(".panel");
    const close = shadow.querySelector(".close");
    const languageButtons = [...shadow.querySelectorAll("[data-language]")];
    const bilingual = shadow.querySelector('input[type="checkbox"]');
    const categoryInputs = [...shadow.querySelectorAll("[data-category]")];

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
    for (const input of categoryInputs) {
      input.addEventListener("change", () => {
        chrome.storage.sync.set({ categories: { ...settings.categories, [input.dataset.category]: input.checked } });
      });
    }

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
        for (const input of categoryInputs) input.checked = nextSettings.categories[input.dataset.category];
      }
    };
  }

  function shouldIgnore(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return true;
    for (let parent = element; parent; parent = parent.parentElement) {
      if (IGNORED_TAGS.has(parent.tagName) || parent.isContentEditable || parent.id === "poe-cn-translator-root") return true;
    }
    return false;
  }

  function translateTextNode(node) {
    if (shouldIgnore(node)) return;

    const current = node.nodeValue ?? "";
    const lastRendered = renderedText.get(node);
    if (!originalText.has(node) || (lastRendered !== undefined && current !== lastRendered)) {
      originalText.set(node, current);
    }

    const source = originalText.get(node);
    const output = translateText(source, lookup, settings, getContext(node.parentElement));
    renderedText.set(node, output);

    if (output !== current) node.nodeValue = output;
  }

  function translateElementAttributes(element) {
    if (shouldIgnore(element)) return;

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
      if (!element.hasAttribute(attribute)) {
        originals.delete(attribute);
        rendered.delete(attribute);
        continue;
      }

      const current = element.getAttribute(attribute) ?? "";
      if (!originals.has(attribute) || (
        rendered.has(attribute) && current !== rendered.get(attribute)
      )) {
        originals.set(attribute, current);
      }

      const source = originals.get(attribute);
      const output = translateText(source, lookup, settings, getContext(element));
      rendered.set(attribute, output);
      if (output !== current) element.setAttribute(attribute, output);
    }
  }

  // Tooltip formatters split values into adjacent text nodes or nested spans. Keep the
  // elements/listeners intact, and restore every original text node on rerender.
  function translateComposedElement(element) {
    if (element.childNodes.length < 2 || shouldIgnore(element)) return;
    const descendants = [...element.querySelectorAll("*")];
    if (descendants.length > 24 || descendants.some((child) => !INLINE_TAGS.has(child.tagName) || shouldIgnore(child))) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    if (nodes.length < 2) return;
    const source = nodes.map((node) => originalText.get(node) ?? node.nodeValue).join("");
    const output = translateText(source, lookup, settings, { ...getContext(element), atomicOnly: true });
    if (output === source) return;
    composedGroups.add(element);
    nodes.forEach((node, index) => {
      const value = index === 0 ? output : "";
      renderedText.set(node, value);
      if (node.nodeValue !== value) node.nodeValue = value;
    });
  }

  function translateRoot(root) {
    if (!root || !root.isConnected) return;

    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
      return;
    }

    if (root.nodeType === Node.ELEMENT_NODE) {
      if (shouldIgnore(root)) return;
      translateElementAttributes(root);
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      { acceptNode: (node) => shouldIgnore(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }
    );
    const elements = root.nodeType === Node.ELEMENT_NODE ? [root] : [];
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        translateTextNode(node);
      } else {
        translateElementAttributes(node);
        elements.push(node);
      }
      node = walker.nextNode();
    }
    for (const element of elements.reverse()) translateComposedElement(element);
  }

  function scheduleTranslation(root) {
    let target = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
      if (composedGroups.has(parent)) target = parent;
    }
    pendingRoots.add(target);
    if (scheduled) return;

    scheduled = true;
    let frame, timer;
    const flush = () => {
      if (!scheduled) return;
      scheduled = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      const roots = [...pendingRoots];
      pendingRoots.clear();
      for (const pendingRoot of roots) {
        if (pendingRoot && !roots.some((other) => other && other !== pendingRoot && other.contains(pendingRoot))) translateRoot(pendingRoot);
      }
    };
    frame = requestAnimationFrame(flush);
    // Background tabs and hidden tooltips can suspend animation frames.
    timer = setTimeout(flush, 50);
  }

  function observePage() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          if (renderedText.get(mutation.target) === mutation.target.nodeValue) continue;
          scheduleTranslation(mutation.target);
          continue;
        }
        if (mutation.type === "attributes") {
          const last = renderedAttributes.get(mutation.target);
          if (last?.has(mutation.attributeName) && last.get(mutation.attributeName) === mutation.target.getAttribute(mutation.attributeName)) continue;
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
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES, "id", "aria-labelledby", "data-poe-category", "data-poe-entity-id"]
    });
  }

  function applySettings(nextSettings) {
    settings = normalizeSettings(nextSettings);
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
    if (changes.categories) next.categories = changes.categories.newValue;
    applySettings(next);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_TRANSLATION_STATUS") return;
    let translatedNodes = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (renderedText.get(node) === node.nodeValue && node.nodeValue !== originalText.get(node)) translatedNodes += 1;
    }
    sendResponse({
      active: settings.language !== "en" && Object.values(settings.categories).some(Boolean),
      language: settings.language,
      displayMode: settings.displayMode,
      dictionarySize: entries.length + statRules.length,
      categorySizes,
      categories: settings.categories,
      translatedNodes
    });
  });
})();
