// Netzwerkzugriffe mit Rate-Limit und Cache.
// Scryfall-Limits (scryfall.com/docs/api/rate-limits):
//   /cards/search, /cards/named, /cards/random, /cards/collection: 2/Sekunde
//   alle anderen API-Aufrufe: 10/Sekunde – wir bleiben bei 8
// Ein HTTP 429 sperrt für 30 Sekunden. Der Browser meldet das oft nur als
// CORS-Fehler (429-Antworten haben keinen CORS-Header), daher behandeln wir
// Netzwerkfehler bei der API genauso und pausieren alle API-Anfragen.
// Die Bild-Server (cards.scryfall.io) haben kein Limit, wir sind trotzdem höflich.

import { getCachedJSON, putCachedJSON, getCachedBlob, putCachedBlob } from './cache.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createLimiter(perSecond) {
  const gap = 1000 / perSecond;
  let next = 0;
  const schedule = async () => {
    const now = Date.now();
    const start = Math.max(now, next);
    next = start + gap;
    if (start > now) await sleep(start - now);
  };
  schedule.restartAt = (t) => (next = t);
  return schedule;
}

const apiSlot = createLimiter(8);
const strictSlot = createLimiter(1.8);
const imageSlot = createLimiter(15);
const STRICT = /\/cards\/(search|named|random|collection)\b/;
const PAUSE_MS = 31_000;

let pausedUntil = 0;
let throttleListener = null;

// Wird aufgerufen, wenn Scryfall bremst (Argument: Zeitpunkt, bis zu dem pausiert wird).
export function onThrottle(fn) {
  throttleListener = fn;
}

function pauseApi() {
  pausedUntil = Math.max(pausedUntil, Date.now() + PAUSE_MS);
  apiSlot.restartAt(pausedUntil);
  strictSlot.restartAt(pausedUntil);
  throttleListener?.(pausedUntil);
}

async function apiGate(url) {
  for (;;) {
    if (Date.now() < pausedUntil) await sleep(pausedUntil - Date.now());
    if (STRICT.test(url)) await strictSlot();
    await apiSlot();
    // Während des Wartens kann eine Pause ausgelöst worden sein → neu einreihen
    if (Date.now() >= pausedUntil) return;
  }
}

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

async function fetchApi(url, init) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    await apiGate(url);
    try {
      const res = await fetch(url, init);
      if (res.status === 429) {
        lastError = new Error('Scryfall-Limit erreicht');
        pauseApi();
        continue;
      }
      if (res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      // Meist ein 429 ohne CORS-Header – sicherheitshalber pausieren
      lastError = new Error('Netzwerkfehler');
      pauseApi();
    }
  }
  throw lastError;
}

async function fetchPlain(url, slot, init) {
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
// limited: über das Scryfall-Rate-Limit (für MTGJSON false).
export function getJSON(url, { ttl = TTL.scryfall, limited = true } = {}) {
  return once('json:' + url, async () => {
    const cached = await getCachedJSON(url, ttl);
    if (cached !== undefined) return cached;
    const init = { headers: { Accept: 'application/json' } };
    const res = limited ? await fetchApi(url, init) : await fetchPlain(url, null, init);
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
    const res = await fetchPlain(url, imageSlot);
    if (!res.ok) throw new Error(`Bild nicht ladbar (HTTP ${res.status})`);
    const blob = await res.blob();
    await putCachedBlob(url, blob);
    return blob;
  });
}
