// Commander-Precons von MTGJSON (CORS ist erlaubt, daher direkter Abruf).

import { getJSON, TTL } from './net.js';

const BASE = 'https://mtgjson.com/api/v5';

export async function loadPreconList() {
  const json = await getJSON(`${BASE}/DeckList.json`, { ttl: TTL.mtgjson, limited: false });
  return (json?.data || [])
    .filter((d) => d.type === 'Commander Deck')
    .map((d) => ({ name: d.name, code: d.code, fileName: d.fileName, releaseDate: d.releaseDate }))
    .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name));
}

// Kartenliste = commander + mainBoard. displayCommander, sideBoard, tokens werden ignoriert.
export async function loadPrecon(fileName) {
  const json = await getJSON(`${BASE}/decks/${encodeURIComponent(fileName)}.json`, {
    ttl: TTL.mtgjson,
    limited: false,
  });
  const deck = json?.data;
  if (!deck) throw new Error('Deck nicht gefunden');

  const merged = new Map();
  const add = (card, isCommander) => {
    const key = `${card.name}|${card.setCode}|${card.number}`;
    const prev = merged.get(key);
    if (prev) {
      prev.count += card.count || 1;
      prev.isCommander ||= isCommander;
    } else {
      const de = (card.foreignData || []).find((f) => f.language === 'German');
      merged.set(key, {
        // Deutscher Text aus MTGJSON als Reserve für die Übersetzungsseite
        foreign: de?.text ? { name: de.name || '', type: '', text: de.text } : null,
        name: card.name,
        count: card.count || 1,
        set: card.setCode?.toLowerCase() || null,
        number: card.number || null,
        isCommander,
      });
    }
  };
  (deck.commander || []).forEach((c) => add(c, true));
  (deck.mainBoard || []).forEach((c) => add(c, false));

  return { name: deck.name, code: deck.code, releaseDate: deck.releaseDate, entries: [...merged.values()] };
}
