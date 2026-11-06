(function (global) {
  "use strict";
  const basicBlocks = "p, li, h3, h4, blockquote, td, th";
  const mobalytics = {
    name: "Mobalytics",
    rich: ".lexical-rich-text-content",
    blocks: basicBlocks
  };
  const plannerNarrative = [
    '[data-lexical-editor="true"][contenteditable="false"]', ".poe-Markdown",
    ".poe-strengths", ".poe-weaknesses", ".poe-card-title", ".poe-title-details h2"
  ].join(", ");
  const entityHosts = ".poe-item, .poe-passive, .poe-atlas, .poe-skill, .poe-tattoo, .poe-base-item, .poe-unique-item, .poe-passive-skill, .poe-active-skill";
  const maxroll = {
    name: "Maxroll",
    // The planner mounts into the article; detailed views and item popups can mount under body.
    dictionary: "#main-article, .poeplanner-wrapper, .poe-itemPopup, .poe-gemPopup, .poe-passivePopup",
    rich: "#main-article, .poe-leveling-tool-modal",
    blocks: basicBlocks + ", h1, h2, h5, h6, .poe-progression-card .poe-card-title",
    protected: entityHosts + ", .poe-gametip, [data-poe-id]:not(.poe-embed), .poe-itemPopup, .poe-gemPopup, .poe-passivePopup, .poe-card-hidden, [data-post-card], [contenteditable=true]",
    pendingEntity(element) {
      // The planner captures the host's HTML as its source when it enters the viewport
      // and restores that snapshot on unmount. Translate the rendered tip, never its seed.
      const host = element.closest(entityHosts);
      return host && !host.querySelector(".poe-gametip, .poe-itemPopup, .poe-gemPopup, .poe-passivePopup, .poe-ItemDisplay");
    },
    accepts(block) {
      if (block.closest(".poe-embed, .poeplanner-wrapper, .poe-leveling-tool-modal")) {
        return !!block.closest(plannerNarrative);
      }
      // The CMS places credits and the changelog inside the same article as the guide.
      const top = block.closest("#main-article > *");
      if (!top || top.querySelector("#changelog-header")) return false;
      for (let part = top; part; part = part.previousElementSibling) {
        if (part.matches("h2, h3")) return !["credits-header", "changelog-header"].includes(part.id);
      }
      return true;
    }
  };
  function forURL(url) {
    if (/^https:\/\/(?:www\.)?maxroll\.gg\/poe\/build-guides\/[^/?#]+/.test(url)) return maxroll;
    if (/^https:\/\/(?:www\.)?mobalytics\.gg\/poe\/builds\/[^/?#]+/.test(url)) return mobalytics;
    return null;
  }
  global.PoeGuideSites = { forURL, mobalytics, maxroll };
})(globalThis);
