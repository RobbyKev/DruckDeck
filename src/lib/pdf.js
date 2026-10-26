// PDF-Erzeugung im Browser: A4 hochkant, 3×3 Karten à 63×88 mm (wahlweise mit
// Abstand und Anschnitt), Schnittmarken, Checkliste auf Seite 1.

import { jsPDF } from 'jspdf';
import { getImageBlob } from './net.js';

const PAGE = { w: 210, h: 297 };
const CARD = { w: 63, h: 88 };
const COLS = 3;
const ROWS = 3;
const JPEG_QUALITY = 0.9;
const PRINTER_MARGIN = 3; // Schnittmarken nicht näher als 3 mm an den Blattrand

// Raster abhängig vom Abstand zwischen den Karten (mm). Bei Abstand bekommt jede
// Karte rundum einen Anschnitt von halbem Abstand, damit ein leicht versetzter
// Schnitt keinen weißen Rand zeigt.
function gridLayout(gap) {
  const bleed = gap / 2;
  const w = CARD.w * COLS + gap * (COLS - 1);
  const h = CARD.h * ROWS + gap * (ROWS - 1);
  const gx = (PAGE.w - w) / 2;
  const gy = (PAGE.h - h) / 2;
  const markFrom = Math.max(2, bleed + 1);
  return {
    gap, bleed, gx, gy, w, h,
    markFrom,
    markToX: Math.min(8, gx - PRINTER_MARGIN),
    markToY: Math.min(8, gy - PRINTER_MARGIN),
  };
}

// PNG (745×1040, transparente Ecken) → JPEG. Mit Anschnitt wird das Bild auf
// die Anschnittgröße gestreckt hinterlegt, sodass Rand und Ecken nach außen
// weiterlaufen; ohne Anschnitt bekommen die runden Ecken Schwarz.
async function toJpeg(url, bleedMm) {
  const blob = await getImageBlob(url);
  const bmp = await createImageBitmap(blob);
  const pad = Math.round((bleedMm * bmp.width) / CARD.w);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width + 2 * pad;
  canvas.height = bmp.height + 2 * pad;
  const c = canvas.getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, canvas.width, canvas.height);
  if (pad) c.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  c.drawImage(bmp, pad, pad);
  bmp.close?.();
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  return new Uint8Array(await jpeg.arrayBuffer());
}

function footer(doc, deckName, pageNo) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(140);
  doc.text(`${deckName} · Seite ${pageNo}`, PAGE.w / 2, PAGE.h - 4, { align: 'center' });
}

// Schnittmarken an jeder Kartenkante, außerhalb des Rasters
function cutMarks(doc, L) {
  doc.setDrawColor(160);
  doc.setLineWidth(0.2);
  const xs = new Set();
  const ys = new Set();
  for (let c = 0; c < COLS; c++) {
    const x = L.gx + c * (CARD.w + L.gap);
    xs.add(x).add(x + CARD.w);
  }
  for (let r = 0; r < ROWS; r++) {
    const y = L.gy + r * (CARD.h + L.gap);
    ys.add(y).add(y + CARD.h);
  }
  for (const x of xs) {
    doc.line(x, L.gy - L.markToY, x, L.gy - L.markFrom);
    doc.line(x, L.gy + L.h + L.markFrom, x, L.gy + L.h + L.markToY);
  }
  for (const y of ys) {
    doc.line(L.gx - L.markToX, y, L.gx - L.markFrom, y);
    doc.line(L.gx + L.w + L.markFrom, y, L.gx + L.w + L.markToX, y);
  }
}

function checklist(doc, { deckName, total, lines, hasDoubleFaced, gap, hasTranslations }) {
  const M = 16;
  let y = 22;
  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  const title = doc.splitTextToSize(`${deckName} – ${total} Karten, deutsch`, PAGE.w - 2 * M);
  doc.text(title, M, y);
  y += title.length * 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(70);
  doc.text('Druckhinweis: A4 hochkant, Skalierung 100 % / „Tatsächliche Größe“ (nicht „An Seite anpassen“).', M, y);
  y += 4.5;
  doc.text(
    gap
      ? `Jede Karte misst 63 × 88 mm, mit ${String(gap).replace('.', ',')} mm Abstand und Anschnitt – entlang der Schnittmarken schneiden.`
      : 'Jede Karte misst 63 × 88 mm. Schnittmarken liegen außerhalb des Rasters.',
    M,
    y,
  );
  y += 7;

  const bottom = PAGE.h - 24;
  const colGap = 8;
  const colW = (PAGE.w - 2 * M - colGap) / 2;
  // Schriftgröße aus der Zeilenzahl ableiten; überlange Namen werden umbrochen.
  const layout = (fontSize) => {
    const lineH = fontSize * 0.5;
    const box = Math.min(3, lineH * 0.6);
    const maxW = colW - box - 2;
    const rows = lines.map((line) => {
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      return doc.splitTextToSize(line.text, maxW);
    });
    const total = rows.reduce((n, r) => n + r.length, 0);
    return { fontSize, lineH, box, rows, total };
  };
  let L = layout(10);
  while (L.fontSize > 7.2 && Math.ceil(L.total / 2) * L.lineH > bottom - y) L = layout(L.fontSize - 0.2);
  const { fontSize, lineH, box, rows } = L;

  let col = 0;
  let rowY = y;
  doc.setTextColor(20);
  doc.setDrawColor(90);
  doc.setLineWidth(0.25);
  lines.forEach((line, i) => {
    const text = rows[i];
    if (rowY + lineH * text.length > bottom) {
      if (col === 0) {
        col = 1;
        rowY = y;
      } else {
        doc.addPage();
        col = 0;
        rowY = y = 20;
      }
    }
    const x = M + col * (colW + colGap);
    doc.rect(x, rowY + (lineH - box) / 2 - 0.2, box, box);
    doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    text.forEach((t, j) => doc.text(t, x + box + 1.8 + (j ? 3 : 0), rowY + lineH * j + lineH / 2 + fontSize * 0.12));
    rowY += lineH * text.length;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90);
  const notes = [];
  if (hasDoubleFaced) notes.push('* Doppelseitige Karte: Rückseite wird direkt hinter der Vorderseite gedruckt – beide in eine Hülle.');
  if (hasTranslations) notes.push('(EN) = nur englisches Bild verfügbar – deutsche Übersetzung zum Ausschneiden auf den letzten Seiten.');
  let ny = PAGE.h - 13 - 4 * notes.length;
  for (const note of notes) {
    doc.text(note, M, ny);
    ny += 4;
  }
  doc.setFont('helvetica', 'italic');
  doc.text('Nur für private Runden, nicht zum Verkauf.', M, ny);
}

// Die Standardschrift im PDF kennt nur den Windows-1252-Zeichensatz – andere
// Zeichen aus Scryfall-Texten ersetzen, damit nichts als Zeichensalat erscheint.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function winAnsi(s) {
  return String(s || '')
    .replace(/[\u2212\u2011\u2010]/g, '-')
    .replace(/\u2022/g, '•')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, (ch) => (WIN_ANSI_EXTRA.includes(ch) ? ch : '?'));
}

// Übersetzungs-Zettel in Kartengröße: deutscher Name, Typzeile und Regeltext.
// Die Schrift wird verkleinert, bis der Text in die Karte passt.
function drawTranslation(doc, x, y, t, englishName) {
  const pad = 3.5;
  const w = CARD.w - 2 * pad;
  const footerH = 4;
  const lh = (fs) => fs * 0.3528 * 1.22;
  const layout = (fs) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fs + 1.5);
    const name = doc.splitTextToSize(winAnsi(t.name || englishName), w);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(fs - 0.5);
    const type = t.type ? doc.splitTextToSize(winAnsi(t.type), w) : [];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fs);
    const text = winAnsi(t.text)
      .split('\n')
      .flatMap((p) => (p.trim() ? doc.splitTextToSize(p, w) : ['']));
    const height = name.length * lh(fs + 1.5) + 1.5 + type.length * lh(fs - 0.5) + 2.5 + text.length * lh(fs);
    return { fs, name, type, text, height };
  };
  let L = layout(8.5);
  while (L.fs > 5 && L.height > CARD.h - 2 * pad - footerH) L = layout(L.fs - 0.25);

  doc.setDrawColor(170);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, CARD.w, CARD.h, 3, 3, 'S');
  doc.setTextColor(20);
  let cy = y + pad + lh(L.fs + 1.5) * 0.8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(L.fs + 1.5);
  for (const line of L.name) {
    doc.text(line, x + pad, cy);
    cy += lh(L.fs + 1.5);
  }
  cy += 0.5;
  if (L.type.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(L.fs - 0.5);
    doc.setTextColor(70);
    for (const line of L.type) {
      doc.text(line, x + pad, cy);
      cy += lh(L.fs - 0.5);
    }
  }
  doc.setDrawColor(200);
  doc.line(x + pad, cy - lh(L.fs) * 0.45, x + CARD.w - pad, cy - lh(L.fs) * 0.45);
  cy += 1.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(L.fs);
  doc.setTextColor(20);
  for (const line of L.text) {
    if (line) doc.text(line, x + pad, cy);
    cy += lh(L.fs);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(130);
  doc.text(winAnsi(`Übersetzung · ${englishName}`), x + pad, y + CARD.h - 2.5, { maxWidth: w });
}

// entries: sortierte, aufgelöste Einträge (siehe main.js)
// options: { includeLands, includeBacks, gap, includeTranslations }
export async function buildPdf({ deckName, entries, options, onProgress }) {
  const L = gridLayout(options.gap || 0);
  const printed = entries.filter((e) => e.res?.chosen && (options.includeLands || !e.basic));
  const spells = printed.filter((e) => !e.basic);
  const lands = printed.filter((e) => e.basic);

  const slotsFor = (list) => {
    const slots = [];
    for (const e of list) {
      const faces = e.faces;
      for (let i = 0; i < e.count; i++) {
        slots.push(faces[0].png);
        if (options.includeBacks && faces.length > 1) slots.push(faces[1].png);
      }
    }
    return slots;
  };
  const spellSlots = slotsFor(spells);
  const landSlots = slotsFor(lands);

  // Bilder laden und umwandeln (jede URL nur einmal)
  const urls = [...new Set([...spellSlots, ...landSlots])];
  const images = new Map();
  const totalImages = urls.length;
  let done = 0;
  onProgress?.(0, totalImages);
  const workers = Array.from({ length: 4 }, async () => {
    while (urls.length) {
      const url = urls.shift();
      images.set(url, await toJpeg(url, L.bleed));
      onProgress?.(++done, totalImages);
    }
  });
  await Promise.all(workers);

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: `${deckName} – Proxys (DE)`, creator: 'DruckDeck' });

  const hasBack = (e) => options.includeBacks && e.faces.length > 1;
  // Gleichnamige Karten (z. B. Standardländer aus verschiedenen Drucken) zusammenfassen
  const grouped = new Map();
  for (const e of [...spells, ...lands]) {
    const key = `${e.isCommander}|${e.displayName}`;
    const g = grouped.get(key);
    if (g) {
      g.count += e.count;
      g.english ||= e.res.status === 'english';
      g.back ||= hasBack(e);
    } else {
      grouped.set(key, {
        name: e.displayName, count: e.count, isCommander: e.isCommander,
        english: e.res.status === 'english', back: hasBack(e),
      });
    }
  }
  const lines = [...grouped.values()].map((g) => ({
    text: `${g.count}x ${g.isCommander ? 'Kommandant: ' : ''}${g.name}${g.back ? '*' : ''}${g.english ? ' (EN)' : ''}`,
    bold: g.isCommander,
  }));
  const total = printed.reduce((n, e) => n + e.count, 0);
  // Englische Karten mit deutschem Text bekommen je Exemplar einen Übersetzungs-Zettel
  const translations = options.includeTranslations
    ? printed
        .filter((e) => e.res.status === 'english' && (e.translation?.text || e.translation?.name))
        .flatMap((e) => Array.from({ length: e.count }, () => e))
    : [];
  checklist(doc, {
    deckName, total, lines, hasDoubleFaced: printed.some(hasBack), gap: L.gap, hasTranslations: translations.length > 0,
  });

  const placeSlots = (slots) => {
    for (let i = 0; i < slots.length; i++) {
      const pos = i % (COLS * ROWS);
      if (pos === 0) {
        doc.addPage();
        cutMarks(doc, L);
      }
      const x = L.gx + (pos % COLS) * (CARD.w + L.gap) - L.bleed;
      const y = L.gy + Math.floor(pos / COLS) * (CARD.h + L.gap) - L.bleed;
      const w = CARD.w + 2 * L.bleed;
      const h = CARD.h + 2 * L.bleed;
      doc.addImage(images.get(slots[i]), 'JPEG', x, y, w, h, slots[i], 'NONE');
    }
  };
  placeSlots(spellSlots);
  placeSlots(landSlots); // Länder auf eigenen Seiten am Ende

  // Übersetzungen auf eigenen Seiten ganz am Ende (gleiches Raster, ohne Anschnitt)
  translations.forEach((e, i) => {
    const pos = i % (COLS * ROWS);
    if (pos === 0) {
      doc.addPage();
      cutMarks(doc, L);
    }
    const x = L.gx + (pos % COLS) * (CARD.w + L.gap);
    const y = L.gy + Math.floor(pos / COLS) * (CARD.h + L.gap);
    drawTranslation(doc, x, y, e.translation, e.res.chosen.name);
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    footer(doc, deckName, p);
  }

  return { blob: doc.output('blob'), pages, cards: spellSlots.length + landSlots.length };
}

export function pdfFileName(deckName) {
  const safe = deckName
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .trim();
  return `${safe || 'Deck'}_Proxys_DE.pdf`;
}
