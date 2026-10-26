// Reiter „Alle Precons“: Kachel-Übersicht aller Commander-Precons mit Filtern
// und Detailansicht. Daten aus precons.json (wird beim Bauen erzeugt, siehe
// scripts/build-precons.mjs); die Kartenliste der Detailansicht kommt von MTGJSON.

import { getJSON, TTL } from './lib/net.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
const COLOR_NAMES = { W: 'Weiß', U: 'Blau', B: 'Schwarz', R: 'Rot', G: 'Grün', C: 'Farblos' };
const symbol = (c) => `https://svgs.scryfall.io/card-symbols/${c}.svg`;
const manaHtml = (colors) =>
  (colors.length ? colors : ['C'])
    .map((c) => `<img class="mana" src="${symbol(c)}" alt="${COLOR_NAMES[c]}" title="${COLOR_NAMES[c]}" />`)
    .join('');

const filter = { text: '', colors: new Set(), exact: false, year: '', set: '', sort: 'new' };
let decks = null;
let onLoadDeck = null;

export function initBrowse({ onLoad }) {
  onLoadDeck = onLoad;
  $('[data-tab="browse"]').addEventListener('click', loadData, { once: true });

  $('#browse-colors').innerHTML = COLORS.map(
    (c) => `<button type="button" class="mana-btn" data-color="${c}" aria-pressed="false" title="${COLOR_NAMES[c]}">
      <img src="${symbol(c)}" alt="${COLOR_NAMES[c]}" /></button>`,
  ).join('');

  $('#browse-search').addEventListener('input', (ev) => {
    filter.text = norm(ev.target.value.trim());
    render();
  });
  $('#browse-colors').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-color]');
    if (!btn) return;
    const c = btn.dataset.color;
    filter.colors.has(c) ? filter.colors.delete(c) : filter.colors.add(c);
    btn.setAttribute('aria-pressed', filter.colors.has(c));
    render();
  });
  $('#browse-exact').addEventListener('change', (ev) => {
    filter.exact = ev.target.checked;
    render();
  });
  for (const [id, key] of [['#browse-year', 'year'], ['#browse-set', 'set'], ['#browse-sort', 'sort']]) {
    $(id).addEventListener('change', (ev) => {
      filter[key] = ev.target.value;
      render();
    });
  }
  $('#browse-reset').addEventListener('click', () => {
    Object.assign(filter, { text: '', year: '', set: '', exact: false });
    filter.colors.clear();
    $('#browse-search').value = '';
    $('#browse-year').value = '';
    $('#browse-set').value = '';
    $('#browse-exact').checked = false;
    document.querySelectorAll('#browse-colors [data-color]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    render();
  });

  $('#browse-grid').addEventListener('click', (ev) => {
    const tile = ev.target.closest('[data-deck]');
    if (tile) openDetail(decks.find((d) => d.fileName === tile.dataset.deck));
  });
}

async function loadData() {
  $('#browse-status').textContent = 'Lade Übersicht …';
  try {
    const res = await fetch('./precons.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    decks = (await res.json()).decks.map((d) => ({
      ...d,
      year: (d.releaseDate || '').slice(0, 4),
      hay: norm([d.name, d.code, d.setName, ...d.commanders.flatMap((c) => [c.name, c.deName])].join(' ')),
    }));
  } catch (err) {
    $('#browse-status').textContent = `Übersicht nicht verfügbar (${err.message}).`;
    return;
  }

  const years = [...new Set(decks.map((d) => d.year))].sort().reverse();
  $('#browse-year').innerHTML += years.map((y) => `<option value="${y}">${y}</option>`).join('');
  const sets = new Map();
  for (const d of decks) if (!sets.has(d.code)) sets.set(d.code, d);
  $('#browse-set').innerHTML += [...sets.values()]
    .map((d) => `<option value="${esc(d.code)}">${esc(d.setName || d.code)} (${esc(d.year)})</option>`)
    .join('');
  render();
}

function matches(d) {
  if (filter.text && !filter.text.split(/\s+/).every((w) => d.hay.includes(w))) return false;
  if (filter.year && d.year !== filter.year) return false;
  if (filter.set && d.code !== filter.set) return false;
  if (filter.colors.size) {
    const wanted = [...filter.colors].filter((c) => c !== 'C');
    if (filter.colors.has('C')) {
      // Farblos: nur Decks ohne Farbe (zusammen mit Farben nicht sinnvoll kombinierbar)
      if (d.colors.length) return false;
    } else if (filter.exact) {
      if (d.colors.length !== wanted.length || !wanted.every((c) => d.colors.includes(c))) return false;
    } else if (!wanted.every((c) => d.colors.includes(c))) return false;
  }
  return true;
}

const SORTS = {
  new: (a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name),
  old: (a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name),
  az: (a, b) => a.name.localeCompare(b.name, 'de'),
};

function tileHtml(d) {
  const cmd = d.commanders[0] || {};
  const names = d.commanders.map((c) => c.deName || c.name).join(' & ');
  return `<button class="precon-tile" data-deck="${esc(d.fileName)}">
    <span class="precon-art">
      ${cmd.art ? `<img src="${esc(cmd.art)}" alt="" loading="lazy" decoding="async" />` : ''}
      ${cmd.card ? `<img class="precon-peek" src="${esc(cmd.card)}" alt="" loading="lazy" decoding="async" />` : ''}
    </span>
    <span class="precon-info">
      <span class="precon-name">${esc(d.name)}</span>
      <span class="precon-cmd">${esc(names)}</span>
      <span class="precon-meta"><span>${esc(d.setName || d.code)} · ${esc(d.year)}</span><span class="mana-row">${manaHtml(d.colors)}</span></span>
    </span>
  </button>`;
}

function render() {
  if (!decks) return;
  const list = decks.filter(matches).sort(SORTS[filter.sort]);
  $('#browse-status').textContent = `${list.length} von ${decks.length} Precons`;
  $('#browse-grid').innerHTML = list.length
    ? list.map(tileHtml).join('')
    : '<p class="hint">Keine Precons passen zu diesen Filtern.</p>';
}

// ---------- Detailansicht ----------

const TYPE_GROUPS = [
  ['Kreaturen', (t) => t.includes('Creature')],
  ['Planeswalker', (t) => t.includes('Planeswalker')],
  ['Schlachten', (t) => t.includes('Battle')],
  ['Spontanzauber', (t) => t.includes('Instant')],
  ['Hexereien', (t) => t.includes('Sorcery')],
  ['Artefakte', (t) => t.includes('Artifact') && !t.includes('Land')],
  ['Verzauberungen', (t) => t.includes('Enchantment') && !t.includes('Land')],
  ['Länder', (t) => t.includes('Land')],
];

const germanOf = (card) => card.foreignData?.find((f) => f.language === 'German')?.name;

function listHtml(deck) {
  const commanders = deck.commander || [];
  const groups = TYPE_GROUPS.map(([label]) => [label, []]);
  const other = [];
  for (const c of deck.mainBoard || []) {
    const t = c.types || [];
    const idx = TYPE_GROUPS.findIndex(([, test]) => test(t));
    (idx >= 0 ? groups[idx][1] : other).push(c);
  }
  const line = (c) => `<li><span class="n">${c.count || 1}</span> ${esc(germanOf(c) || c.name)}</li>`;
  const block = (label, cards) => {
    if (!cards.length) return '';
    const sum = cards.reduce((n, c) => n + (c.count || 1), 0);
    const sorted = [...cards].sort((a, b) => (germanOf(a) || a.name).localeCompare(germanOf(b) || b.name, 'de'));
    return `<section><h5>${label} <span>${sum}</span></h5><ul>${sorted.map(line).join('')}</ul></section>`;
  };
  return [
    block(commanders.length > 1 ? 'Kommandanten' : 'Kommandant', commanders),
    ...groups.map(([label, cards]) => block(label, cards)),
    block('Sonstige', other),
  ].join('');
}

async function openDetail(d) {
  if (!d) return;
  const dialog = $('#card-dialog');
  dialog.dataset.entry = '';
  $('#dialog-body').innerHTML = `
    <div class="precon-detail">
      <div class="precon-cards">
        ${d.commanders
          .map((c) => (c.card ? `<img src="${esc(c.card)}" alt="${esc(c.deName || c.name)}" />` : ''))
          .join('')}
      </div>
      <div>
        <h3>${esc(d.name)}</h3>
        <p class="meta">${esc(d.setName || d.code)} (${esc(d.code)}) · ${esc(new Date(d.releaseDate).toLocaleDateString('de-DE'))}</p>
        <p class="meta">${d.commanders.map((c) => esc(c.deName || c.name)).join(' & ')}</p>
        <div class="row"><span class="mana-row big">${manaHtml(d.colors)}</span><span class="meta">${d.count} Karten</span></div>
        <button class="btn primary" data-load-precon="${esc(d.fileName)}">Dieses Deck laden</button>
      </div>
    </div>
    <h4 class="alt-title">Kartenliste</h4>
    <div class="precon-list" data-precon-list><p class="hint">Lade Kartenliste …</p></div>`;
  if (!dialog.open) dialog.showModal();

  try {
    const json = await getJSON(`https://mtgjson.com/api/v5/decks/${encodeURIComponent(d.fileName)}.json`, {
      ttl: TTL.mtgjson,
      limited: false,
    });
    const box = dialog.querySelector('[data-precon-list]');
    if (box && json?.data) box.innerHTML = listHtml(json.data);
  } catch (err) {
    const box = dialog.querySelector('[data-precon-list]');
    if (box) box.innerHTML = `<p class="note">Kartenliste nicht ladbar: ${esc(err.message)}</p>`;
  }
}

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-load-precon]');
  if (!btn) return;
  $('#card-dialog').close();
  onLoadDeck?.(btn.dataset.loadPrecon);
});
