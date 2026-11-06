import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv, sha256, compactEntries, readDomain, projectNames } from "./lib/client-data.mjs";
import { decodeResource, parseStatDescriptions, compileStatFile } from "./lib/stat-descriptions.mjs";
import { createRequire } from "node:module";
const { tokenizeTemplate } = createRequire(import.meta.url)("../src/stat-translation.js");

const inputRoot = path.resolve(process.argv[2] ?? ".local/client-translation");
const outputPath = process.argv[3] ?? "data/poe1-extended.js";
async function snapshot(channel) {
  const manifest = JSON.parse(await fs.readFile(path.join(inputRoot, `${channel}.manifest.json`), "utf8"));
  if (manifest.schema_version !== 1 || manifest.game !== "poe1" || manifest.adapter !== "client-translation-snapshot") throw new Error("Unsupported translation snapshot");
  const contents = new Map();
  for (const input of manifest.inputs) {
    const file = path.resolve(inputRoot, input.path);
    if (!file.startsWith(inputRoot + path.sep) || contents.has(input.path)) throw new Error("Invalid snapshot input path");
    const content = await fs.readFile(file);
    if (content.length !== input.size || sha256(content) !== input.sha256) throw new Error(`${input.path}: snapshot hash mismatch`);
    contents.set(input.path, content);
  }
  return { manifest, contents };
}
const intl = await snapshot("international"), cn = await snapshot("cn");
const files = new Map([...intl.contents, ...cn.contents]);
const csv = (locale, table) => parseCsv(files.get(`${locale}/${table}.csv`).toString("utf8"));
const byId = (rows) => {
  const result = new Map();
  for (const row of rows) {
    if (!row.Id || result.has(row.Id)) throw new Error(`Invalid/duplicate stable Id ${row.Id}`);
    result.set(row.Id, row);
  }
  return result;
};
const gems = Object.fromEntries(["en", "zh-CN", "zh-TW"].map((locale) => [locale, byId(csv(locale, "gemeffects"))]));
const words = Object.fromEntries(["en", "zh-CN", "zh-TW"].map((locale) => [locale, csv(locale, "words")]));
const wordKey = (word) => `${word.Wordlist}:${word.HASH32}`;
const selectedWords = Object.fromEntries(["en", "zh-CN", "zh-TW"].map((locale) => {
  const selected = new Map();
  for (const layout of csv(locale, "uniquestashlayout")) {
    const index = /^<(\d+),\s*\d+>$/.exec(layout.WordsKey)?.[1];
    if (index === undefined || !words[locale][Number(index)]) throw new Error("Invalid local Words foreign key");
    const word = words[locale][Number(index)];
    const key = wordKey(word);
    if (selected.has(key) && JSON.stringify(selected.get(key)) !== JSON.stringify(word)) throw new Error("Ambiguous Words structural identity");
    selected.set(key, word);
  }
  return [locale, selected];
}));
let normalizedDisplayNames = 0;
const cleanName = (value) => {
  const cleaned = value?.trim().replace(/(?:\[\d+(?:\.\d+)?[a-z]\])+$/i, "").trim();
  if (cleaned !== value?.trim()) normalizedDisplayNames += 1;
  return cleaned || null;
};
const entries = [];
const namesManifest = path.join(process.env.POE_CLIENT_DATA_ROOT ?? "C:/Users/hanpe/Desktop/poe-client-data", "dist/current/domains/localized-names/localized-names.v1.manifest.json");
const names = await readDomain(namesManifest);
entries.push(...projectNames(names.records.filter((record) => record.entity_id === "poe1:ui:ItemDescriptionSupportSkillGem"), ["ui"])
  .map((entry) => ({ ...entry, category: "skillDescription" })));
for (const [id, gem] of gems.en) {
  if (!gem.SupportText?.trim() || /[\[\]{}<>]/.test(gem.SupportText)) continue;
  const localized = (locale) => {
    const value = gems[locale].get(id)?.SupportText?.trim();
    return value && !/[\[\]{}<>]/.test(value) ? value : null;
  };
  entries.push({ category: "skillDescription", en: gem.SupportText.trim(), zhCN: localized("zh-CN"), zhTW: localized("zh-TW"), entityIds: [`poe1:gem_effect:${id}`] });
}
for (const [key, word] of selectedWords.en) {
  const localized = (locale) => {
    const other = selectedWords[locale].get(key);
    // HASH32 plus wordlist is checked against the invariant Text field, never locale row position.
    if (!other || other.Text !== word.Text) return null;
    return cleanName(other.Text2);
  };
  entries.push({ category: "item", en: cleanName(word.Text2 || word.Text), zhCN: localized("zh-CN"), zhTW: localized("zh-TW"), entityIds: [`poe1:unique_word:${key}`] });
}
const selectedFiles = ["stat_descriptions", "skill_stat_descriptions", "gem_stat_descriptions", "active_skill_gem_stat_descriptions", "passive_skill_stat_descriptions", "aura_skill_stat_descriptions", "buff_skill_stat_descriptions", "curse_skill_stat_descriptions"];
const rulesByContent = new Map(), diagnostics = {};
for (const name of selectedFiles) {
  const filename = `${name}.txt`;
  const result = compileStatFile(
    parseStatDescriptions(decodeResource(files.get(`en/statdescriptions/${filename}`))),
    parseStatDescriptions(decodeResource(files.get(`zh-CN/statdescriptions/${filename}`))), filename
  );
  diagnostics[filename] = { compiled: result.rules.length, skipped: result.skipped };
  for (const { source, statIds, ...rule } of result.rules) {
    const key = JSON.stringify(rule);
    if (!rulesByContent.has(key)) rulesByContent.set(key, { ...rule, sources: [] });
    rulesByContent.get(key).sources.push({ file: source, statIds });
  }
}
const aliases = JSON.parse(await fs.readFile("data/mobalytics-stat-aliases.json", "utf8"));
for (const alias of aliases) {
  const matches = [...rulesByContent.values()].filter((rule) => rule.sources.some((source) =>
    source.file === alias.sourceFile && source.statIds.length === 1 && source.statIds[0] === alias.statId
  ) && JSON.stringify(rule.en.tokens) === JSON.stringify(tokenizeTemplate(alias.clientTemplate, 1)));
  if (!matches.length) throw new Error(`Missing canonical stat rule for Mobalytics alias: ${alias.siteTemplate}`);
  for (const rule of matches) {
    const projected = { ...rule, en: { ...rule.en, tokens: tokenizeTemplate(alias.siteTemplate, 1) },
      sources: [...rule.sources, { file: "data/mobalytics-stat-aliases.json", statIds: [alias.statId] }] };
    rulesByContent.set(JSON.stringify(projected), projected);
  }
}
const compact = compactEntries(entries);
const counts = {
  supportDescriptions: compact.filter((row) => row.category === "skillDescription").length,
  uniqueNames: compact.filter((row) => row.category === "item").length,
  statRules: rulesByContent.size
};
const body = `/* Generated by scripts/generate_extended_dictionary.mjs. */\n` +
  `(function(global) { global.POE1_EXTENDED = Object.freeze(${JSON.stringify({ counts, entries: compact, statRules: [...rulesByContent.values()] })}); })(globalThis);\n`;
await fs.writeFile(outputPath, body, "utf8");
const report = { schemaVersion: 1, sources: [intl.manifest, cn.manifest], supportReminderSource: { datasetId: names.manifest.dataset_id, artifact: names.manifest.artifact }, counts, normalizedDisplayNames, siteAliases: aliases, diagnostics,
  limitations: ["Only supported stat AST conditions/formatters/linear transforms are compiled; unsupported directives are reported and skipped", "CN branches whose English semantics differ from the international snapshot are skipped", "Client snapshots may contain user-modified locale text; known trailing display annotations are removed from unique names", "Canvas text rendering is not established by this dataset; DOM tree effects and tooltips use the same stat translator"] };
await fs.writeFile(outputPath.replace(/\.js$/, ".report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`Extended dictionary: ${JSON.stringify(counts)}; unique-name display annotations removed: ${normalizedDisplayNames}`);
