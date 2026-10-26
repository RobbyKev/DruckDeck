import '@fontsource/unifrakturmaguntia/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import './style.css';

import { loadPreconList, loadPrecon } from './lib/mtgjson.js';
import { parseDecklist } from './lib/parse.js';
import { getJSON, TTL, onThrottle } from './lib/net.js';
import { clearCache } from './lib/cache.js';
import {
  resolveEntry, verifyGerman, germanPrints, statusFor, oracleId,
  faceImages, germanName, germanFaceNames, isBasicLand, STATUS,
} from './lib/scryfall.js';
import { buildPdf, pdfFileName } from './lib/pdf.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  deckName: '',
  entries: [],
  options: { includeLands: true, includeBacks: true, gap: 2 },
  runId: 0,
};

const BADGE = {
  [STATUS.original]: (e) =>
    e.res.explicitPrint ? 'deutsch, Original-Druck' : `deutsch (${e.res.chosen.set.toUpperCase()})`,
  [STATUS.other]: (e) => `deutsch, anderer Druck (${e.res.chosen.set.toUpperCase()})`,
  [STATUS.english]: () => 'nur Englisch verfügbar',
  [STATUS.missing]: (e) => (e.res?.failed ? 'Laden fehlgeschlagen' : 'nicht gefunden'),
};

// ---------- Abgeleitete Kartendaten ----------

function refresh(e) {
  const card = e.res?.chosen;
  e.basic = isBasicLand(e.res?.base || card);
  e.faces = card ? faceImages(card) : [];
  const de = card ? germanName(card) : null;
  e.nameMissing = Boolean(card && card.lang === 'de' && !de && !e.nameOverride);
  // Fehlt ein Teil des deutschen Namens, die vorhandenen deutschen Teile trotzdem nutzen
  const faceNames = card?.card_faces ? germanFaceNames(card) : [];
  const partial = faceNames.some(Boolean)
    ? card.card_faces.map((f, i) => faceNames[i] || f.name).join(' // ')
    : null;
  e.displayName = e.nameOverride || de || (card?.lang === 'de' && partial) || card?.name || e.name;
}

function sortedEntries() {
  const rank = (e) => (e.isCommander ? 0 : e.basic ? 2 : 1);
  return [...state.entries].sort(
    (a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName, 'de', { sensitivity: 'base' }),
  );
}

// ---------- Tabs ----------

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab);
    });
    document.querySelectorAll('.tab-body').forEach((b) => (b.hidden = b.dataset.body !== tab.dataset.tab));
  }),
);

// ---------- Precon-Suche ----------

let precons = [];
let setNames = {};
let activeSuggestion = -1;
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function initPrecons() {
  const status = $('#precon-status');
  try {
    const [list, sets] = await Promise.all([
      loadPreconList(),
      getJSON('https://api.scryfall.com/sets', { ttl: TTL.mtgjson }).catch(() => null),
    ]);
    for (const s of sets?.data || []) setNames[s.code.toUpperCase()] = s.name;
    precons = list.map((p) => ({ ...p, setName: setNames[p.code] || '', hay: norm(`${p.name} ${p.code} ${setNames[p.code] || ''}`) }));
    status.textContent = `${precons.length} Commander-Precons verfügbar.`;
  } catch (err) {
    status.textContent = `Precon-Liste konnte nicht geladen werden: ${err.message}`;
  }
}

function showSuggestions() {
  const input = $('#precon-search');
  const list = $('#precon-suggestions');
  const q = norm(input.value.trim());
  if (!q) {
    list.hidden = true;
    return;
  }
  const words = q.split(/\s+/);
  const hits = precons
    .filter((p) => words.every((w) => p.hay.includes(w)))
    .sort((a, b) => Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)))
    .slice(0, 15);
  activeSuggestion = -1;
  list.innerHTML = hits.length
    ? hits
        .map(
          (p) => `<li role="option" data-file="${esc(p.fileName)}">
            <span>${esc(p.name)}</span>
            <span class="meta">${esc(p.setName || p.code)} · ${esc((p.releaseDate || '').slice(0, 4))}</span>
          </li>`,
        )
        .join('')
    : '<li class="meta">Kein Precon gefunden</li>';
  list.hidden = false;
}

$('#precon-search').addEventListener('input', showSuggestions);
$('#precon-search').addEventListener('focus', showSuggestions);
$('#precon-search').addEventListener('keydown', (ev) => {
  const items = [...document.querySelectorAll('#precon-suggestions li[data-file]')];
  if (!items.length) return;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    activeSuggestion = (activeSuggestion + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle('active', i === activeSuggestion));
    items[activeSuggestion].scrollIntoView({ block: 'nearest' });
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    pickPrecon(items[Math.max(activeSuggestion, 0)].dataset.file);
  } else if (ev.key === 'Escape') {
    $('#precon-suggestions').hidden = true;
  }
});
$('#precon-suggestions').addEventListener('pointerdown', (ev) => {
  const li = ev.target.closest('li[data-file]');
  if (li) {
    ev.preventDefault();
    pickPrecon(li.dataset.file);
  }
});
document.addEventListener('pointerdown', (ev) => {
  if (!ev.target.closest('.combo')) $('#precon-suggestions').hidden = true;
});

async function pickPrecon(fileName) {
  $('#precon-suggestions').hidden = true;
  const p = precons.find((x) => x.fileName === fileName);
  if (p) $('#precon-search').value = p.name;
  try {
    const deck = await loadPrecon(fileName);
    await loadDeck(deck.name, deck.entries);
  } catch (err) {
    alert(`Deck konnte nicht geladen werden: ${err.message}`);
  }
}

// ---------- Liste einfügen ----------

$('#list-load').addEventListener('click', () => {
  const entries = parseDecklist($('#list-text').value);
  if (!entries.length) {
    alert('Keine Karten in der Liste gefunden.');
    return;
  }
  loadDeck($('#list-name').value.trim() || 'Mein Deck', entries);
});

// ---------- Auflösen ----------

function setProgress(done, total, label) {
  $('#progress-panel').hidden = false;
  $('#progress-label').textContent = label;
  $('#progress-bar').style.width = `${total ? (100 * done) / total : 0}%`;
}

// Hinweis im Fortschrittsbalken, solange Scryfall uns pausieren lässt
let throttleTimer = null;
onThrottle((until) => {
  clearInterval(throttleTimer);
  const tick = () => {
    const secs = Math.ceil((until - Date.now()) / 1000);
    if (secs <= 0 || $('#progress-panel').hidden) return clearInterval(throttleTimer);
    $('#progress-label').textContent = `Scryfall bremst gerade – kurze Pause, weiter in ${secs} s …`;
  };
  tick();
  throttleTimer = setInterval(tick, 1000);
});

async function resolveAll(entries, runId) {
  const total = entries.reduce((n, e) => n + e.count, 0);
  let done = 0;
  setProgress(0, total, `Karte 0 von ${total} …`);

  const queue = [...entries];
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift();
      try {
        e.res = await resolveEntry(e);
      } catch (err) {
        e.res = { status: STATUS.missing, chosen: null, base: null, failed: true, note: `${err.message} – bitte erneut versuchen` };
      }
      if (runId !== state.runId) return;
      refresh(e);
      done += e.count;
      setProgress(done, total, `Karte ${done} von ${total} … ${e.displayName}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (runId !== state.runId) return false;
  clearInterval(throttleTimer);
  $('#progress-panel').hidden = true;
  return true;
}

async function loadDeck(name, rawEntries) {
  const runId = ++state.runId;
  state.deckName = name;
  state.entries = rawEntries.map((e, i) => ({ ...e, id: i, res: null, nameOverride: '' }));
  state.entries.forEach(refresh);
  $('#review-panel').hidden = true;

  if (!(await resolveAll(state.entries, runId))) return;
  render();
  $('#review-panel').hidden = false;
  $('#review-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Karten, deren Laden wegen Netzwerkproblemen fehlgeschlagen ist, erneut auflösen
async function retryFailed() {
  const failed = state.entries.filter((e) => e.res?.failed);
  if (!failed.length) return;
  $('#retry-btn').disabled = true;
  try {
    if (await resolveAll(failed, state.runId)) render();
  } finally {
    $('#retry-btn').disabled = false;
  }
}
$('#retry-btn').addEventListener('click', retryFailed);

// ---------- Vorschau ----------

function summaryHtml() {
  const c = { total: 0, original: 0, other: 0, english: 0, missing: 0, names: 0 };
  for (const e of state.entries) {
    c.total += e.count;
    c[e.res?.status || 'missing'] += e.count;
    if (e.nameMissing) c.names += 1;
  }
  const parts = [
    `<b>${c.total} Karten</b>`,
    `${c.original} deutsch Original`,
    `${c.other} anderer Druck`,
    `<span class="${c.english ? 'bad' : ''}">${c.english} Englisch</span>`,
  ];
  const failed = state.entries.filter((e) => e.res?.failed).reduce((n, e) => n + e.count, 0);
  if (failed) parts.push(`<span class="bad">${failed} Laden fehlgeschlagen</span>`);
  if (c.missing - failed) parts.push(`<span class="bad">${c.missing - failed} nicht gefunden</span>`);
  if (c.names) parts.push(`<span class="warn">${c.names} ${c.names === 1 ? 'Name fehlt' : 'Namen fehlen'}</span>`);
  return parts.join(' · ');
}

function cardHtml(e) {
  const img = e.faces[0]?.normal;
  const status = e.res?.status || STATUS.missing;
  const dim = e.basic && !state.options.includeLands;
  return `<article class="card${dim ? ' dim' : ''}" data-id="${e.id}">
    <button class="thumb" data-open="${e.id}" aria-label="${esc(e.displayName)}: Drucke anzeigen">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" />` : ''}
      ${e.isCommander ? '<span class="crown">Kommandant</span>' : ''}
      ${e.count > 1 ? `<span class="count">${e.count}×</span>` : ''}
      ${e.faces.length > 1 ? '<span class="dfc">⟲ 2 Seiten</span>' : ''}
    </button>
    <input class="name-input${e.nameMissing ? ' missing' : ''}" type="text" data-name="${e.id}"
           value="${esc(e.displayName)}" aria-label="Deutscher Name" />
    <span class="badge ${status}">${esc(BADGE[status](e))}</span>
    ${e.nameMissing ? '<p class="note">Deutscher Name fehlt bei Scryfall – bitte selbst eintragen.</p>' : ''}
    ${status === STATUS.missing && e.res?.note ? `<p class="note">${esc(e.name)}: ${esc(e.res.note)}</p>` : ''}
  </article>`;
}

function render() {
  $('#deck-title').textContent = state.deckName;
  const failed = state.entries.filter((e) => e.res?.failed).length;
  $('#retry-btn').hidden = !failed;
  $('#retry-btn').textContent = `${failed} fehlgeschlagene erneut laden`;
  $('#summary').innerHTML = summaryHtml();
  $('#card-grid').innerHTML = sortedEntries().map(cardHtml).join('');
}

const byId = (id) => state.entries.find((e) => e.id === Number(id));

$('#card-grid').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-open]');
  if (btn) openDialog(byId(btn.dataset.open));
});
$('#card-grid').addEventListener('change', (ev) => {
  const input = ev.target.closest('[data-name]');
  if (!input) return;
  const e = byId(input.dataset.name);
  e.nameOverride = input.value.trim();
  refresh(e);
  render();
});

$('#opt-lands').addEventListener('change', (ev) => {
  state.options.includeLands = ev.target.checked;
  render();
});
$('#opt-backs').addEventListener('change', (ev) => {
  state.options.includeBacks = ev.target.checked;
});

// Abstand zum Schneiden (mm), im Browser gemerkt
try {
  const saved = localStorage.getItem('druckdeck.gap');
  if (saved !== null) state.options.gap = Number(saved);
} catch {}
$('#opt-gap').value = String(state.options.gap);
$('#opt-gap').addEventListener('change', (ev) => {
  state.options.gap = Number(ev.target.value);
  try {
    localStorage.setItem('druckdeck.gap', ev.target.value);
  } catch {}
});

// ---------- Dialog: Alternativen ----------

const dialog = $('#card-dialog');
const isOpenFor = (e) => dialog.open && dialog.dataset.entry === String(e.id);

function chooseCard(e, card) {
  const check = e.res.checks?.[card.id];
  e.res.chosen = card;
  e.res.status = check && !check.ok ? STATUS.english : statusFor(e.res, card);
  refresh(e);
}

async function openDialog(e) {
  if (!e?.res?.base) return;
  dialog.dataset.entry = e.id;
  renderDialog(e);
  dialog.showModal();

  if (!e.res.prints) {
    e.res.prints = await germanPrints(oracleId(e.res.base)).catch(() => []);
    if (isOpenFor(e)) renderDialog(e);
  }
  e.res.checks ||= {};
  for (const card of e.res.prints) {
    if (!isOpenFor(e)) return;
    if (e.res.checks[card.id]) continue;
    e.res.checks[card.id] = await verifyGerman(card).catch((err) => ({ ok: false, reason: err.message }));
    const slot = isOpenFor(e) && dialog.querySelector(`[data-verdict="${card.id}"]`);
    if (slot) slot.outerHTML = verdictHtml(e.res.checks[card.id], card.id);
  }
}

function verdictHtml(check, id) {
  const attr = `data-verdict="${esc(id)}"`;
  if (!check) return `<span class="verdict" ${attr}>prüfe …</span>`;
  if (check.ok) return `<span class="verdict ok" ${attr}>✓ deutsches Bild</span>`;
  return `<span class="verdict bad" ${attr}>✗ ${esc(check.reason || 'nicht deutsch')}</span>`;
}

function renderDialog(e) {
  const card = e.res.chosen;
  const img = faceImages(card)[0]?.normal;
  const prints = e.res.prints;
  const options = [...(prints || []), e.res.base];
  $('#dialog-body').innerHTML = `
    <div class="dialog-head">
      ${img ? `<img src="${esc(img)}" alt="" />` : '<div></div>'}
      <div>
        <h3>${esc(e.displayName)}</h3>
        <p class="meta">${esc(e.res.base.name)} · ${esc(card.set_name)} (${esc(card.set.toUpperCase())}) #${esc(card.collector_number)}</p>
        <div class="row"><span class="badge ${e.res.status}">${esc(BADGE[e.res.status](e))}</span></div>
        <label class="check"><input type="checkbox" data-commander ${e.isCommander ? 'checked' : ''} /> Kommandant</label>
      </div>
    </div>
    <h4 class="alt-title">Drucke zum Austauschen</h4>
    ${prints ? '' : '<p class="hint">Suche deutsche Drucke …</p>'}
    ${prints && !prints.length ? '<p class="hint">Kein deutscher Druck bei Scryfall vorhanden.</p>' : ''}
    <div class="alts">
      ${options
        .map((c) => {
          const thumb = faceImages(c)[0]?.normal;
          const isEn = c.lang !== 'de';
          return `<div class="alt${c.id === card.id ? ' current' : ''}">
            ${thumb ? `<img src="${esc(thumb)}" alt="" />` : ''}
            <span>${esc(c.set.toUpperCase())} #${esc(c.collector_number)} · ${esc((c.released_at || '').slice(0, 4))}</span>
            ${isEn ? '<span class="verdict bad">Englisch</span>' : verdictHtml(e.res.checks?.[c.id], c.id)}
            ${c.id === card.id ? '<span>✦ ausgewählt</span>' : `<button class="btn small" data-choose="${esc(c.id)}">Verwenden</button>`}
          </div>`;
        })
        .join('')}
    </div>`;
}

dialog.addEventListener('click', (ev) => {
  if (ev.target === dialog) return dialog.close();
  const id = ev.target.closest('[data-choose]')?.dataset.choose;
  if (!id) return;
  const e = byId(dialog.dataset.entry);
  const card = [...(e.res.prints || []), e.res.base].find((c) => c.id === id);
  if (card) {
    chooseCard(e, card);
    renderDialog(e);
    render();
  }
});
dialog.addEventListener('change', (ev) => {
  if (!ev.target.matches('[data-commander]')) return;
  const e = byId(dialog.dataset.entry);
  e.isCommander = ev.target.checked;
  render();
});
// ---------- PDF ----------

async function makePdf() {
  const btn = $('#pdf-btn');
  btn.disabled = true;
  try {
    const entries = sortedEntries();
    const result = await buildPdf({
      deckName: state.deckName,
      entries,
      options: state.options,
      onProgress: (done, total) => setProgress(done, total, `Bilder für PDF: ${done} von ${total} …`),
    });
    $('#progress-panel').hidden = true;
    return result;
  } finally {
    btn.disabled = false;
  }
}

$('#pdf-btn').addEventListener('click', async () => {
  try {
    const { blob } = await makePdf();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfFileName(state.deckName);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    $('#progress-panel').hidden = true;
    alert(`PDF konnte nicht erstellt werden: ${err.message}`);
  }
});

$('#clear-cache').addEventListener('click', async () => {
  if (!confirm('Zwischengespeicherte Karten und Bilder löschen?')) return;
  await clearCache();
  alert('Cache geleert.');
});

initPrecons();

// Nur im Entwicklungsmodus: Zugriff für automatische Tests
if (import.meta.env.DEV) {
  window.__dd = { state, pickPrecon, loadDeck, makePdf, pdfFileName, sortedEntries, chooseCard };
}
