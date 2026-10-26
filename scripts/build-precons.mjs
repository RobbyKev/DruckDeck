// Erzeugt public/precons.json für die Übersicht „Alle Precons“.
// Läuft beim Bauen (GitHub Actions) bzw. lokal mit `npm run precons`.
//
// Enthält alle Decks von MTGJSON (Commander, Duel Decks, Jumpstart, Secret Lair …):
// Name, Art, Set, Datum, Farbidentität, Kartenzahl und die Titelkarte(n) –
// bei Commander-Decks die Kommandanten, sonst die auffälligste Karte – mit
// deutschem Namen und Bildern (ganze Karte + Artwork).
// Daten: MTGJSON AllDeckFiles (ein Paket statt ~3.000 Einzelabrufe), Scryfall (Bilder).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/precons.json');
const MTGJSON = 'https://mtgjson.com/api/v5';
const SCRYFALL = 'https://api.scryfall.com';
const HEADERS = { 'User-Agent': 'DruckDeck/0.1 (privates Proxy-Tool)', Accept: 'application/json' };
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const RARITY = { special: 5, mythic: 4, rare: 3, uncommon: 2, common: 1 };

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

// Alle Deck-Dateien als ein Paket laden und entpacken
async function downloadAllDecks() {
  const dir = mkdtempSync(join(tmpdir(), 'druckdeck-'));
  const archive = join(dir, 'AllDeckFiles.tar.xz');
  const res = await fetch(`${MTGJSON}/AllDeckFiles.tar.xz`, { headers: HEADERS });
  if (!res.ok) throw new Error(`AllDeckFiles: HTTP ${res.status}`);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xJf', archive, '-C', dir]);
  rmSync(archive);
  return { dir, folder: join(dir, 'AllDeckFiles') };
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
const oracleOf = (card) => card?.oracle_id || card?.card_faces?.[0]?.oracle_id;

// Titelkarte für Decks ohne Kommandant: seltenste Nicht-Land-Karte, Kreaturen bevorzugt
function faceCard(cards) {
  const score = (c) =>
    (RARITY[c.rarity] || 0) * 10 +
    (c.types?.includes('Creature') || c.types?.includes('Planeswalker') ? 3 : 0) -
    (c.types?.includes('Land') ? 20 : 0);
  return [...cards].sort((a, b) => score(b) - score(a))[0];
}

function titleCard(c) {
  const de = (c.foreignData || []).find((f) => f.language === 'German');
  return { name: c.name, deName: de?.name || null, enId: c.identifiers?.scryfallId, deId: de?.identifiers?.scryfallId };
}

async function main() {
  console.log('Lade Deckliste …');
  const list = (await getJSON(`${MTGJSON}/DeckList.json`)).data;
  const sets = await getJSON(`${SCRYFALL}/sets`);
  const setNames = Object.fromEntries((sets?.data || []).map((s) => [s.code.toUpperCase(), s.name]));

  console.log('Lade alle Decks von MTGJSON (ein Paket) …');
  const { dir, folder } = await downloadAllDecks();

  const decks = [];
  for (const d of list) {
    let deck;
    try {
      deck = JSON.parse(readFileSync(join(folder, `${d.fileName}.json`), 'utf8')).data;
    } catch {
      continue; // in der Liste, aber nicht im Paket
    }
    const commanders = deck.commander || [];
    const main = deck.mainBoard || [];
    const cards = [...commanders, ...main];
    if (!cards.length) continue;
    const colorSource = commanders.length ? commanders : main;
    const colors = new Set(colorSource.flatMap((c) => c.colorIdentity || []));
    const titles = commanders.length ? commanders : [faceCard(main)];
    decks.push({
      name: d.name,
      type: d.type,
      fileName: d.fileName,
      code: d.code,
      setName: setNames[d.code] || '',
      releaseDate: d.releaseDate || '',
      colors: COLOR_ORDER.filter((c) => colors.has(c)),
      count: cards.reduce((n, c) => n + (c.count || 1), 0),
      commanders: titles.filter(Boolean).map(titleCard),
      isCommander: commanders.length > 0,
    });
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`${decks.length} Decks gelesen.`);

  const ids = [...new Set(decks.flatMap((d) => d.commanders.flatMap((c) => [c.deId, c.enId]).filter(Boolean)))];
  console.log(`Lade Bilder für ${ids.length} Karten-Drucke von Scryfall …`);
  const cards = await scryfallCollection(ids);

  // Kommandanten ohne deutschen Druck im eigenen Set → anderen deutschen Druck suchen.
  // Nur für Commander-Decks, sonst wären es zu viele Suchen (Scryfall: 2/Sekunde).
  const otherDe = new Map();
  const missing = decks
    .filter((d) => d.isCommander)
    .flatMap((d) => d.commanders)
    .filter((c) => !usableImage(cards.get(c.deId)) && cards.get(c.enId));
  console.log(`Suche andere deutsche Drucke für ${missing.length} Kommandanten …`);
  for (const c of missing) {
    const oid = oracleOf(cards.get(c.enId));
    if (!oid || otherDe.has(oid)) continue;
    const q = encodeURIComponent(`oracleid:${oid} lang:de game:paper`);
    const res = await getJSON(`${SCRYFALL}/cards/search?q=${q}&unique=prints&order=released&dir=desc`);
    otherDe.set(oid, (res?.data || []).find(usableImage) || null);
    await sleep(600);
  }

  for (const d of decks) {
    delete d.isCommander;
    d.commanders = d.commanders.map(({ name, deName, enId, deId }) => {
      const en = cards.get(enId);
      const de = usableImage(cards.get(deId)) ? cards.get(deId) : otherDe.get(oracleOf(en));
      deName ||= de?.printed_name || de?.card_faces?.map((f) => f.printed_name).filter(Boolean).join(' // ') || null;
      const pick = usableImage(de) ? de : en;
      const img = imagesOf(pick);
      return {
        name,
        deName,
        german: Boolean(de) && pick === de,
        card: img?.normal || null,
        art: imagesOf(en)?.art_crop || img?.art_crop || null,
      };
    });
  }

  decks.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), decks }));
  console.log(`Fertig: ${decks.length} Decks → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
