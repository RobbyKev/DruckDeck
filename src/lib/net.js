// Netzwerkzugriffe mit Rate-Limit und Cache.
// Scryfall erlaubt ca. 10 Anfragen/Sekunde an api.scryfall.com; wir bleiben bei 8.
// Die Bild-Server (cards.scryfall.io) haben kein Limit, wir sind trotzdem höflich.

import { getCachedJSON, putCachedJSON, getCachedBlob, putCachedBlob } from './cache.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createLimiter(perSecond) {
  const gap = 1000 / perSecond;
  let next = 0;
  return async function schedule() {
    const now = Date.now();
    const start = Math.max(now, next);
    next = start + gap;
    if (start > now) await sleep(start - now);
  };
}

const apiSlot = createLimiter(8);
const imageSlot = createLimiter(15);

const DAY = 24 * 60 * 60 * 1000;
export const TTL = { scryfall: 7 * DAY, mtgjson: 1 * DAY };

// Laufende Anfragen zusammenfassen, damit dieselbe URL nicht doppelt geladen wird.
const inflight = new Map();

function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function fetchWithRetry(url, slot, init) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (slot) await slot();
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastError;
}

// JSON laden. 404 → null. Ergebnis (auch null) wird gecacht.
export function getJSON(url, { ttl = TTL.scryfall, limited = true } = {}) {
  return once('json:' + url, async () => {
    const cached = await getCachedJSON(url, ttl);
    if (cached !== undefined) return cached;
    const res = await fetchWithRetry(url, limited ? apiSlot : null, { headers: { Accept: 'application/json' } });
    let data = null;
    if (res.ok) data = await res.json();
    else if (res.status !== 404) throw new Error(`HTTP ${res.status} bei ${url}`);
    await putCachedJSON(url, data);
    return data;
  });
}

// Bild als Blob laden (mit Cache).
export function getImageBlob(url) {
  return once('img:' + url, async () => {
    const cached = await getCachedBlob(url);
    if (cached) return cached;
    const res = await fetchWithRetry(url, imageSlot);
    if (!res.ok) throw new Error(`Bild nicht ladbar (HTTP ${res.status})`);
    const blob = await res.blob();
    await putCachedBlob(url, blob);
    return blob;
  });
}
