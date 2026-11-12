// Minimal promise IndexedDB key-value store for large data (playlists, EPG).
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open('aurora-tv', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const r = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const idb = {
  get: (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined),
  set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
  del: (k) => tx('readwrite', (s) => s.delete(k)),
  keys: () => tx('readonly', (s) => s.getAllKeys()).catch(() => []),
};
