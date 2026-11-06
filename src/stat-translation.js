(function initStatTranslation(global) {
  "use strict";
  const NUMBER = "[+-]?(?:\\([+-]?\\d+(?:\\.\\d+)?\\s*[-–]\\s*[+-]?\\d+(?:\\.\\d+)?\\)|\\d+(?:\\.\\d+)?)";
  const normal = (text) => text.replace(/\s+/g, " ").trim();
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function tokenizeTemplate(text, arity) {
    if (/[\[\]<>]/.test(text)) throw new Error("unsupported markup");
    const tokens = [], regex = /\{(\d*)(?::(\+?d?|\+))?\}/g;
    let offset = 0, autoIndex = 0;
    for (const match of text.matchAll(regex)) {
      tokens.push(text.slice(offset, match.index));
      const index = match[1] ? Number(match[1]) : autoIndex++;
      if (index >= arity) throw new Error("placeholder outside stat tuple");
      tokens.push({ index, format: match[2] ?? "" });
      offset = match.index + match[0].length;
    }
    tokens.push(text.slice(offset));
    if (tokens.some((token) => typeof token === "string" && /[{}]/.test(token))) throw new Error("unsupported placeholder");
    return tokens;
  }

  function keyFor(text) {
    return normal(text).replace(new RegExp(NUMBER, "g"), "#");
  }

  function createStatLookup(rules) {
    const lookup = new Map();
    for (const rule of rules) {
      const captures = rule.en.tokens.filter((token) => typeof token !== "string").map((token) => token.index);
      const pattern = rule.en.tokens.map((token) => typeof token === "string"
        ? escape(token.replace(/\s+/g, " ")).replace(/ /g, "\\s+") : `(${NUMBER})`).join("");
      const sample = rule.en.tokens.map((token) => typeof token === "string" ? token : "0").join("");
      const key = keyFor(sample);
      if (!lookup.has(key)) lookup.set(key, []);
      lookup.get(key).push({ ...rule, regex: new RegExp(`^${pattern}$`), captures });
    }
    return lookup;
  }

  function interval(text) {
    const match = /^([+-]?)\(([+-]?\d+(?:\.\d+)?)\s*[-–]\s*([+-]?\d+(?:\.\d+)?)\)$/.exec(text);
    if (!match) return [Number(text), Number(text)];
    const sign = match[1] === "-" ? -1 : 1;
    return [sign * Number(match[2]), sign * Number(match[3])].sort((a, b) => a - b);
  }
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  function inCondition(range, condition, displayedAsRange = false) {
    if (!range) return true;
    if (condition === "#") return true;
    if (/^!-?\d+$/.test(condition)) {
      const excluded = Number(condition.slice(1));
      return range[1] < excluded || range[0] > excluded;
    }
    const parts = condition.split("|");
    const low = parts[0] === "#" ? -Infinity : Number(parts[0]);
    const high = parts.length === 1 ? low : parts[1] === "#" ? Infinity : Number(parts[1]);
    if (displayedAsRange && low === 1 && near(range[0], 0) && range[1] >= 1 && range[1] <= high) return true;
    if (displayedAsRange && high === -1 && near(range[1], 0) && range[0] <= -1 && range[0] >= low) return true;
    return range[0] >= low - 1e-6 && range[1] <= high + 1e-6;
  }
  function scalar(value, format) {
    if (format.includes("d") && !near(value, Math.round(value))) return null;
    const rounded = Math.round(value * 1e6) / 1e6;
    if (!near(value, rounded)) return null;
    return `${format.includes("+") && rounded >= 0 ? "+" : ""}${Object.is(rounded, -0) ? 0 : rounded}`;
  }
  function render(tokens, values, factors) {
    let output = "";
    for (const token of tokens) {
      if (typeof token === "string") { output += token; continue; }
      const range = values[token.index];
      if (!range) return null;
      const transformed = range.map((n) => n * factors[token.index]).sort((a, b) => a - b);
      if (near(...transformed)) {
        const value = scalar(transformed[0], token.format);
        if (value === null) return null;
        output += value;
      } else {
        const unsigned = token.format.replace("+", "");
        const low = scalar(transformed[0], unsigned), high = scalar(transformed[1], unsigned);
        if (low === null || high === null) return null;
        output += `${token.format.includes("+") && transformed[0] >= 0 ? "+" : ""}(${low}-${high})`;
      }
    }
    return output;
  }

  function translateStat(text, lookup, language) {
    if (!lookup || language === "en") return null;
    const candidates = lookup.get(keyFor(text));
    if (!candidates) return null;
    const translations = new Set();
    for (const rule of candidates) {
      const match = rule.regex.exec(normal(text));
      if (!match) continue;
      const target = language === "zh-TW" ? rule.zhTW : rule.zhCN;
      if (!target) continue;
      const values = rule.conditions.map((c) => /^-?\d+$/.test(c) ? [Number(c), Number(c)] : null);
      let valid = true;
      for (let i = 0; i < rule.captures.length; i += 1) {
        const index = rule.captures[i];
        const raw = interval(match[i + 1]).map((n) => n / rule.en.factors[index]).sort((a, b) => a - b);
        if (!raw.every((n) => Number.isFinite(n) && near(n, Math.round(n))) ||
          !inCondition(raw, rule.conditions[index], match[i + 1].includes("(")) ||
          (values[index] && (!near(values[index][0], raw[0]) || !near(values[index][1], raw[1])))) { valid = false; break; }
        values[index] = raw;
      }
      if (!valid) continue;
      const output = render(target.tokens, values, target.factors);
      if (output) translations.add(output);
    }
    return translations.size === 1 ? [...translations][0] : null;
  }
  const api = Object.freeze({ tokenizeTemplate, createStatLookup, translateStat });
  global.PoeStatTranslation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
