import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export async function readDomain(manifestPath) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.schema_version !== 1 || manifest.game !== "poe1") {
    throw new Error(`${manifestPath}: unsupported schema/game`);
  }
  const root = path.dirname(path.resolve(manifestPath));
  const artifactPath = path.resolve(root, manifest.artifact.path);
  if (!artifactPath.startsWith(root + path.sep)) throw new Error("Artifact escapes manifest directory");
  const content = await fs.readFile(artifactPath);
  if (content.length !== manifest.artifact.size || sha256(content) !== manifest.artifact.sha256) {
    throw new Error(`${artifactPath}: size/sha256 mismatch`);
  }
  const records = content.toString("utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (records.length !== manifest.artifact.records) throw new Error("Artifact record count mismatch");
  const ids = new Set();
  for (const record of records) {
    if (record.schema_version !== 1 || (record.game && record.game !== "poe1") || !record.entity_id?.startsWith("poe1:") || ids.has(record.entity_id)) {
      throw new Error(`Invalid or duplicate entity: ${record.entity_id}`);
    }
    ids.add(record.entity_id);
  }
  return { manifest, records };
}

// Quoted commas, escaped quotes and multiline descriptions must survive CSV decoding.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(field); field = "";
      if (char !== ",") {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        rows.push(row); row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() ?? [];
  if (new Set(headers).size !== headers.length) throw new Error("Duplicate CSV column");
  return rows.filter((values) => values.some(Boolean)).map((values) => {
    if (values.length !== headers.length) throw new Error("CSV column count mismatch");
    return Object.fromEntries(headers.map((key, index) => [key, values[index]]));
  });
}

export function projectNames(records, categories) {
  return records.filter((record) => categories.includes(record.category) && record.names.en?.trim())
    .map((record) => ({
      category: record.category, en: record.names.en,
      zhCN: record.names["zh-CN"] || null, zhTW: record.names["zh-TW"] || null,
      entityIds: [record.entity_id]
    }));
}

export function projectAffixNames(records) {
  const domains = new Set(["ITEM", "FLASK", "BASE_JEWEL", "ABYSS_JEWEL", "AFFLICTION_JEWEL",
    "CRAFTED", "VEILED", "UNVEILED", "HEIST_TRINKET", "TINCTURE", "ANIMAL_CHARM"]);
  return projectNames(records.filter((record) => domains.has(record.domain?.name))
    .map((record) => ({ ...record, category: "affix" })), ["affix"]);
}

export async function readSkillDescriptions(manifest, inputRoot) {
  const tables = {}, inputs = [];
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const relativePath = `${locale}/activeskills.csv`;
    const input = manifest.inputs.find((entry) => entry.path === relativePath);
    if (!input) throw new Error(`Manifest does not declare ${relativePath}`);
    const content = await fs.readFile(path.join(inputRoot, relativePath));
    if (content.length !== input.size || sha256(content) !== input.sha256) {
      throw new Error(`${relativePath}: size/sha256 mismatch; rebuild the upstream release`);
    }
    const byId = new Map();
    for (const row of parseCsv(content.toString("utf8"))) {
      if (!row.Id || typeof row.Description !== "string" || byId.has(row.Id)) {
        throw new Error(`${relativePath}: missing Description/Id or duplicate stable Id`);
      }
      byId.set(row.Id, row);
    }
    tables[locale] = byId;
    inputs.push(input);
  }
  return { entries: projectSkillDescriptions(tables), inputs };
}

export function projectSkillDescriptions(tables) {
  const entries = [];
  for (const [id, row] of tables.en) {
    // Rendering instructions need their own parser; never guess their visible wording.
    const text = row.Description?.trim();
    if (!text || /[\[\]{}<>]/.test(text)) continue;
    const localized = (locale) => {
      const value = tables[locale].get(id)?.Description?.trim();
      return value && !/[\[\]{}<>]/.test(value) ? value : null;
    };
    const zhCN = localized("zh-CN"), zhTW = localized("zh-TW");
    if (zhCN || zhTW) entries.push({
      category: "skillDescription", en: text, zhCN, zhTW,
      entityIds: [`poe1:skill:${id}`]
    });
  }
  return entries;
}

export function compactEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.en?.trim() || (!entry.zhCN && !entry.zhTW)) continue;
    const key = JSON.stringify([entry.category, entry.en, entry.zhCN, entry.zhTW]);
    if (!groups.has(key)) groups.set(key, { ...entry, entityIds: new Set() });
    for (const id of entry.entityIds) groups.get(key).entityIds.add(id);
  }
  return [...groups.values()].map((entry) => ({ ...entry, entityIds: [...entry.entityIds].sort() }))
    .sort((a, b) => JSON.stringify([a.category, a.en, a.zhCN, a.zhTW])
      .localeCompare(JSON.stringify([b.category, b.en, b.zhCN, b.zhTW]), "en"));
}
