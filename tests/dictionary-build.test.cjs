const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const lib = import("../scripts/lib/client-data.mjs");

test("CSV parser preserves quoted multiline text and rejects damaged input", async () => {
  const { parseCsv } = await lib;
  assert.deepEqual(parseCsv('\uFEFFId,Description\r\na,"One, two.\r\nSay ""hi""."\r\n'), [
    { Id: "a", Description: 'One, two.\r\nSay "hi".' }
  ]);
  assert.throws(() => parseCsv('Id,Description\na,"broken'), /Unterminated/);
  assert.throws(() => parseCsv('Id,Id\na,b'), /Duplicate/);
  assert.throws(() => parseCsv('Id,Description\na,b,c'), /column count/);
});

test("description projection joins stable IDs despite locale row order and skips markup", async () => {
  const { projectSkillDescriptions } = await lib;
  const table = (rows) => new Map(rows.map(([id, Description]) => [id, { Description }]));
  const rows = projectSkillDescriptions({
    en: table([["a", "Attack."], ["b", "Defend."], ["c", "[link|text]"]]),
    "zh-CN": table([["b", "防御。"], ["a", "攻击。"]]),
    "zh-TW": table([["b", "防禦。"]])
  });
  assert.deepEqual(rows, [
    { category: "skillDescription", en: "Attack.", zhCN: "攻击。", zhTW: null, entityIds: ["poe1:skill:a"] },
    { category: "skillDescription", en: "Defend.", zhCN: "防御。", zhTW: "防禦。", entityIds: ["poe1:skill:b"] }
  ]);
});

test("compaction preserves all identities and conflicting translations", async () => {
  const { compactEntries, projectAffixNames } = await lib;
  const base = { category: "item", en: "Base", zhCN: "基底", zhTW: "基底" };
  const rows = compactEntries([{ ...base, entityIds: ["b"] }, { ...base, entityIds: ["a"] }, { ...base, zhCN: "其他", entityIds: ["c"] }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((row) => row.zhCN === "基底").entityIds, ["a", "b"]);
  assert.equal(projectAffixNames([{ domain: { name: "MONSTER" }, names: { en: "Strong" } }]).length, 0);
});

test("domain and table adapters fail on hash, schema, identity or path errors", async (t) => {
  const { readDomain, sha256, readSkillDescriptions } = await lib;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-dictionary-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = JSON.stringify({ schema_version: 1, entity_id: "poe1:item:a" }) + "\n";
  const manifest = { schema_version: 1, game: "poe1", artifact: { path: "names.jsonl", size: Buffer.byteLength(data), sha256: sha256(data), records: 1 } };
  const manifestPath = path.join(root, "manifest.json");
  await fs.writeFile(path.join(root, "names.jsonl"), data);
  const write = (value) => fs.writeFile(manifestPath, JSON.stringify(value));
  await write(manifest);
  assert.equal((await readDomain(manifestPath)).records.length, 1);
  await fs.appendFile(path.join(root, "names.jsonl"), " ");
  await assert.rejects(readDomain(manifestPath), /sha256 mismatch/);
  await write({ ...manifest, schema_version: 2 });
  await assert.rejects(readDomain(manifestPath), /unsupported/);
  await write({ ...manifest, artifact: { ...manifest.artifact, path: "../escape.jsonl" } });
  await assert.rejects(readDomain(manifestPath), /escapes/);
  const duplicate = data + data;
  await fs.writeFile(path.join(root, "names.jsonl"), duplicate);
  await write({ ...manifest, artifact: { ...manifest.artifact, size: Buffer.byteLength(duplicate), sha256: sha256(duplicate), records: 2 } });
  await assert.rejects(readDomain(manifestPath), /duplicate entity/);
  await fs.mkdir(path.join(root, "en"));
  await fs.writeFile(path.join(root, "en/activeskills.csv"), "Id,Description\na,Attack.");
  await assert.rejects(readSkillDescriptions({ inputs: [{ path: "en/activeskills.csv", size: 0, sha256: "bad" }] }, root), /sha256 mismatch/);
});
