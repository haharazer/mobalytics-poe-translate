import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath =
  process.argv[2] ??
  "C:/Users/hanpe/Desktop/poe-trans-data/data/poe1/output/poe1_skill_gem_names_trilingual.xlsx";
const outputPath =
  process.argv[3] ?? "data/poe1-skill-gems.js";
const indexPath =
  process.argv[4] ?? path.join(path.dirname(sourcePath), "gems_index.json");

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const worksheet = workbook.worksheets.getItem("技能宝石名称");
const rows = worksheet.getUsedRange(true).values;

const [headers, ...dataRows] = rows;
const expectedHeaders = ["简体中文", "English", "繁體中文"];
if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
  throw new Error(
    `词表表头不符合预期：${JSON.stringify(headers)}，预期 ${JSON.stringify(expectedHeaders)}`
  );
}

const workbookEntries = dataRows
  .filter((row) => row.every((value) => typeof value === "string" && value.trim()))
  .map(([zhCN, en, zhTW]) => ({
    en: en.trim(),
    zhCN: zhCN.trim(),
    zhTW: zhTW.trim()
  }));

const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
const indexEntries = Object.values(index)
  .filter((gem) => gem.name_en && gem.name_zh && gem.name_tw)
  .map((gem) => ({
    en: gem.name_en.trim(),
    zhCN: gem.name_zh.trim(),
    zhTW: gem.name_tw.trim()
  }));

const indexByEnglish = new Map(indexEntries.map((entry) => [entry.en, entry]));
for (const workbookEntry of workbookEntries) {
  const indexed = indexByEnglish.get(workbookEntry.en);
  if (!indexed) {
    throw new Error(`完整索引缺少 Excel 词条：${workbookEntry.en}`);
  }
  if (
    indexed.zhCN !== workbookEntry.zhCN ||
    indexed.zhTW !== workbookEntry.zhTW
  ) {
    throw new Error(`Excel 与完整索引翻译不一致：${workbookEntry.en}`);
  }
}

const entries = indexEntries.sort((left, right) =>
  left.en.localeCompare(right.en, "en")
);

const englishNames = new Set();
const duplicates = [];
for (const entry of entries) {
  if (englishNames.has(entry.en)) duplicates.push(entry.en);
  englishNames.add(entry.en);
}
if (duplicates.length) {
  throw new Error(`发现重复英文名称：${[...new Set(duplicates)].join(", ")}`);
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
  `已生成 ${entries.length} 条技能石词条` +
  `（Excel 校验 ${workbookEntries.length} 条）：${outputPath}`
);
