// Erzeugt public/precons.json für die Übersicht „Alle Precons“.
// Läuft beim Bauen (GitHub Actions) bzw. lokal mit `npm run precons`.
//
// Pro Commander-Precon: Name, Set, Datum, Farbidentität, Kartenzahl und die
// Kommandanten mit deutschem Namen und Bildern (ganze Karte + Artwork).
// Daten: MTGJSON (Decklisten, deutsche Namen, Scryfall-IDs), Scryfall (Bilder).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/precons.json');
const MTGJSON = 'https://mtgjson.com/api/v5';
const SCRYFALL = 'https://api.scryfall.com';
const HEADERS = { 'User-Agent': 'DruckDeck/0.1 (privates Proxy-Tool)', Accept: 'application/json' };
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, init = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await sleep(res.status === 429 ? 31_000 : 2000 * (attempt + 1));
  }
  throw new Error(`Abruf fehlgeschlagen: ${url}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

// Scryfall /cards/collection: bis 75 Karten pro Anfrage, max. 2 Anfragen/Sekunde
async function scryfallCollection(ids) {
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75).map((id) => ({ id }));
    const res = await getJSON(`${SCRYFALL}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk }),
    });
    for (const c of res?.data || []) byId.set(c.id, c);
    await sleep(600);
  }
  return byId;
}

const imagesOf = (card) => card?.image_uris || card?.card_faces?.[0]?.image_uris || null;
const usableImage = (card) => card && ['highres_scan', 'lowres'].includes(card.image_status) && imagesOf(card);

async function main() {
  console.log('Lade Deckliste …');
  const list = (await getJSON(`${MTGJSON}/DeckList.json`)).data.filter((d) => d.type === 'Commander Deck');
  const sets = await getJSON(`${SCRYFALL}/sets`);
  const setNames = Object.fromEntries((sets?.data || []).map((s) => [s.code.toUpperCase(), s.name]));

  console.log(`Lade ${list.length} Decks von MTGJSON …`);
  const decks = await mapLimit(list, 6, async (d) => {
    const deck = (await getJSON(`${MTGJSON}/decks/${encodeURIComponent(d.fileName)}.json`))?.data;
    if (!deck) return null;
    const cards = [...(deck.commander || []), ...(deck.mainBoard || [])];
    const colors = new Set((deck.commander || []).flatMap((c) => c.colorIdentity || []));
    return {
      name: d.name,
      fileName: d.fileName,
      code: d.code,
      setName: setNames[d.code] || '',
      releaseDate: d.releaseDate,
      colors: COLOR_ORDER.filter((c) => colors.has(c)),
      count: cards.reduce((n, c) => n + (c.count || 1), 0),
      commanders: (deck.commander || []).map((c) => {
        const de = (c.foreignData || []).find((f) => f.language === 'German');
        return { name: c.name, deName: de?.name || null, enId: c.identifiers?.scryfallId, deId: de?.identifiers?.scryfallId };
      }),
    };
  });

  const valid = decks.filter(Boolean);
  const ids = [...new Set(valid.flatMap((d) => d.commanders.flatMap((c) => [c.deId, c.enId]).filter(Boolean)))];
  console.log(`Lade Bilder für ${ids.length} Kommandanten-Drucke von Scryfall …`);
  const cards = await scryfallCollection(ids);

  // Kein deutscher Druck im eigenen Set → anderen deutschen Druck suchen (2 Anfragen/Sekunde)
  const otherDe = new Map();
  const missing = valid.flatMap((d) => d.commanders).filter((c) => !usableImage(cards.get(c.deId)) && cards.get(c.enId));
  console.log(`Suche andere deutsche Drucke für ${missing.length} Kommandanten …`);
  for (const c of missing) {
    const en = cards.get(c.enId);
    const oid = en.oracle_id || en.card_faces?.[0]?.oracle_id;
    if (!oid || otherDe.has(oid)) continue;
    const q = encodeURIComponent(`oracleid:${oid} lang:de game:paper`);
    const res = await getJSON(`${SCRYFALL}/cards/search?q=${q}&unique=prints&order=released&dir=desc`);
    otherDe.set(oid, (res?.data || []).find(usableImage) || null);
    await sleep(600);
  }

  for (const d of valid) {
    d.commanders = d.commanders.map(({ name, deName, enId, deId }) => {
      const en = cards.get(enId);
      const oid = en?.oracle_id || en?.card_faces?.[0]?.oracle_id;
      const de = usableImage(cards.get(deId)) ? cards.get(deId) : otherDe.get(oid);
      deName ||= de?.printed_name || de?.card_faces?.map((f) => f.printed_name).filter(Boolean).join(' // ') || null;
      const pick = usableImage(de) ? de : en;
      const img = imagesOf(pick);
      return {
        name,
        deName,
        german: pick === de,
        card: img?.normal || null,
        art: imagesOf(en)?.art_crop || img?.art_crop || null,
      };
    });
  }

  valid.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), decks: valid }));
  console.log(`Fertig: ${valid.length} Precons → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
