import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const candidates = [process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
let browser;
for (const candidate of candidates) {
  try { await fs.access(candidate); browser = candidate; break; } catch {}
}
if (!browser) throw new Error("Set BROWSER_PATH to a Chrome/Edge/Chromium executable");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.resolve(os.tmpdir());
const profile = await fs.mkdtemp(path.join(tempRoot, "poe-browser-test-"));
try {
  const result = spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, "--dump-dom", "--virtual-time-budget=6000",
    pathToFileURL(path.join(root, "tests/browser-harness.html")).href],
  { encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  const match = /<pre id="result">([\s\S]*?)<\/pre>/.exec(result.stdout ?? "");
  if (result.status !== 0 || !result.stdout?.includes('data-result="pass"')) {
    throw new Error(`Browser harness failed (exit ${result.status}): ${match?.[1] || result.stderr || result.stdout?.slice(0, 500) || "no output"}`);
  }
  console.log(match[1]);
} finally {
  if (path.dirname(path.resolve(profile)) !== tempRoot || !path.basename(profile).startsWith("poe-browser-test-")) {
    throw new Error("Refusing to clean unexpected browser profile path");
  }
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
