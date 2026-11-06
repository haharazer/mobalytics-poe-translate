import fs from "node:fs/promises";
import path from "node:path";

const releasePath =
  process.argv[2] ??
  "C:/Users/hanpe/Desktop/poe-client-data/dist/current/domains/localized-names/localized-names.v1.jsonl";
const outputPath = process.argv[3] ?? "data/poe1-skill-gems.js";
const keysPath = process.argv[4] ?? "data/poe1-skill-gem-keys.json";
const overlayPath = process.argv[5] ?? "data/poe1-skill-gems.overlay.json";

const records = (await fs.readFile(releasePath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  // Transfigured gems are named by ActiveSkills rather than BaseItemTypes,
  // so the downstream projection key is authoritative and category is not.
  .filter((record) => record.game === "poe1");
const keys = JSON.parse(await fs.readFile(keysPath, "utf8"));
const overlay = JSON.parse(await fs.readFile(overlayPath, "utf8"));

const candidates = new Map();
for (const record of records) {
  const name = record.names.en;
  if (!candidates.has(name)) candidates.set(name, []);
  candidates.get(name).push({
    category: record.category,
    entityId: record.entity_id,
    en: name,
    zhCN: record.names["zh-CN"],
    zhTW: record.names["zh-TW"]
  });
}
const overlayByEnglish = new Map(overlay.map((entry) => [entry.en, entry]));

const entries = keys.map((name) => {
  const overridden = overlayByEnglish.get(name);
  if (overridden) return overridden;
  const options = candidates.get(name) ?? [];
  const complete = options.filter((entry) => entry.zhCN && entry.zhTW);
  const baseGems = complete.filter(
    (entry) => entry.category === "gem" && !/Royale/i.test(entry.entityId)
  );
  const activeSkills = complete.filter((entry) => entry.category === "skill");
  const uniqueProjection = (source) => {
    const projected = source.map(({ en, zhCN, zhTW }) => ({ en, zhCN, zhTW }));
    return new Map(projected.map((entry) => [JSON.stringify(entry), entry]));
  };
  let unique = uniqueProjection(baseGems);
  if (unique.size !== 1) {
    const skillCandidates = uniqueProjection(activeSkills);
    if (skillCandidates.size === 1) unique = skillCandidates;
  }
  if (unique.size !== 1) {
    throw new Error(
      `${name}: expected one complete client candidate, found ${unique.size}; add an explicit overlay`
    );
  }
  return [...unique.values()][0];
});

const unusedOverlays = [...overlayByEnglish.keys()].filter((name) => !keys.includes(name));
if (unusedOverlays.length) {
  throw new Error(`overlay contains names outside the projection: ${unusedOverlays.join(", ")}`);
}

const body = [
  "/* 此文件由 scripts/generate_skill_dictionary.mjs 自动生成，请勿手动编辑。 */",
  "(function registerPoe1SkillGems(global) {",
  `  const entries = ${JSON.stringify(entries, null, 2).replace(/\n/g, "\n  ")};`,
  "  global.POE1_SKILL_GEMS = Object.freeze(",
  "    entries.map((entry) => Object.freeze(entry))",
  "  );",
  "})(typeof globalThis !== \"undefined\" ? globalThis : this);",
  ""
].join("\n");

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, body, "utf8");
console.log(
  `已从 poe-client-data 生成 ${entries.length} 条技能石词条` +
  `（显式 overlay ${overlay.length} 条）：${outputPath}`
);
