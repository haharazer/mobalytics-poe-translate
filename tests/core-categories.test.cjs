const test = require("node:test");
const assert = require("node:assert/strict");
const { createLookup, translateText, normalizeSettings } = require("../src/translation-core.js");
const { categoryFromLabel } = require("../src/page-context.js");
const settings = normalizeSettings();
const entry = (category, en, zhCN, id, zhTW = zhCN) => ({ category, en, zhCN, zhTW, entityIds: [id] });

test("same English text requires category or entity identity when translations conflict", () => {
  const lookup = createLookup([
    entry("skill", "Shared Name", "技能", "poe1:skill:a"),
    entry("passive", "Shared Name", "天赋", "poe1:passive:a")
  ]);
  assert.equal(translateText("Shared Name", lookup, settings), "Shared Name");
  assert.equal(translateText("Shared Name", lookup, settings, { category: "skill" }), "技能");
  assert.equal(translateText("Shared Name", lookup, settings, { entityId: "poe1:passive:a" }), "天赋");
  assert.equal(translateText("Shared Name", lookup, settings, { entityId: "poe1:passive:missing" }), "Shared Name");
  assert.equal(translateText("Shared Name", lookup, { ...settings, categories: { passive: false } }), "Shared Name");
});

test("collisions are locale-specific, deterministic and retain missing locales", () => {
  const rows = [entry("item", "Base", "基底甲", "a", "基底"), entry("item", "Base", "基底乙", "b", "基底")];
  for (const input of [rows, [...rows].reverse()]) {
    const lookup = createLookup(input);
    assert.equal(translateText("Base", lookup, settings), "Base");
    assert.equal(translateText("Base", lookup, { ...settings, language: "zh-TW" }), "基底");
  }
  const lookup = createLookup([entry("item", "New Item", null, "new", "新物品")]);
  assert.equal(translateText("New Item", lookup, settings), "New Item");
});

test("affix names need equipment scope and respect their own toggle", () => {
  const lookup = createLookup([entry("affix", "Healthy", "健壮的", "poe1:mod:a")]);
  assert.equal(translateText("Healthy", lookup, settings), "Healthy");
  assert.equal(translateText("Healthy", lookup, settings, { category: "item" }), "健壮的");
  assert.equal(translateText("Healthy", lookup, settings, { entityId: "poe1:mod:a" }), "健壮的");
  assert.equal(translateText("Healthy", lookup, { ...settings, categories: { affix: false } }, { category: "item" }), "Healthy");
});

test("description matching tolerates layout whitespace without replacing sentence fragments", () => {
  const lookup = createLookup([entry("skillDescription", "Deals damage. Pushes enemies away.", "造成伤害。击退敌人。", "skill")]);
  assert.equal(translateText("  Deals damage.\n Pushes enemies away.  ", lookup, settings), "  造成伤害。击退敌人。  ");
  assert.equal(translateText("Tip: Deals damage. Pushes enemies away.", lookup, settings), "Tip: Deals damage. Pushes enemies away.");
  assert.equal(translateText("Deals damage.", lookup, settings), "Deals damage.");
});

test("independent tooltip lines preserve line endings and unknown stats", () => {
  const lookup = createLookup([entry("item", "Vaal Regalia", "瓦尔法衣", "item")]);
  assert.equal(translateText(" Vaal Regalia\r\n+100 to maximum Life\n", lookup, settings), " 瓦尔法衣\r\n+100 to maximum Life\n");
});

test("only skill names receive Support aliases; exact names take precedence", () => {
  const lookup = createLookup([
    entry("item", "Item Support", "物品", "item"),
    entry("skill", "Known Support", "辅助技能", "gem"),
    entry("skill", "Known", "主动技能", "active")
  ]);
  assert.equal(translateText("Item", lookup, settings), "Item");
  assert.equal(translateText("Known", lookup, settings), "主动技能");
});

test("legacy storage settings enable all categories; invalid values use defaults", () => {
  assert.deepEqual(normalizeSettings({ language: "zh-TW", displayMode: "bilingual" }), { ...settings, language: "zh-TW", displayMode: "bilingual" });
  assert.deepEqual(normalizeSettings({ language: "bad", categories: { item: false, unknown: false } }).categories,
    { skill: true, skillDescription: true, item: false, passive: true, affix: true, stat: true });
  assert.equal(categoryFromLabel("Passive Tree"), "passive");
  assert.equal(categoryFromLabel("equipment-panel"), "item");
  assert.equal(categoryFromLabel("random-gear-css"), undefined);
});

test("generated client dictionary translates representative names and a real skill description", () => {
  require("../data/poe1-skill-gems.js");
  require("../data/poe1-core.js");
  const lookup = createLookup([...globalThis.POE1_SKILL_GEMS, ...globalThis.POE1_CORE.entries]);
  assert.equal(translateText("Vaal Regalia", lookup, settings), "瓦尔法衣");
  assert.equal(translateText("Chaos Inoculation", lookup, settings), "异灵之体");
  assert.equal(translateText("Momentum", lookup, settings), "动量（辅）");
  assert.equal(translateText("of the Deadeye", lookup, settings, { category: "item" }), "of the Deadeye");
  const description = globalThis.POE1_CORE.entries.find((row) => row.category === "skillDescription" && row.entityIds.includes("poe1:skill:shield_charge"));
  assert.ok(description);
  assert.match(translateText(description.en, lookup, settings), /^向一个目标位置或敌人冲锋/);
  assert.equal(translateText(description.en, lookup, { ...settings, language: "en" }), description.en);
});
