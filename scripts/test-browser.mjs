import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
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
function runHarness(filename) {
  const result = spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, "--dump-dom", "--virtual-time-budget=6000",
    pathToFileURL(path.join(root, "tests", filename)).href],
  { encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  const match = /<pre id="result">([\s\S]*?)<\/pre>/.exec(result.stdout ?? "");
  if (result.status !== 0 || !result.stdout?.includes('data-result="pass"')) {
    throw new Error(`Browser harness failed (exit ${result.status}): ${match?.[1] || result.stderr || result.stdout?.slice(0, 500) || "no output"}`);
  }
  console.log(match[1]);
}
// IndexedDB runs on a real IO thread. Wait for the page to report its result
// instead of dumping the DOM when Chrome's virtual-time budget expires.
async function runStorageHarness() {
  const html = await fs.readFile(path.join(root, "tests/storage-harness.html"));
  const script = await fs.readFile(path.join(root, "src/llm-cache.js"));
  const { promise, resolve, reject } = Promise.withResolvers();
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/result") {
      let result = "";
      for await (const chunk of req) result += chunk;
      res.end();
      if (result === "pass") resolve();
      else reject(new Error("Storage tests failed: " + result));
    } else if (req.url === "/" || req.url === "/src/llm-cache.js") {
      res.setHeader("Content-Type", req.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
      res.end(req.url === "/" ? html : script);
    } else {
      res.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`],
    { stdio: "ignore", windowsHide: true });
  const closed = once(child, "close");
  const timer = setTimeout(() => reject(new Error("Storage tests timed out")), 30000);
  try {
    await Promise.race([promise, closed.then(() => { throw new Error("Browser exited during storage tests"); })]);
    console.log("Passed IndexedDB upgrade, capacity, pagination and API log retention tests");
  } finally {
    clearTimeout(timer);
    child.kill();
    server.close();
    server.closeAllConnections();
    await closed;
  }
}
try {
  runHarness("browser-harness.html");
  runHarness("maxroll-harness.html");
  await runStorageHarness();
} finally {
  if (path.dirname(path.resolve(profile)) !== tempRoot || !path.basename(profile).startsWith("poe-browser-test-")) {
    throw new Error("Refusing to clean unexpected browser profile path");
  }
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
