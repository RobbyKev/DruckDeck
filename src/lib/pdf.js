// PDF-Erzeugung im Browser: A4 hochkant, 3×3 Karten à 63×88 mm, Schnittmarken,
// Checkliste auf Seite 1.

import { jsPDF } from 'jspdf';
import { getImageBlob } from './net.js';

const PAGE = { w: 210, h: 297 };
const CARD = { w: 63, h: 88 };
const COLS = 3;
const ROWS = 3;
const GRID = { w: CARD.w * COLS, h: CARD.h * ROWS };
const GX = (PAGE.w - GRID.w) / 2;
const GY = (PAGE.h - GRID.h) / 2;
const MARK = { from: 2, to: 8 };
const JPEG_QUALITY = 0.9;

// PNG (745×1040, transparente Ecken) → JPEG mit schwarzen Ecken
async function toJpeg(url) {
  const blob = await getImageBlob(url);
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const c = canvas.getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(bmp, 0, 0);
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

function cutMarks(doc) {
  doc.setDrawColor(160);
  doc.setLineWidth(0.2);
  for (let c = 0; c <= COLS; c++) {
    const x = GX + c * CARD.w;
    doc.line(x, GY - MARK.to, x, GY - MARK.from);
    doc.line(x, GY + GRID.h + MARK.from, x, GY + GRID.h + MARK.to);
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = GY + r * CARD.h;
    doc.line(GX - MARK.to, y, GX - MARK.from, y);
    doc.line(GX + GRID.w + MARK.from, y, GX + GRID.w + MARK.to, y);
  }
}

function checklist(doc, { deckName, total, lines, hasDoubleFaced }) {
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
  doc.text('Jede Karte misst 63 × 88 mm. Schnittmarken liegen außerhalb des Rasters.', M, y);
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
  let ny = PAGE.h - 17;
  if (hasDoubleFaced) {
    doc.text('* Doppelseitige Karte: Rückseite wird direkt hinter der Vorderseite gedruckt – beide in eine Hülle.', M, ny);
    ny += 4;
  }
  doc.setFont('helvetica', 'italic');
  doc.text('Nur für private Runden, nicht zum Verkauf.', M, ny);
}

// entries: sortierte, aufgelöste Einträge (siehe main.js)
// options: { includeLands, includeBacks }
export async function buildPdf({ deckName, entries, options, onProgress }) {
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
      images.set(url, await toJpeg(url));
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
  checklist(doc, { deckName, total, lines, hasDoubleFaced: printed.some(hasBack) });

  const placeSlots = (slots) => {
    for (let i = 0; i < slots.length; i++) {
      const pos = i % (COLS * ROWS);
      if (pos === 0) {
        doc.addPage();
        cutMarks(doc);
      }
      const x = GX + (pos % COLS) * CARD.w;
      const y = GY + Math.floor(pos / COLS) * CARD.h;
      doc.addImage(images.get(slots[i]), 'JPEG', x, y, CARD.w, CARD.h, slots[i], 'NONE');
    }
  };
  placeSlots(spellSlots);
  placeSlots(landSlots); // Länder auf eigenen Seiten am Ende

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
