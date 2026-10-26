// IndexedDB-Cache für API-Antworten (JSON) und Bilder (Blob).
// Fällt auf einen Speicher-Cache zurück, wenn IndexedDB nicht verfügbar ist
// (z. B. privates Fenster in Safari).

const DB_NAME = 'druckdeck';
const DB_VERSION = 1;
const STORES = {
  json: 'json',   // { key, t, data }
  blobs: 'blobs', // { key, t, blob }
  decks: 'decks', // vorbereitet für „Meine Decks“: { id, name, savedAt, entries }
};

let dbPromise = null;
const memory = new Map();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.json)) db.createObjectStore(STORES.json, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORES.blobs)) db.createObjectStore(STORES.blobs, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORES.decks)) db.createObjectStore(STORES.decks, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet(store, key) {
  const db = await openDb();
  if (!db) return memory.get(store + ':' + key);
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function idbPut(store, value) {
  const db = await openDb();
  if (!db) {
    memory.set(store + ':' + (value.key ?? value.id), value);
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCachedJSON(key, maxAgeMs) {
  const hit = await idbGet(STORES.json, key);
  if (!hit) return undefined;
  if (maxAgeMs != null && Date.now() - hit.t > maxAgeMs) return undefined;
  return hit.data;
}

export function putCachedJSON(key, data) {
  return idbPut(STORES.json, { key, t: Date.now(), data });
}

export async function getCachedBlob(key) {
  const hit = await idbGet(STORES.blobs, key);
  return hit?.blob;
}

export function putCachedBlob(key, blob) {
  return idbPut(STORES.blobs, { key, t: Date.now(), blob });
}

export async function clearCache() {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  await Promise.all(
    [STORES.json, STORES.blobs].map(
      (store) =>
        new Promise((resolve) => {
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        }),
    ),
  );
}

// --- Vorbereitet für „Meine Decks“ (noch nicht in der Oberfläche verwendet) ---

export function saveDeck(deck) {
  return idbPut(STORES.decks, { ...deck, savedAt: Date.now() });
}

export async function listDecks() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(STORES.decks, 'readonly').objectStore(STORES.decks).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}
