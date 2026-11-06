(function initTranslationCore(global) {
  "use strict";

  const CATEGORY_LABELS = Object.freeze({
    skill: "技能名称", skillDescription: "技能描述", item: "装备与物品基底",
    passive: "天赋名称", affix: "词缀前后缀名称", stat: "数值词缀与天赋效果"
  });
  const DEFAULT_CATEGORIES = Object.freeze(Object.fromEntries(
    Object.keys(CATEGORY_LABELS).map((key) => [key, true])
  ));
  const normalizeText = (text) => text.replace(/\s+/g, " ").trim();

  function normalizeSettings(settings = {}) {
    return {
      language: ["zh-CN", "zh-TW", "en"].includes(settings.language) ? settings.language : "zh-CN",
      displayMode: settings.displayMode === "bilingual" ? "bilingual" : "translated",
      categories: Object.fromEntries(Object.keys(DEFAULT_CATEGORIES).map((key) => [
        key, settings.categories?.[key] !== false
      ]))
    };
  }

  function createLookup(entries, statRules = []) {
    const lookup = new Map();
    function add(key, entry) {
      key = normalizeText(key);
      if (!key) return;
      if (!lookup.has(key)) lookup.set(key, []);
      lookup.get(key).push(entry);
    }
    for (const entry of entries) add(entry.en, { ...entry, category: entry.category ?? "skill" });
    const aliases = new Map();
    for (const entry of entries) {
      if ((entry.category ?? "skill") !== "skill" || !entry.en.endsWith(" Support")) continue;
      const alias = normalizeText(entry.en.slice(0, -8));
      if (lookup.get(alias)?.some((candidate) => candidate.category === "skill")) continue;
      if (!aliases.has(alias)) aliases.set(alias, []);
      aliases.get(alias).push({ ...entry, category: "skill", alias });
    }
    for (const [alias, candidates] of aliases) for (const entry of candidates) add(alias, entry);
    lookup.statLookup = global.PoeStatTranslation?.createStatLookup(statRules);
    return lookup;
  }

  function translateValue(value, lookup, settings, context) {
    let candidates = lookup.get(normalizeText(value));
    if (!candidates) return value;
    if (context.entityId) candidates = candidates.filter((entry) => entry.entityIds?.includes(context.entityId));
    if (context.category) {
      const allowed = {
        skill: ["skill", "skillDescription", "item"], item: ["item", "affix", "skill", "skillDescription"],
        passive: ["passive", "item"], affix: ["affix"], skillDescription: ["skillDescription"]
      }[context.category] ?? [];
      candidates = candidates.filter((entry) => allowed.includes(entry.category));
    } else if (!context.entityId) {
      // Prefix/suffix names often overlap ordinary prose and UI labels.
      candidates = candidates.filter((entry) => entry.category !== "affix");
    }
    if (!candidates.length) return value;
    const field = settings.language === "zh-TW" ? "zhTW" : "zhCN";
    const translations = new Set(candidates.map((entry) => entry[field]).filter(Boolean));
    // A category toggle must not silently resolve a semantic collision.
    if (translations.size !== 1 || candidates.some((entry) => settings.categories?.[entry.category] === false)) return value;
    const translated = [...translations][0];
    return settings.displayMode === "bilingual" ? `${translated} (${value})` : translated;
  }

  function translateText(text, lookup, settings, context = {}) {
    if (settings.language === "en") return text;
    const [, leading, value, trailing] = /^(\s*)(.*?)(\s*)$/s.exec(text);
    const output = translateValue(value, lookup, settings, context);
    if (output !== value) return `${leading}${output}${trailing}`;
    if (settings.categories?.stat !== false) {
      const stat = global.PoeStatTranslation?.translateStat(value, lookup.statLookup, settings.language);
      if (stat) return `${leading}${settings.displayMode === "bilingual" ? `${stat} (${value})` : stat}${trailing}`;
    }
    if (!context.atomicOnly && /[\r\n]/.test(value)) {
      return text.split(/(\r\n|\r|\n)/).map((line, index) =>
        index % 2 ? line : translateText(line, lookup, settings, context)
      ).join("");
    }
    return text;
  }

  const api = Object.freeze({ createLookup, translateText, normalizeText, normalizeSettings, CATEGORY_LABELS, DEFAULT_CATEGORIES });
  global.PoeTranslationCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
