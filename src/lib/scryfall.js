// Auflösung einer Deck-Zeile zu einem deutschen Kartenbild.
//
// Reihenfolge:
// 1. Deutscher Druck derselben Ausgabe (/cards/<set>/<nr>/de)
// 2. Prüfen: image_status + Pixelvergleich mit dem englischen Druck (Scryfall
//    liefert manchmal unter lang:de das englische Bild).
// 3. Sonst andere deutsche Drucke über die oracle_id durchsuchen.
// 4. Sonst englisches Bild, deutlich markiert.

import { getJSON } from './net.js';
import { textboxDiff, DIFF_THRESHOLD } from './imagecheck.js';

const API = 'https://api.scryfall.com';
const GOOD_IMAGE = new Set(['highres_scan', 'lowres']);
const MAX_CANDIDATES = 12;

export const STATUS = {
  original: 'original', // deutsch, Original-Druck
  other: 'other',       // deutsch, anderer Druck
  english: 'english',   // nur Englisch
  missing: 'missing',   // Karte nicht gefunden
};

const enc = encodeURIComponent;

export function oracleId(card) {
  return card.oracle_id || card.card_faces?.[0]?.oracle_id || null;
}

// Bild-URIs pro Seite: doppelseitige Karten haben eigene image_uris je Seite.
export function faceImages(card) {
  if (card.image_uris) return [card.image_uris];
  if (card.card_faces?.length && card.card_faces.every((f) => f.image_uris)) {
    return card.card_faces.map((f) => f.image_uris);
  }
  return [];
}

export function isDoubleFaced(card) {
  return faceImages(card).length > 1;
}

// Deutscher Name: printed_name, bei mehrseitigen Karten Seiten mit „ // “ verbunden.
// null, wenn Scryfall keinen deutschen Namen hat (z. B. bei Raum-/Abenteuerkarten).
export function germanName(card) {
  if (card.lang !== 'de') return null;
  if (card.card_faces?.length > 1) {
    const names = germanFaceNames(card);
    if (names.every(Boolean)) return names.join(' // ');
    return null;
  }
  return card.printed_name || null;
}

// Deutsche Namen je Seite, null wo keiner vorhanden ist. Scryfall trägt bei manchen
// Raumkarten den englischen Gesamtnamen als printed_name ein – das zählt nicht.
export function germanFaceNames(card) {
  return (card.card_faces || []).map((f) => {
    const n = f.printed_name;
    if (!n || n === card.name || n.includes(' // ')) return null;
    return n;
  });
}

export function isBasicLand(card) {
  const type = card?.type_line || card?.card_faces?.[0]?.type_line || '';
  return /\bBasic\b/.test(type) && /\bLand\b/.test(type);
}

function printKey(set, number) {
  return `${API}/cards/${enc(set)}/${enc(number)}`;
}

// Prüft, ob ein lang:de-Druck wirklich ein deutsches Bild hat.
// Ergebnis: { ok, diff, reason }
export async function verifyGerman(deCard) {
  if (!deCard || deCard.lang !== 'de') return { ok: false, reason: 'kein deutscher Druck' };
  if (!GOOD_IMAGE.has(deCard.image_status)) return { ok: false, reason: `kein Scan (${deCard.image_status})` };
  const deSmall = faceImages(deCard)[0]?.small;
  if (!deSmall) return { ok: false, reason: 'kein Bild' };

  const en = await getJSON(`${printKey(deCard.set, deCard.collector_number)}/en`);
  const enSmall = en && GOOD_IMAGE.has(en.image_status) ? faceImages(en)[0]?.small : null;
  // Ohne englisches Gegenstück (z. B. reine Deutsch-Drucke) gibt es nichts zu vergleichen.
  if (!enSmall) return { ok: true, diff: null, reason: 'kein englischer Vergleich' };

  const diff = await textboxDiff(deSmall, enSmall);
  return diff > DIFF_THRESHOLD
    ? { ok: true, diff }
    : { ok: false, diff, reason: 'englisches Bild unter lang:de' };
}

// Alle deutschen Papier-Drucke einer Karte, neueste zuerst.
export async function germanPrints(oid) {
  if (!oid) return [];
  const q = `oracleid:${oid} lang:de game:paper`;
  const res = await getJSON(`${API}/cards/search?q=${enc(q)}&unique=prints&order=released&dir=desc`);
  return res?.data || [];
}

// Deutsche Drucke eines Standardlands (z. B. „Swamp“) für die Länder-Auswahl.
// pageUrl: next_page aus einer vorherigen Antwort, um weitere Drucke zu laden.
export async function basicLandPrints(englishName, { fullArt = false, pageUrl = null } = {}) {
  const q = `!"${englishName}" lang:de game:paper${fullArt ? ' is:fullart' : ''}`;
  const url = pageUrl || `${API}/cards/search?q=${enc(q)}&unique=prints&order=released&dir=desc`;
  const res = await getJSON(url);
  return { cards: res?.data || [], next: res?.has_more ? res.next_page : null, total: res?.total_cards || 0 };
}

async function findBase(entry) {
  if (entry.set && entry.number) {
    const card =
      (await getJSON(`${printKey(entry.set, entry.number)}/en`)) ||
      (await getJSON(printKey(entry.set, entry.number)));
    if (card) return card;
  }
  const front = entry.name.split(' // ')[0];
  return (
    (await getJSON(`${API}/cards/named?exact=${enc(entry.name)}`)) ||
    (await getJSON(`${API}/cards/named?exact=${enc(front)}`)) ||
    (await getJSON(`${API}/cards/named?fuzzy=${enc(entry.name)}`))
  );
}

// Haupteinstieg: Deck-Zeile → Ergebnis
export async function resolveEntry(entry) {
  const base = await findBase(entry);
  if (!base) return { status: STATUS.missing, base: null, chosen: null, note: 'Karte nicht gefunden' };

  // Referenzdruck: der im Deck angegebene, sonst der Standard-Druck von Scryfall.
  const refSet = entry.set && entry.number ? entry.set : base.set;
  const refNumber = entry.set && entry.number ? entry.number : base.collector_number;
  const explicitPrint = Boolean(entry.set && entry.number);

  const tried = new Set();
  const checks = {};

  const original = await getJSON(`${printKey(refSet, refNumber)}/de`);
  if (original) {
    tried.add(original.id);
    const v = await verifyGerman(original);
    checks[original.id] = v;
    if (v.ok) return result(base, original, STATUS.original, { checks, explicitPrint, originalId: original.id });
  }

  const prints = await germanPrints(oracleId(base));
  for (const card of prints.filter((c) => !tried.has(c.id)).slice(0, MAX_CANDIDATES)) {
    const v = await verifyGerman(card);
    checks[card.id] = v;
    if (v.ok) {
      // Ohne Set-Angabe im Deck gibt es keinen „Original-Druck“ – jeder deutsche Druck ist richtig.
      const status = explicitPrint ? STATUS.other : STATUS.original;
      return result(base, card, status, { checks, explicitPrint, originalId: original?.id, prints });
    }
  }

  return result(base, base, STATUS.english, { checks, explicitPrint, originalId: original?.id, prints });
}

function result(base, chosen, status, extra) {
  return { base, chosen, status, ...extra };
}

// Für einen frei gewählten Druck (Alternativen-Dialog) den Status bestimmen.
export function statusFor(res, card) {
  if (card.lang !== 'de') return STATUS.english;
  return card.id === res.originalId || !res.explicitPrint ? STATUS.original : STATUS.other;
}
