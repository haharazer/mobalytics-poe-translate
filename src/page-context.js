(function initPageContext(global) {
  "use strict";
  const CATEGORIES = new Set(["skill", "skillDescription", "item", "passive", "affix"]);
  function categoryFromLabel(label) {
    const value = label?.trim().toLowerCase().replace(/[_\s]+/g, "-");
    if (/^(gear|equipment|items)(-section|-panel)?$/.test(value)) return "item";
    if (/^(passives?|passive-tree|skill-tree|atlas-tree|ascendancy)(-section|-panel)?$/.test(value)) return "passive";
    if (/^(skills?|gems?|skill-gems)(-section|-panel)?$/.test(value)) return "skill";
    return undefined;
  }
  function getContext(element) {
    let category, entityId;
    for (let current = element; current; current = current.parentElement) {
      entityId ??= current.getAttribute("data-poe-entity-id") || undefined;
      if (!category) {
        const explicit = current.getAttribute("data-poe-category");
        if (CATEGORIES.has(explicit)) category = explicit;
        category ??= categoryFromLabel(current.id) ?? categoryFromLabel(current.getAttribute("aria-label"));
        // Real Mobalytics widgets use UUID section IDs and semantic h2 headers.
        if (!category && current.tagName === "SECTION") {
          category = categoryFromLabel(current.querySelector("header h2")?.textContent);
        }
        if (!category && current.hasAttribute("aria-labelledby")) {
          for (const id of current.getAttribute("aria-labelledby").split(/\s+/)) {
            category ??= categoryFromLabel(current.ownerDocument.getElementById(id)?.textContent);
          }
        }
      }
      if (category && entityId) break;
    }
    return { category, entityId };
  }
  const api = Object.freeze({ getContext, categoryFromLabel });
  global.PoePageContext = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
