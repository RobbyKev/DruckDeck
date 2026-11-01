// Export für Druckereien: jede Karte einzeln mit 3 mm Anschnitt bei 300 dpi.
// Maße wie bei MakePlayingCards (Pokergröße 63,5 × 88,9 mm):
// 822 × 1122 Pixel inklusive Anschnitt, die Karte selbst 750 × 1050 Pixel.
//
// Zwei Formate: ein PDF mit einer Karte pro Seite oder ein ZIP mit Einzelbildern.

import { jsPDF } from 'jspdf';
import { getImageBlob } from './net.js';
import { makeZip } from './zip.js';

const DPI = 300;
const CARD_PX = { w: 750, h: 1050 };
const BLEED_PX = 36;
const FULL_PX = { w: CARD_PX.w + 2 * BLEED_PX, h: CARD_PX.h + 2 * BLEED_PX };
const PX_PER_MM = DPI / 25.4;
const PAGE_MM = { w: FULL_PX.w / PX_PER_MM, h: FULL_PX.h / PX_PER_MM };
const JPEG_QUALITY = 0.95;

function newCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = FULL_PX.w;
  canvas.height = FULL_PX.h;
  return canvas;
}

// JPEG mit 300 dpi im Dateikopf – manche Druckereien prüfen diese Angabe
async function canvasToJpeg(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // JFIF-Kopf: FFD8 FFE0 … "JFIF\0", ab Byte 13 Einheit (1 = dpi) und Dichte x/y
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.slice(6, 10)) === 'JFIF') {
    bytes[13] = 1;
    bytes[14] = DPI >> 8;
    bytes[15] = DPI & 0xff;
    bytes[16] = DPI >> 8;
    bytes[17] = DPI & 0xff;
  }
  return bytes;
}

// Kartenbild mit gespiegeltem Anschnitt: Die Ränder des Bildes werden nach außen
// gespiegelt, so laufen auch randlose Artworks sauber weiter. Vorher werden die
// transparenten runden Ecken mit der Randfarbe gefüllt.
async function cardImage(url) {
  const bmp = await createImageBitmap(await getImageBlob(url));
  const src = document.createElement('canvas');
  src.width = bmp.width;
  src.height = bmp.height;
  const s = src.getContext('2d', { willReadFrequently: true });
  s.drawImage(bmp, 0, 0);
  bmp.close?.();
  // Jede Ecke mit der Farbe knapp innerhalb der Rundung füllen (schwarzer Rand
  // oder bei randlosen Karten die Farbe des Artworks an dieser Stelle)
  const R = Math.round(src.width * 0.05); // etwas größer als der Eckradius
  const at = Math.round(R * 0.6);
  // Halbtransparente Kantenpixel werden ebenfalls ersetzt, sonst bleibt ein dunkler Bogen.
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const x = cx ? src.width - R : 0;
    const y = cy ? src.height - R : 0;
    const [r, g, b] = s.getImageData(cx ? src.width - 1 - at : at, cy ? src.height - 1 - at : at, 1, 1).data;
    const img = s.getImageData(x, y, R, R);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 250) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
    s.putImageData(img, x, y);
  }

  const canvas = newCanvas();
  const c = canvas.getContext('2d');
  const B = BLEED_PX;
  const { w: W, h: H } = CARD_PX;
  const bx = (B * src.width) / W; // Anschnittbreite im Quellbild
  const by = (B * src.height) / H;
  const right = src.width - bx;
  const bottom = src.height - by;

  // Gespiegelte Stücke: Quelle [x, y, w, h], Ziel [x, y, w, h], Spiegelung x/y
  const pieces = [
    [[0, 0, bx, src.height], [0, B, B, H], true, false],
    [[right, 0, bx, src.height], [B + W, B, B, H], true, false],
    [[0, 0, src.width, by], [B, 0, W, B], false, true],
    [[0, bottom, src.width, by], [B, B + H, W, B], false, true],
    [[0, 0, bx, by], [0, 0, B, B], true, true],
    [[right, 0, bx, by], [B + W, 0, B, B], true, true],
    [[0, bottom, bx, by], [0, B + H, B, B], true, true],
    [[right, bottom, bx, by], [B + W, B + H, B, B], true, true],
  ];
  for (const [[qx, qy, qw, qh], [zx, zy, zw, zh], fx, fy] of pieces) {
    c.save();
    c.translate(zx + (fx ? zw : 0), zy + (fy ? zh : 0));
    c.scale(fx ? -1 : 1, fy ? -1 : 1);
    c.drawImage(src, qx, qy, qw, qh, 0, 0, zw, zh);
    c.restore();
  }

  c.drawImage(src, B, B, W, H);
  return canvasToJpeg(canvas);
}

// Zeilenumbruch nach Breite
function wrap(c, text, maxW) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && c.measureText(test).width > maxW) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

// Übersetzungs-Zettel als Kartenbild: weiß, deutscher Name, Typzeile, Regeltext.
function translationImage(t, englishName) {
  const canvas = newCanvas();
  const c = canvas.getContext('2d');
  const B = BLEED_PX;
  const pad = 3.5 * PX_PER_MM;
  const x0 = B + pad;
  const maxW = CARD_PX.w - 2 * pad;
  const footerH = 5 * PX_PER_MM;
  const font = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const pt = (n) => n * 0.3528 * PX_PER_MM; // Punkt → Pixel

  const layout = (fs) => {
    const size = { name: pt(fs + 1.5), type: pt(fs - 0.5), text: pt(fs) };
    c.font = `bold ${size.name}px ${font}`;
    const name = wrap(c, t.name || englishName, maxW);
    c.font = `italic ${size.type}px ${font}`;
    const type = t.type ? wrap(c, t.type, maxW) : [];
    c.font = `${size.text}px ${font}`;
    const text = wrap(c, t.text, maxW);
    const height = 1.22 * (name.length * size.name + type.length * size.type + text.length * size.text) + pt(fs) * 1.5;
    return { size, name, type, text, height };
  };
  let L = layout(9);
  while (L.height > CARD_PX.h - 2 * pad - footerH && L.size.text > pt(5)) {
    L = layout(L.size.text / pt(1) - 0.25);
  }

  c.fillStyle = '#fff';
  c.fillRect(0, 0, FULL_PX.w, FULL_PX.h);
  c.strokeStyle = '#aaa';
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(B + 1.5, B + 1.5, CARD_PX.w - 3, CARD_PX.h - 3, 3 * PX_PER_MM);
  c.stroke();

  c.textBaseline = 'alphabetic';
  let y = B + pad;
  const draw = (lines, size, style, color) => {
    c.font = `${style} ${size}px ${font}`;
    c.fillStyle = color;
    for (const line of lines) {
      y += size * 1.22;
      if (line) c.fillText(line, x0, y - size * 0.22);
    }
  };
  draw(L.name, L.size.name, 'bold', '#141414');
  if (L.type.length) {
    y += L.size.text * 0.2;
    draw(L.type, L.size.type, 'italic', '#464646');
  }
  y += L.size.text * 0.45;
  c.strokeStyle = '#c8c8c8';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x0, y);
  c.lineTo(x0 + maxW, y);
  c.stroke();
  y += L.size.text * 0.3;
  draw(L.text, L.size.text, '', '#141414');

  c.font = `${pt(6)}px ${font}`;
  c.fillStyle = '#828282';
  c.fillText(`Übersetzung · ${englishName}`, x0, B + CARD_PX.h - pad * 0.8, maxW);
  return canvasToJpeg(canvas);
}

// Dateinamen ohne Umlaute und Sonderzeichen – manche Druckerei-Uploads mögen das nicht
function safeName(s) {
  return String(s)
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'Karte';
}

// Druckliste: ein Eintrag pro gedruckter Karte (pro Exemplar), Rückseite direkt dahinter.
function buildItems(entries, options) {
  const printed = entries.filter((e) => e.res?.chosen && (options.includeLands || !e.basic));
  const ordered = [...printed.filter((e) => !e.basic), ...printed.filter((e) => e.basic)];
  const items = [];
  let n = 0;
  for (const e of ordered) {
    const back = options.includeBacks && e.faces.length > 1;
    const label = `${e.isCommander ? 'Kommandant_' : ''}${safeName(e.displayName)}`;
    for (let i = 0; i < e.count; i++) {
      const num = String(++n).padStart(3, '0');
      if (back) {
        items.push({ file: `${num}a_${label}_Vorderseite.jpg`, url: e.faces[0].png });
        items.push({ file: `${num}b_${label}_Rueckseite.jpg`, url: e.faces[1].png });
      } else {
        items.push({ file: `${num}_${label}.jpg`, url: e.faces[0].png });
      }
    }
  }
  if (options.includeTranslations) {
    let t = 0;
    for (const e of printed) {
      if (e.res.status !== 'english' || !(e.translation?.text || e.translation?.name)) continue;
      for (let i = 0; i < e.count; i++) {
        items.push({
          file: `U${String(++t).padStart(2, '0')}_Uebersetzung_${safeName(e.res.chosen.name)}.jpg`,
          translation: e.translation,
          englishName: e.res.chosen.name,
        });
      }
    }
  }
  return { items, cards: n };
}

// Bilder erzeugen; jedes Kartenbild nur einmal, auch wenn es mehrfach vorkommt
async function renderItems(items, onProgress) {
  const byUrl = new Map();
  const jobs = [];
  for (const it of items) {
    if (it.url) {
      if (!byUrl.has(it.url)) {
        byUrl.set(it.url, null);
        jobs.push(async () => byUrl.set(it.url, await cardImage(it.url)));
      }
    } else {
      jobs.push(async () => (it.data = await translationImage(it.translation, it.englishName)));
    }
  }
  const total = jobs.length;
  let done = 0;
  onProgress?.(0, total);
  const workers = Array.from({ length: 4 }, async () => {
    while (jobs.length) {
      await jobs.shift()();
      onProgress?.(++done, total);
    }
  });
  await Promise.all(workers);
  for (const it of items) if (it.url) it.data = byUrl.get(it.url);
}

function readme(deckName, items, cards) {
  const lines = [
    `${deckName} – Druckdateien von DruckDeck`,
    '',
    `${cards} Karten, ${items.length} Bilddateien.`,
    'Jedes Bild: 822 × 1122 Pixel bei 300 dpi = 69,6 × 95,0 mm',
    'inklusive 3 mm Anschnitt rundum; die Karte selbst ist 63,5 × 88,9 mm (Pokergröße).',
    '',
    'Dateien mit „a_…_Vorderseite“ und „b_…_Rueckseite“ gehören auf eine doppelseitige Karte.',
    'Dateien mit „U…_Uebersetzung“ sind deutsche Übersetzungen englischer Karten.',
    'Für alle anderen Karten eine einheitliche Rückseite bei der Druckerei wählen.',
    '',
    'Nur für private Runden, nicht zum Verkauf.',
  ];
  return new TextEncoder().encode(lines.join('\r\n'));
}

// format: 'zip' (Einzelbilder) oder 'pdf' (eine Karte pro Seite)
export async function buildPrintShop({ deckName, entries, options, format, onProgress }) {
  const { items, cards } = buildItems(entries, options);
  await renderItems(items, onProgress);

  if (format === 'zip') {
    const files = items.map((it) => ({ name: it.file, data: it.data }));
    files.push({ name: 'LIESMICH.txt', data: readme(deckName, items, cards) });
    return { blob: makeZip(files), cards, files: items.length };
  }

  const doc = new jsPDF({ unit: 'mm', format: [PAGE_MM.w, PAGE_MM.h], orientation: 'portrait', compress: true });
  doc.setProperties({ title: `${deckName} – Druckdatei`, creator: 'DruckDeck' });
  items.forEach((it, i) => {
    if (i) doc.addPage([PAGE_MM.w, PAGE_MM.h], 'portrait');
    doc.addImage(it.data, 'JPEG', 0, 0, PAGE_MM.w, PAGE_MM.h, it.url || `t${i}`, 'NONE');
  });
  return { blob: doc.output('blob'), cards, pages: items.length };
}

export function printShopFileName(deckName, format) {
  const safe = deckName.normalize('NFC').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').trim();
  return `${safe || 'Deck'}_Druckerei.${format === 'zip' ? 'zip' : 'pdf'}`;
}
