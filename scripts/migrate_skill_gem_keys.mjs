import fs from "node:fs/promises";

const sourcePath = process.argv[2] ?? "data/poe1-skill-gems.js";
const outputPath = process.argv[3] ?? "data/poe1-skill-gem-keys.json";
const text = await fs.readFile(sourcePath, "utf8");
const match = text.match(/const entries = (\[.*?\]);\s*global\.POE1_SKILL_GEMS/s);
if (!match) throw new Error(`cannot locate generated entries in ${sourcePath}`);
const entries = JSON.parse(match[1]);
const keys = entries.map((entry) => entry.en);
if (new Set(keys).size !== keys.length) throw new Error("source contains duplicate English names");
await fs.writeFile(outputPath, `${JSON.stringify(keys, null, 2)}\n`, "utf8");
console.log(`wrote ${keys.length} projection keys to ${outputPath}`);
