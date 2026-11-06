"use strict";

const DEFAULT_CACHE_LIMIT = 2000;
const MAX_CACHE_LIMIT = 100000;
const LOG_LIMIT = 100;
const PAGE_SIZE = 20;
let database;

function openCache() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("poe-guide-translations", 2);
      request.onupgradeneeded = event => {
        const db = request.result;
        if (event.oldVersion < 1) {
          db.createObjectStore("paragraphs").createIndex("created", "created");
        }
        db.createObjectStore("settings");
        db.createObjectStore("apiLogs", { autoIncrement: true });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
      request.onerror = () => { database = undefined; reject(request.error); };
    });
  }
  return database;
}

// Read results only after commit, including follow-up requests scheduled by cursors.
async function transaction(stores, mode, run) {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = run(tx);
    tx.oncomplete = () => resolve(result?.());
    tx.onabort = () => reject(tx.error || new Error("本地数据库事务已中止。"));
  });
}

function trimOldest(store, limit, order) {
  const count = store.count();
  count.onsuccess = () => {
    let excess = count.result - limit;
    if (excess <= 0) return;
    const oldest = order.openCursor();
    oldest.onsuccess = () => {
      const cursor = oldest.result;
      if (!cursor) return;
      cursor.delete();
      if (--excess > 0) cursor.continue();
    };
  };
}

function readCache(key) {
  return transaction("paragraphs", "readonly", tx => {
    const request = tx.objectStore("paragraphs").get(key);
    return () => request.result;
  });
}
function clearCache() {
  return transaction("paragraphs", "readwrite", tx => { tx.objectStore("paragraphs").clear(); });
}
function writeCache(key, value, metadata) {
  return transaction(["paragraphs", "settings"], "readwrite", tx => {
    const store = tx.objectStore("paragraphs");
    store.put({ value, ...metadata, created: Date.now() }, key);
    const limit = tx.objectStore("settings").get("limit");
    limit.onsuccess = () => trimOldest(store, limit.result ?? DEFAULT_CACHE_LIMIT, store.index("created"));
  });
}
function setCacheLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CACHE_LIMIT) throw new Error("请输入 1 至 100,000 的整数。");
  return transaction(["settings", "paragraphs"], "readwrite", tx => {
    tx.objectStore("settings").put(limit, "limit");
    const store = tx.objectStore("paragraphs");
    trimOldest(store, limit, store.index("created"));
  });
}
function addApiLog(entry) {
  return transaction("apiLogs", "readwrite", tx => {
    const store = tx.objectStore("apiLogs");
    store.add(entry);
    trimOldest(store, LOG_LIMIT, store);
  });
}
function clearApiLogs() {
  return transaction("apiLogs", "readwrite", tx => { tx.objectStore("apiLogs").clear(); });
}
function listPage(kind, requestedPage = 0) {
  const cache = kind === "paragraphs";
  return transaction(cache ? ["paragraphs", "settings"] : ["apiLogs"], "readonly", tx => {
    const store = tx.objectStore(kind);
    const count = store.count();
    const limit = cache ? tx.objectStore("settings").get("limit") : null;
    const rows = [];
    let page = 0;
    count.onsuccess = () => {
      page = Math.max(0, Math.min(requestedPage, Math.ceil(count.result / PAGE_SIZE) - 1));
      let offset = page * PAGE_SIZE;
      const order = cache ? store.index("created") : store;
      const request = order.openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (offset) { cursor.advance(offset); offset = 0; return; }
        rows.push(cursor.value);
        if (rows.length < PAGE_SIZE) cursor.continue();
      };
    };
    return () => ({ rows, page, count: count.result, limit: cache ? limit.result ?? DEFAULT_CACHE_LIMIT : LOG_LIMIT });
  });
}
