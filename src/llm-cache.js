"use strict";

let database;
function openCache() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("poe-guide-translations", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("paragraphs");
        store.createIndex("created", "created");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = undefined; reject(request.error); };
    });
  }
  return database;
}

async function cacheTransaction(mode, run) {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("paragraphs", mode);
    const request = run(tx.objectStore("paragraphs"));
    tx.oncomplete = () => resolve(request?.result);
    tx.onabort = () => reject(tx.error);
  });
}

const readCache = key => cacheTransaction("readonly", store => store.get(key));
const clearCache = () => cacheTransaction("readwrite", store => store.clear());
function writeCache(key, value) {
  return cacheTransaction("readwrite", store => {
    store.put({ value, created: Date.now() }, key);
    const count = store.count();
    count.onsuccess = () => {
      let excess = count.result - 2000;
      if (excess <= 0) return;
      const oldest = store.index("created").openCursor();
      oldest.onsuccess = () => {
        const cursor = oldest.result;
        if (!cursor) return;
        cursor.delete();
        if (--excess > 0) cursor.continue();
      };
    };
  });
}
