const test = require("node:test");
const assert = require("node:assert/strict");
const { createLookup, translateText } = require("../src/translation-core.js");

const entries = [
  { en: "Shield Charge", zhCN: "重盾冲锋", zhTW: "重盾衝鋒" },
  { en: "Momentum Support", zhCN: "动量辅助", zhTW: "動量輔助" },
  { en: "Efficacy Support", zhCN: "效能辅助", zhTW: "效能輔助" }
];
const lookup = createLookup(entries);

test("translates an exact English gem name", () => {
  assert.equal(
    translateText("Shield Charge", lookup, {
      language: "zh-CN",
      displayMode: "translated"
    }),
    "重盾冲锋"
  );
});

test("preserves surrounding whitespace", () => {
  assert.equal(
    translateText("  Shield Charge\n", lookup, {
      language: "zh-TW",
      displayMode: "translated"
    }),
    "  重盾衝鋒\n"
  );
});

test("supports Mobalytics names with the Support suffix omitted", () => {
  assert.equal(
    translateText("Momentum", lookup, {
      language: "zh-CN",
      displayMode: "translated"
    }),
    "动量辅助"
  );
});

test("renders bilingual labels", () => {
  assert.equal(
    translateText("Efficacy", lookup, {
      language: "zh-CN",
      displayMode: "bilingual"
    }),
    "效能辅助 (Efficacy)"
  );
});

test("restores English and ignores non-gem prose", () => {
  assert.equal(
    translateText("Shield Charge", lookup, {
      language: "en",
      displayMode: "translated"
    }),
    "Shield Charge"
  );
  assert.equal(
    translateText("Cast Shield Charge", lookup, {
      language: "zh-CN",
      displayMode: "translated"
    }),
    "Cast Shield Charge"
  );
});
