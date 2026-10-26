// Decklisten im Moxfield-/Archidekt-Format einlesen.
// Beispiele:
//   1 Sol Ring (C21) 263
//   1x Sol Ring (c21) 263 *F* [Ramp]
//   Sol Ring
// Abschnittsüberschriften wie „Commander“ markieren den Kommandanten,
// „Sideboard“/„Maybeboard“/„Tokens“ beenden die Hauptliste.

const COMMANDER_HEADERS = /^(commander|commanders|kommandant(en)?)\s*:?\s*(\(\d+\))?$/i;
const IGNORE_HEADERS = /^(deck|main|mainboard|maindeck|companion|creatures?|kreaturen|lands?|länder|instants?|sorcer(y|ies)|artifacts?|enchantments?|planeswalkers?|battles?|other|spells?)\s*:?\s*(\(\d+\))?$/i;
const STOP_HEADERS = /^(sideboard|maybeboard|considering|tokens?)\s*:?\s*(\(\d+\))?$/i;

const LINE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([^\s\[*]+))?)?(?:\s+\*[A-Z]+\*)*(?:\s+\[[^\]]*\])*(?:\s+\^[^^]*\^)*\s*$/;

export function parseDecklist(text) {
  const entries = [];
  let section = 'main';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      // Leerzeile beendet den Kommandanten-Block
      if (section === 'commander') section = 'main';
      continue;
    }
    if (line.startsWith('//') || line.startsWith('#')) continue;
    if (COMMANDER_HEADERS.test(line)) { section = 'commander'; continue; }
    if (STOP_HEADERS.test(line)) { section = 'stop'; continue; }
    if (IGNORE_HEADERS.test(line)) { section = 'main'; continue; }
    if (section === 'stop') continue;

    const m = line.match(LINE);
    if (!m) continue;
    const [, count, name, set, number] = m;
    const isCommander = section === 'commander' || /\[[^\]]*commander[^\]]*\]/i.test(line);
    entries.push({
      name: name.trim(),
      count: count ? parseInt(count, 10) : 1,
      set: set ? set.toLowerCase() : null,
      number: set && number ? number : null,
      isCommander,
    });
  }

  // Gleiche Karten zusammenfassen
  const merged = new Map();
  for (const e of entries) {
    const key = `${e.name.toLowerCase()}|${e.set}|${e.number}`;
    const prev = merged.get(key);
    if (prev) {
      prev.count += e.count;
      prev.isCommander ||= e.isCommander;
    } else merged.set(key, e);
  }
  return [...merged.values()];
}
