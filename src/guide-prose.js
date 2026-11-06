(function (global) {
  "use strict";
  // Both the site's static rich-text renderer and its hydrated Lexical viewer use this class.
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
      if (heading?.closest(SECTION) === section && !heading.closest(".lexical-rich-text-content, [data-lexical-editor]") &&
          /^comments(?:\s*(?:\([\d,]+\)|[\d,]+))?$/i.test(heading.textContent.trim())) return true;
    }
    return false;
  }
  function create({ site, sourceOf, writeText, localize, knownName, settings, rescan, onStatus }) {
    const { rich: RICH, blocks: BLOCK } = site;
    const excluded = site.protected ? EXCLUDE + ", " + site.protected : EXCLUDE;
    let revision = null, generation = 0, stateRequest = 0, busy = false, error = "";
    let automatic = false, manualGuide = null, matchedProse = false;
    let records = new WeakMap();
    const queue = new Set();
    const failedBlocks = new Set();
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
      if (!block.isConnected || !block.closest(RICH) || block.isContentEditable || block.closest(excluded) ||
          inComments(block) || (site.accepts && !site.accepts(block))) return;
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
        let fixed = element.isContentEditable || !!element.closest(excluded);
        for (let e = element; !fixed && e !== block; e = e.parentElement) fixed = covered(e);
        if (fixed || protectedText(source, element) || /^(?:https?:\/\/|www\.)\S+$/i.test(source.trim()) ||
            !/[a-z]/i.test(source) || /⟦\d+⟧/.test(source) || /^"[^"]*[|$\\][^"]*"$/.test(source.trim())) {
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
    function takeBatch() {
      const jobs = [];
      let chars = 0, fragments = 0;
      for (const block of queue) {
        const record = records.get(block);
        if (!record || makePlan(block)?.signature !== record.signature) {
          queue.delete(block);
          records.delete(block);
          continue;
        }
        if (!record.chunks) {
          record.chunks = [...batches(record.parts)].filter(chunk => chunk.some(row => row.piece !== null));
          record.next = 0;
          record.partial = record.parts.map(part => part === null ? null : "");
        }
        const chunk = record.chunks[record.next];
        const parts = chunk.map(row => row.piece);
        const size = parts.join("").length;
        if (!PoeLLM.fitsBatch(jobs.length + 1, chars + size, fragments + parts.length)) break;
        queue.delete(block);
        jobs.push({ block, record, chunk, parts });
        chars += size;
        fragments += parts.length;
      }
      return jobs;
    }
    function applyReply(job, reply) {
      const { block, record, chunk } = job;
      if (records.get(block) !== record) return;
      const current = makePlan(block);
      if (current?.signature !== record.signature || reply?.stale) {
        records.delete(block);
        return;
      }
      if (!reply?.result) {
        if (reply?.kind === "paragraph-format") {
          failedBlocks.add(block);
          return;
        }
        error ||= reply?.error || "扩展连接已中断，请刷新攻略页。";
        return;
      }
      chunk.forEach(({ index, piece }, i) => {
        if (piece !== null) record.partial[index] += reply.result[i].trim();
      });
      if (++record.next < record.chunks.length) {
        queue.add(block);
        return;
      }
      record.result = record.partial;
      delete record.partial;
      delete record.chunks;
      if (recentResults.size >= 256) recentResults.delete(recentResults.keys().next().value);
      recentResults.set(record.signature, record.result);
      render(current, record.result);
    }
    async function pump() {
      if (busy || !queue.size) return;
      busy = true;
      onStatus();
      try {
        while (queue.size && !error) {
          expireManualGuide();
          const jobs = takeBatch();
          if (!jobs.length) break;
          const ticket = generation;
          let reply;
          try {
            reply = await chrome.runtime.sendMessage({
              type: "TRANSLATE_PROSE_BATCH", paragraphs: jobs.map(job => job.parts),
              revision, language: settings().language, manual: !automatic
            });
          } catch (e) { reply = { error: e.message }; }
          expireManualGuide();
          if (ticket === generation) jobs.forEach((job, i) => applyReply(job, reply?.rows?.[i] || reply));
        }
      } finally { busy = false; onStatus(); }
    }
    function scan(root) {
      expireManualGuide();
      if (!revision || settings().language === "en" || !(automatic || manualGuide !== null)) return;
      for (const block of failedBlocks) {
        if (!block.isConnected) {
          failedBlocks.delete(block);
          records.delete(block);
        }
      }
      const blocks = [...root.querySelectorAll(BLOCK)];
      const parent = root.closest?.(BLOCK);
      if (parent) blocks.unshift(parent);
      for (const block of blocks) {
        const plan = makePlan(block);
        const previous = records.get(block);
        if (!plan) { records.delete(block); queue.delete(block); failedBlocks.delete(block); continue; }
        matchedProse = true;
        if (previous?.signature === plan.signature) {
          if (previous.result) render(plan, previous.result);
          continue;
        }
        const record = { parts: plan.parts, signature: plan.signature };
        failedBlocks.delete(block);
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
      queueMicrotask(pump);
    }
    function reset() {
      generation++;
      queue.clear();
      failedBlocks.clear();
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
      for (const block of failedBlocks) records.delete(block);
      failedBlocks.clear();
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
      if (failedBlocks.size) return `有 ${failedBlocks.size} 段译文格式有误，点击重试可单独补译。`;
      if (manualGuide !== null) return matchedProse ? "本页正文已翻译 · 切换变体时继续翻译" : "等待本页正文";
      return automatic ? "自动翻译已启用" : "手动翻译 · 优先使用缓存";
    }
    return { scan, refresh, reset, start, canStart, status, enabled: () => !!revision && (automatic || manualGuide !== null), failed: () => !!error || failedBlocks.size > 0, busy: () => busy && !error };
  }
  global.PoeGuideProse = { create, batches };
})(globalThis);
