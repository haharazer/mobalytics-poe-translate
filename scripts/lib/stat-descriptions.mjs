import { createRequire } from "node:module";
const { tokenizeTemplate } = createRequire(import.meta.url)("../../src/stat-translation.js");

export function decodeResource(bytes) {
  return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
}

export function parseStatDescriptions(text) {
  const blocks = [];
  const starts = [...text.matchAll(/^description(?:[ \t]+([^\r\n]+))?[ \t]*\r?$/gm)];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const raw = text.slice(start.index + start[0].length, starts[index + 1]?.index ?? text.length);
    const identifier = start[1]?.trim() ?? "";
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const header = /^(\d+)\s+(.+)$/.exec(lines.shift() ?? "");
    if (!header) throw new Error("Invalid stat description header");
    const statIds = header[2].split(/\s+/), arity = Number(header[1]);
    if (statIds.length !== arity) throw new Error("Stat tuple arity mismatch");
    const languages = { en: [] };
    let locale = "en";
    for (let cursor = 0; cursor < lines.length;) {
      const lang = /^lang "([^"]+)"$/.exec(lines[cursor]);
      if (lang) { locale = lang[1]; languages[locale] = []; cursor += 1; }
      const count = Number(lines[cursor]);
      if (!Number.isInteger(count)) break; // include/no_description applies to a later block.
      cursor += 1;
      for (let index = 0; index < count; index += 1) {
        const source = lines[cursor++];
        const match = /^(.*?)\s*"((?:[^"\\]|\\.)*)"(.*)$/.exec(source ?? "");
        if (!match) throw new Error(`Malformed display line: ${source}`);
        const conditions = match[1].trim().split(/\s+/);
        if (conditions.length !== arity || conditions.some((c) => !/^(?:!-?\d+|(?:#|-?\d+)(?:\|(?:#|-?\d+))?)$/.test(c))) {
          languages[locale].push({ unsupported: "conditions", source }); continue;
        }
        let template;
        try { template = JSON.parse(`"${match[2]}"`); }
        catch { languages[locale].push({ unsupported: "string escape", source }); continue; }
        languages[locale].push({ conditions, template, directives: match[3].trim(), source });
      }
    }
    blocks.push({ identifier, statIds, languages });
  }
  return blocks;
}

export function compileLine(line, arity) {
  if (line.unsupported) throw new Error(line.unsupported);
  const factors = Array(arity).fill(1), directives = line.directives.split(/\s+/).filter(Boolean);
  const multipliers = {
    negate: -1, double: 2, negate_and_double: -2, divide_by_one_hundred: 0.01,
    divide_by_ten: 0.1, divide_by_ten_1dp_if_required: 0.1,
    milliseconds_to_seconds: 0.001, per_minute_to_per_second: 1 / 60
  };
  for (let i = 0; i < directives.length; i += 1) {
    const name = directives[i];
    if (name === "canonical_line") continue;
    if (name === "reminderstring") { if (!directives[++i]) throw new Error("missing reminder id"); continue; }
    if (!(name in multipliers)) throw new Error(`unsupported transform: ${name}`);
    const index = Number(directives[++i]) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= arity) throw new Error("invalid transform stat index");
    factors[index] *= multipliers[name];
  }
  return { tokens: tokenizeTemplate(line.template, arity), factors };
}

export function compileStatFile(international, cn, filename) {
  const rows = [], skipped = {};
  const note = (reason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const cnById = new Map();
  for (const block of cn) {
    const key = `${block.identifier ?? ""}:${block.statIds.join(" ")}`;
    if (!cnById.has(key)) cnById.set(key, []);
    cnById.get(key).push(block);
  }
  for (const block of international) {
    for (const line of block.languages.en) {
      let en;
      try { en = compileLine(line, block.statIds.length); }
      catch (error) { note(error.message); continue; }
      const conditions = JSON.stringify(line.conditions);
      const choose = (source, locale) => {
        const options = source.flatMap((candidate) => candidate.languages[locale] ?? [])
          .filter((candidate) => JSON.stringify(candidate.conditions) === conditions);
        const valid = new Map();
        for (const option of options) {
          try { const compiled = compileLine(option, block.statIds.length); valid.set(JSON.stringify(compiled), compiled); }
          catch (error) { note(`${locale}: ${error.message}`); }
        }
        return valid.size === 1 ? [...valid.values()][0] : null;
      };
      // Reject a version-skewed CN branch if its English meaning/transform changed.
      const alignedCn = (cnById.get(`${block.identifier ?? ""}:${block.statIds.join(" ")}`) ?? []).filter((candidate) =>
        candidate.languages.en.some((cnLine) => {
          try { return JSON.stringify(cnLine.conditions) === conditions && JSON.stringify(compileLine(cnLine, block.statIds.length)) === JSON.stringify(en); }
          catch { return false; }
        }));
      const zhCN = choose(alignedCn, "Simplified Chinese");
      const zhTW = choose([block], "Traditional Chinese");
      if (!zhCN && !zhTW) { note("no unambiguous aligned locale"); continue; }
      rows.push({ statIds: block.statIds, identifier: block.identifier, source: filename, conditions: line.conditions, en, zhCN, zhTW });
    }
  }
  return { rules: rows, skipped };
}
