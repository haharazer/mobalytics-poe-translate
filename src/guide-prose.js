(function (global) {
  "use strict";
  // Both the site's static rich-text renderer and its hydrated Lexical viewer use this class.
  const RICH = ".lexical-rich-text-content";
  const BLOCK = "p, li, h3, h4, blockquote, td, th";
  // Keep a normal paragraph together. Large pastes and highly formatted lists may
  // require several requests; indices map each returned piece back to its DOM node.
  function* batches(parts) {
    const limit = 12000;
    let batch = [], length = 0;
    for (const [index, part] of parts.entries()) {
      let rest = part;
      do {
        let piece = rest;
        if (rest?.length > limit) {
          const prefix = rest.slice(0, limit);
          let cut = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\n"));
          if (cut <= 0) cut = limit;
          // Never split a dictionary marker or a surrogate pair at a hard wrap.
          const marker = /⟦\d*$/.exec(rest.slice(Math.max(0, cut - 12), cut));
          if (marker && /^\d*⟧/.test(rest.slice(cut))) cut -= marker[0].length;
          if (cut > 1 && /[\uD800-\uDBFF]/.test(rest.charAt(cut - 1))) cut--;
          piece = rest.slice(0, cut);
          rest = rest.slice(cut).trimStart();
        } else { rest = ""; }
        const size = piece?.length || 0;
        if (batch.length >= 120 || length + size > limit) {
          yield batch;
          batch = [];
          length = 0;
        }
        batch.push({ index, piece });
        length += size;
      } while (rest);
    }
    if (batch.length) yield batch;
  }
  const EXCLUDE = "script, style, noscript, pre, code, nav, button, input, textarea, select, svg, [hidden], [aria-hidden=true], [role=tooltip], [role=dialog], [data-lexical-static-widget-node], [data-lexical-decorator], [data-poe-entity-id], #poe-cn-translator-root";
  const SECTION = "section, [data-widgetid], [role=region]";
  function inComments(block) {
    if (block.closest('#comments, [aria-label="Comments" i]')) return true;
    for (let section = block.closest(SECTION); section; section = section.parentElement?.closest(SECTION)) {
      // The widget ID can be a UUID. Its anchor and section title identify it
      // even when sorting or expanding replies replaces the entire rich text.
      if (section.querySelector(":scope > span#comments")) return true;
      const heading = section.querySelector("h2");
      if (heading?.closest(SECTION) === section && !heading.closest(RICH) &&
          /^comments(?:\s*(?:\([\d,]+\)|[\d,]+))?$/i.test(heading.textContent.trim())) return true;
    }
    return false;
  }
  function create({ sourceOf, writeText, localize, knownName, settings, rescan, onStatus }) {
    let revision = null, generation = 0, stateRequest = 0, busy = false, error = "";
    let automatic = false, manualGuide = null, matchedProse = false;
    let records = new WeakMap();
    const queue = new Set();
    const recentResults = new Map();
    // Variant selection can change the query/hash while the build slug stays the same.
    const guidePath = () => location.pathname.replace(/\/$/, "");
    function expireManualGuide() {
      if (manualGuide !== null && manualGuide !== guidePath()) {
        reset();
        rescan();
        onStatus();
      }
    }
    global.navigation?.addEventListener("currententrychange", expireManualGuide);

    function protectedText(text, element) {
      return knownName(text.trim()) || localize(text, element, true) !== text;
    }
    // Only exact, case-sensitive dictionary names are locked inside free text.
    function maskTerms(text, element) {
      const words = [...text.matchAll(/[A-Za-z0-9]+(?:['’:-][A-Za-z0-9]+)*/g)];
      let masked = "", end = 0;
      const terms = [];
      for (let i = 0; i < words.length; i++) {
        if (!/^[A-Z]/.test(words[i][0])) continue;
        for (let j = Math.min(i + 9, words.length - 1); j >= i; j--) {
          const stop = words[j].index + words[j][0].length;
          const name = text.slice(words[i].index, stop);
          if (!knownName(name) || localize(name, element, true) === name) continue;
          masked += text.slice(end, words[i].index) + "⟦" + terms.length + "⟧";
          terms.push(name);
          end = stop;
          i = j;
          break;
        }
      }
      return { masked: masked + text.slice(end), terms };
    }
    function makePlan(block) {
      if (!block.isConnected || !block.closest(RICH) || block.isContentEditable || block.closest(EXCLUDE) || inComments(block)) return;
      if (!block.getClientRects().length || getComputedStyle(block).visibility !== "visible") return;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const rows = [], parts = [], locked = new WeakMap();
      function covered(element) {
        if (!locked.has(element)) {
          const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          let source = "";
          for (let n = nodes.nextNode(); n; n = nodes.nextNode()) source += sourceOf(n);
          locked.set(element, protectedText(source, element));
        }
        return locked.get(element);
      }
      if (covered(block)) return;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement;
        const source = sourceOf(node);
        if (!source.trim() || element.closest(BLOCK) !== block) continue;
        let fixed = element.isContentEditable || !!element.closest(EXCLUDE);
        for (let e = element; !fixed && e !== block; e = e.parentElement) fixed = covered(e);
        if (fixed || protectedText(source, element) || /^(?:https?:\/\/|www\.)\S+$/i.test(source.trim()) ||
            !/[a-z]/i.test(source) || /⟦\d+⟧/.test(source)) {
          parts.push(null);
          continue;
        }
        const { masked, terms } = maskTerms(source.trim(), element);
        if (!/[a-z]/i.test(masked)) { parts.push(null); continue; }
        rows.push({ node, source, terms, index: parts.length });
        parts.push(masked);
      }
      if (!rows.length) return;
      return { parts, rows, signature: JSON.stringify([revision, settings().language, parts]) };
    }
    function render(plan, result) {
      for (const { node, source, terms, index } of plan.rows) {
        const translated = result[index].trim().replace(/⟦(\d+)⟧/g, (_, n) =>
          localize(terms[n], node.parentElement, false, true));
        const display = settings().displayMode === "bilingual" ? translated + " (" + source.trim() + ")" : translated;
        writeText(node, source.match(/^\s*/)[0] + display + source.match(/\s*$/)[0]);
      }
    }
    async function pump() {
      if (busy || !queue.size) return;
      busy = true;
      onStatus();
      try {
        while (queue.size && !error) {
          expireManualGuide();
          if (!queue.size) break;
          const block = queue.values().next().value;
          queue.delete(block);
          const record = records.get(block);
          if (!record) continue;
          if (!block.isConnected) { records.delete(block); continue; }
          const ticket = generation;
          try {
            const result = record.parts.map(p => p === null ? null : "");
            let stale = false;
            for (const batch of batches(record.parts)) {
              expireManualGuide();
              // A queued or partially translated node can move into another widget.
              if (ticket !== generation || records.get(block) !== record || makePlan(block)?.signature !== record.signature) { stale = true; break; }
              const parts = batch.map(row => row.piece);
              if (parts.every(p => p === null)) continue;
              const reply = await chrome.runtime.sendMessage({
                type: "TRANSLATE_PROSE", parts, revision, language: settings().language, manual: record.manual
              });
              if (reply?.stale) { stale = true; break; }
              if (!reply?.result) throw new Error(reply?.error || "扩展连接已中断，请刷新攻略页。");
              batch.forEach(({ index, piece }, i) => {
                if (piece !== null) result[index] += reply.result[i].trim();
              });
            }
            expireManualGuide();
            if (ticket !== generation || records.get(block) !== record) continue;
            if (stale) { records.delete(block); continue; }
            // A tab may remount an identical paragraph as a different DOM node.
            // The worker's persistent cache remains the fallback for older entries.
            if (recentResults.size >= 256) recentResults.delete(recentResults.keys().next().value);
            recentResults.set(record.signature, result);
            const current = makePlan(block);
            if (current?.signature !== record.signature) { records.delete(block); continue; }
            record.result = result;
            render(current, record.result);
          } catch (e) {
            if (ticket === generation && records.get(block) === record) {
              if (block.isConnected) error = e.message;
              else records.delete(block);
            }
          }
        }
      } finally { busy = false; onStatus(); }
    }
    function scan(root) {
      expireManualGuide();
      if (!revision || settings().language === "en" || !(automatic || manualGuide !== null)) return;
      const blocks = [...root.querySelectorAll(BLOCK)];
      const parent = root.closest?.(BLOCK);
      if (parent) blocks.unshift(parent);
      for (const block of blocks) {
        const plan = makePlan(block);
        const previous = records.get(block);
        if (!plan) { records.delete(block); queue.delete(block); continue; }
        matchedProse = true;
        if (previous?.signature === plan.signature) {
          if (previous.result) render(plan, previous.result);
          continue;
        }
        const record = { parts: plan.parts, signature: plan.signature, manual: !automatic };
        records.set(block, record);
        const cached = recentResults.get(plan.signature);
        if (cached) {
          record.result = cached;
          queue.delete(block);
          render(plan, cached);
          continue;
        }
        queue.add(block);
      }
      void pump();
    }
    function reset() {
      generation++;
      queue.clear();
      records = new WeakMap();
      error = "";
      manualGuide = null;
      matchedProse = false;
      recentResults.clear();
    }
    async function refresh() {
      const ticket = ++stateRequest;
      const state = await chrome.runtime.sendMessage({ type: "PROSE_STATE" }).catch(() => null);
      if (ticket !== stateRequest) return;
      const next = state?.revision || null;
      if (revision === next && automatic === !!state?.automatic) return;
      reset();
      revision = next;
      automatic = !!state?.automatic;
      rescan();
      onStatus();
    }
    function start() {
      if (!canStart()) return;
      if (error) reset();
      if (!automatic) manualGuide = guidePath();
      scan(document.body);
      onStatus();
    }
    function canStart() { return !!revision && settings().language !== "en" && !busy; }
    function status() {
      if (!revision) return "请先配置 API 端点和模型";
      if (settings().language === "en") return "选择简体或繁体后可翻译正文";
      if (error) return error;
      if (busy || queue.size) return "正在翻译正文…";
      if (manualGuide !== null) return matchedProse ? "本页正文已翻译 · 切换变体时继续翻译" : "等待本页正文";
      return automatic ? "自动翻译已启用" : "手动翻译 · 优先使用缓存";
    }
    return { scan, refresh, reset, start, canStart, status, enabled: () => !!revision && (automatic || manualGuide !== null), failed: () => !!error, busy: () => busy && !error };
  }
  global.PoeGuideProse = { create, batches };
})(globalThis);
