(function initTranslationCore(global) {
  "use strict";

  const SUPPORT_SUFFIX = " Support";

  function createLookup(entries) {
    const lookup = new Map();
    const ambiguousAliases = new Set();

    for (const entry of entries) {
      lookup.set(entry.en, entry);
    }

    for (const entry of entries) {
      if (!entry.en.endsWith(SUPPORT_SUFFIX)) continue;

      const alias = entry.en.slice(0, -SUPPORT_SUFFIX.length);
      if (!alias || lookup.has(alias) || ambiguousAliases.has(alias)) continue;

      const existing = lookup.get(alias);
      if (existing && existing.en !== entry.en) {
        lookup.delete(alias);
        ambiguousAliases.add(alias);
      } else {
        lookup.set(alias, { ...entry, alias });
      }
    }

    return lookup;
  }

  function translateText(text, lookup, settings) {
    const match = /^(\s*)(.*?)(\s*)$/s.exec(text);
    if (!match) return text;

    const [, leading, value, trailing] = match;
    const entry = lookup.get(value);
    if (!entry || settings.language === "en") return text;

    const translated =
      settings.language === "zh-TW" ? entry.zhTW : entry.zhCN;
    if (!translated) return text;

    const rendered =
      settings.displayMode === "bilingual"
        ? `${translated} (${value})`
        : translated;

    return `${leading}${rendered}${trailing}`;
  }

  const api = Object.freeze({ createLookup, translateText });
  global.PoeTranslationCore = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
