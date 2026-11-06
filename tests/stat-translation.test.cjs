const test = require("node:test");
const assert = require("node:assert/strict");
const { tokenizeTemplate, createStatLookup, translateStat } = require("../src/stat-translation.js");
const { createLookup, translateText, normalizeSettings } = require("../src/translation-core.js");
const fixture = (en, zhCN, conditions = ["#"], enFactors = [1], cnFactors = [1]) => ({
  conditions,
  en: { tokens: tokenizeTemplate(en, conditions.length), factors: enFactors },
  zhCN: { tokens: tokenizeTemplate(zhCN, conditions.length), factors: cnFactors },
  zhTW: null
});

test("stat matcher retains signed values and roll ranges and does not replace prose fragments", () => {
  const lookup = createStatLookup([fixture("{0:+d} to maximum Life", "{0:+d} 最大生命")]);
  assert.equal(translateStat("+100 to maximum Life", lookup, "zh-CN"), "+100 最大生命");
  assert.equal(translateStat("+(80-100) to maximum Life", lookup, "zh-CN"), "+(80-100) 最大生命");
  assert.equal(translateStat("-10 to maximum Life", lookup, "zh-CN"), "-10 最大生命");
  assert.equal(translateStat("We need +100 to maximum Life", lookup, "zh-CN"), null);
});

test("reverse display transforms recover raw stat values before checking conditions and target formatting", () => {
  const lookup = createStatLookup([
    fixture("{0}% reduced Damage", "伤害降低 {0}%", ["#|-1"], [-1], [-1]),
    fixture("{0}% of Damage Leeched", "伤害偷取值 {0}", ["1|#"], [0.01], [1])
  ]);
  assert.equal(translateStat("20% reduced Damage", lookup, "zh-CN"), "伤害降低 20%");
  assert.equal(translateStat("-20% reduced Damage", lookup, "zh-CN"), null);
  assert.equal(translateStat("1.5% of Damage Leeched", lookup, "zh-CN"), "伤害偷取值 150");
  assert.equal(translateStat("1.555% of Damage Leeched", lookup, "zh-CN"), null);
});

test("quality roll ranges may touch zero without accepting the opposite sign branch", () => {
  const lookup = createStatLookup([fixture("{0}% increased Cold Damage", "冰霜伤害提高 {0}%", ["1|#"])]);
  assert.equal(translateStat("(0-10)% increased Cold Damage", lookup, "zh-CN"), "冰霜伤害提高 (0-10)%");
  assert.equal(translateStat("0% increased Cold Damage", lookup, "zh-CN"), null);
  assert.equal(translateStat("(-5-10)% increased Cold Damage", lookup, "zh-CN"), null);
});

test("tuple placeholders can change order; repeated placeholders must agree", () => {
  const lookup = createStatLookup([
    fixture("Adds {0} to {1} Damage", "附加 {1} 至 {0} 伤害", ["#", "#"], [1, 1], [1, 1]),
    fixture("{0} per {0} seconds", "每 {0} 秒", ["#"])
  ]);
  assert.equal(translateStat("Adds 5 to 10 Damage", lookup, "zh-CN"), "附加 10 至 5 伤害");
  assert.equal(translateStat("5 per 10 seconds", lookup, "zh-CN"), null);
});

test("conflicting stat translations and missing languages preserve English", () => {
  const lookup = createStatLookup([fixture("{0}% increased Damage", "甲 {0}"), fixture("{0}% increased Damage", "乙 {0}")]);
  assert.equal(translateStat("20% increased Damage", lookup, "zh-CN"), null);
  assert.equal(translateStat("20% increased Damage", lookup, "zh-TW"), null);
});

test("AST compiler rejects unsupported transforms and changed CN English semantics", async () => {
  const { parseStatDescriptions, compileStatFile, compileLine } = await import("../scripts/lib/stat-descriptions.mjs");
  assert.throws(() => compileLine({ template: "{0}", directives: "unknown_transform 1" }, 1), /unsupported transform/);
  const source = 'description\n1 damage\n1\n1|# "{0}% increased Damage"\nlang "Traditional Chinese"\n1\n1|# "增加 {0}% 傷害"\n';
  const cn = 'description\n1 damage\n1\n1|# "{0}% more Damage"\nlang "Simplified Chinese"\n1\n1|# "伤害总增 {0}%"\n';
  const { rules } = compileStatFile(parseStatDescriptions(source), parseStatDescriptions(cn), "fixture.txt");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].zhCN, null);
  assert.ok(rules[0].zhTW);
});

test("named description blocks keep identifiers and nonzero conditions", async () => {
  const { parseStatDescriptions, compileStatFile } = await import("../scripts/lib/stat-descriptions.mjs");
  const source = 'has_identifiers\ndescription one\n1 value\n1\n!0 "{0}% Damage"\nlang "Simplified Chinese"\n1\n!0 "伤害 {0}%"\ndescription two\n1 value\n1\n# "Other {0}"\n';
  const parsed = parseStatDescriptions(source);
  assert.deepEqual(parsed.map((row) => row.identifier), ["one", "two"]);
  const { rules } = compileStatFile(parsed, parsed, "named.txt");
  const lookup = createStatLookup(rules);
  assert.equal(translateStat("20% Damage", lookup, "zh-CN"), "伤害 20%");
  assert.equal(translateStat("0% Damage", lookup, "zh-CN"), null);
});

test("actual client rules cover the supplied Winter Orb build's keystones and masteries", () => {
  require("../data/poe1-extended.js");
  const lookup = createLookup(globalThis.POE1_EXTENDED.entries, globalThis.POE1_EXTENDED.statRules);
  const settings = normalizeSettings();
  const examples = [
    ["+35% to Fire Resistance", "+35% 火焰抗性"],
    ["12% increased Mana Reservation Efficiency of Skills", "技能的魔力保留效能提高 12%"],
    ["5% of Leech is Instant", "5% 的偷取立即生效"],
    ["Penetrates (20-34)% to Cold Resistance", "(20-34)% 冰霜抗性穿透"],
    ["15% increased maximum Life if there are no Life Modifiers on Equipped Body Armour", "若装备的胸甲没有生命词缀，生命上限提高 15%"],
    ["The Pandemonius", "群魔殿"], ["Ashes of the Stars", "群星之灰"]
  ];
  for (const [en, cn] of examples) {
    assert.equal(translateText(en, lookup, settings), cn);
    assert.equal(translateText(en, lookup, { ...settings, language: "en" }), en);
  }
  assert.equal(translateText("The Pandemonius", lookup, settings, { category: "skill" }), "群魔殿");
  const support = "Supports any skill that hits enemies, making those hits penetrate enemy cold resistance.";
  assert.notEqual(translateText(support, lookup, settings), support);
  const keystone = "Enemies Chilled by your Hits have Cold Damage taken increased by Chill Effect\nEnemies in your Chilling Areas have Cold Damage taken increased by Chill Effect\nCannot deal non-Cold Damage";
  assert.match(translateText(keystone, lookup, settings), /无法造成非冰霜伤害/);
  assert.equal(translateText("+35% to Fire Resistance", lookup, { ...settings, categories: { stat: false } }), "+35% to Fire Resistance");
});

test("Focused Channelling numeric screenshot lines already have client rules", () => {
  require("../data/poe1-extended.js");
  const lookup = createLookup(globalThis.POE1_EXTENDED.entries, globalThis.POE1_EXTENDED.statRules);
  const settings = normalizeSettings();
  for (const [en, cn] of [
    ["Supported Skills have 20% more Cost per second Channelled, up to a maximum of 100%", "每持续吟唱 1 秒，被辅助技能的消耗总增 20%，最多 100%"],
    ["(9-24)% more Damage per second Channelled, up to a maximum of 60%", "每持续吟唱 1 秒，伤害增 (9-24)%，最多 60%"],
    ["(0-10)% increased Cast Speed", "施法速度加快 (0-10)%"]
  ]) {
    assert.equal(translateText(en, lookup, settings), cn);
    assert.equal(translateText(en, lookup, { ...settings, categories: { stat: false } }), en);
  }
});
