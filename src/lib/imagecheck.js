// Erkennt, ob ein als „deutsch“ markiertes Scryfall-Bild wirklich deutsch ist.
// Vergleich: beide Bilder (Größe small) auf 146×204 px, Graustufen, nur der
// Textkasten (x 0–146, y 110–195). Mittlere absolute Pixeldifferenz > Schwelle
// → unterschiedlicher Text → wirklich deutsch.

import { getImageBlob } from './net.js';
import { getCachedJSON, putCachedJSON } from './cache.js';

export const DIFF_THRESHOLD = 4;

const W = 146;
const H = 204;
const BOX = { x: 0, y: 110, w: 146, h: 85 };

let canvas;
function ctx() {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
  }
  return canvas.getContext('2d', { willReadFrequently: true });
}

async function textboxGray(url) {
  const blob = await getImageBlob(url);
  const bmp = await createImageBitmap(blob);
  const c = ctx();
  c.clearRect(0, 0, W, H);
  c.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();
  const { data } = c.getImageData(BOX.x, BOX.y, BOX.w, BOX.h);
  const gray = new Float32Array(BOX.w * BOX.h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

// Liefert die mittlere Differenz (0–255). Ergebnis wird pro URL-Paar gecacht.
export async function textboxDiff(urlA, urlB) {
  if (urlA === urlB) return 0;
  const key = `diff:${urlA}|${urlB}`;
  const cached = await getCachedJSON(key);
  if (typeof cached === 'number') return cached;
  const [a, b] = await Promise.all([textboxGray(urlA), textboxGray(urlB)]);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  const diff = sum / a.length;
  await putCachedJSON(key, diff);
  return diff;
}
