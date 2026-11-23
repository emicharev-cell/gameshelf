// GameShelf — frontend (vanilla JS, sin build).
import { esc, toast, fileToDataUrl, debounce } from './lib.js?v=202611232209';
import { api, load, claimFromHash, saveCreds, clearCreds, getCreds, hasCreds, editorLink, publicUrl, exportJSON, setSaveListener, REPO } from './backend.js?v=202611232209';
import { PLAT, platStyle, coverSrc, fallbackCover, wireCovers } from './platforms.js?v=202611232209';
import { parseHours } from './util.js?v=202611232209';

// ---------------------------------------------------------------- Estado
const STATUS = {
  jugando: { label: 'Jugando', color: '#22d3ee', order: 0 },
  pendiente: { label: 'Pendiente', color: '#fbbf24', order: 1 },
  completado: { label: 'Completado', color: '#34d399', order: 2 },
  masterizado: { label: '100% / Masterizado', short: '100%', color: '#f59e0b', order: 3 },
};
const FORMAT = { fisico: 'Físico', digital: 'Digital', especial: 'Edición especial' };
const SOURCE = { manual: 'manual', exophase: 'Exophase', retroarch: 'RetroArch', csv: 'importado' };
const YEAR = new Date().getFullYear();

const SORTS = {
  title: { label: 'Título (A–Z)', dir: 1, cmp: (a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }) },
  year: { label: 'Fecha de lanzamiento (Europa)', dir: -1, cmp: (a, b) => relKey(a).localeCompare(relKey(b)) },
  hours: { label: 'Horas jugadas', dir: -1, cmp: (a, b) => (a.hours || 0) - (b.hours || 0) },
  platform: { label: 'Plataforma (agrupado)', dir: 1, group: g => g.platform, cmp: (a, b) => platOrder(a.platform) - platOrder(b.platform) || a.platform.localeCompare(b.platform) },
  status: { label: 'Estado de progreso', dir: 1, group: g => STATUS[g.status].label, cmp: (a, b) => STATUS[a.status].order - STATUS[b.status].order },
  saga: { label: 'Saga / franquicia (agrupado)', dir: 1, group: g => saga(g), cmp: (a, b) => sagaOrder(a, b) || (relKey(a) || '9999').localeCompare(relKey(b) || '9999') },
  added: { label: 'Añadidos recientemente', dir: -1, cmp: (a, b) => a.added_at.localeCompare(b.added_at) },
  rating: { label: 'Mi valoración', dir: -1, cmp: (a, b) => (a.rating ?? -1) - (b.rating ?? -1) },
  played: { label: 'Última partida', dir: -1, cmp: (a, b) => (a.last_played || '').localeCompare(b.last_played || '') },
  veteran: { label: '🧓 Veterano (horas por año de vida)', dir: -1, cmp: (a, b) => veteran(a) - veteran(b), hint: g => `${veteran(g).toFixed(1)} h/año` },
  gems: { label: '💎 Gemas olvidadas (backlog más antiguo)', dir: 1, cmp: (a, b) => gem(a) - gem(b), hint: g => g.status === 'pendiente' ? `en la estantería ${ago(g.added_at)}` : '' },
  marathon: { label: '🏃 Maratón (horas vs. media de su consola)', dir: -1, cmp: (a, b) => marathon(a) - marathon(b), hint: g => `${marathon(g) >= 1 ? '×' + marathon(g).toFixed(1) : ''}` },
};
// Sagas: se detectan por el título (español o inglés). El orden de la lista decide qué gana si encaja en varias
// (p. ej. "Mario & Sonic" → Mario, "Hyrule Warriors" → Zelda). Dentro de cada saga, por año de lanzamiento.
const SAGAS = [
  ['The Legend of Zelda', /zelda|hyrule warriors/],
  ['Pokémon', /pok[eé]mon|pok[eé]park/],
  ['Super Smash Bros.', /smash bros/],
  ['Mario Kart', /mario ?kart/],
  ['Mario Party', /mario party|super mario party/],
  ['Paper Mario', /paper mario/],
  ['Mario & Luigi', /mario (&|and) luigi/],
  ['Mario', /mario|captain toad|bowser/],
  ['Luigi\'s Mansion', /luigi'?s mansion/],
  ['Donkey Kong', /donkey kong/],
  ['Kirby', /kirby/],
  ['Yoshi', /yoshi/],
  ['Metroid', /metroid/],
  ['Pikmin', /pikmin/],
  ['Animal Crossing', /animal crossing/],
  ['Splatoon', /splatoon/],
  ['Star Fox', /star ?fox/],
  ['Tomodachi Life', /tomodachi/],
  ['Rhythm Paradise', /rhythm (paradise|heaven)/],
  ['Wario', /wario/],
  ['Inazuma Eleven', /inazuma/],
  ['Skylanders', /skylanders/],
  ['Profesor Layton', /layton/],
  ['Dragon Quest', /dragon quest/],
  ['Xenoblade', /xenoblade/],
  ['Fire Emblem', /fire emblem/],
  ['Kid Icarus', /kid icarus/],
  ['Serie Wii / Nintendo Land', /\bwii (sports|play|party|fit)|nintendo land/],
  ['Puyo Puyo / Tetris', /puyo|tetris/],
];
const OTHER_SAGA = 'Otros';
const saga = g => {
  const t = `${g.title} ${g.alt_title || ''}`.toLowerCase();
  return (SAGAS.find(([, re]) => re.test(t)) || [OTHER_SAGA])[0];
};
const sagaOrder = (a, b) => {
  const x = saga(a), y = saga(b);
  if (x === y) return 0;
  if (x === OTHER_SAGA) return 1;
  if (y === OTHER_SAGA) return -1;
  return x.localeCompare(y, 'es');
};
const veteran = g => (g.hours || 0) / Math.max(1, YEAR - (g.year || YEAR) + 1);
const gem = g => g.status === 'pendiente' ? Date.parse(g.added_at.replace(' ', 'T')) : 9e15;
let platAvg = {};
const marathon = g => platAvg[g.platform] ? (g.hours || 0) / platAvg[g.platform] : 0;
const platOrder = p => { const i = Object.keys(PLAT).indexOf(p); return i < 0 ? 999 : i; };
const ago = d => { const days = Math.round((Date.now() - Date.parse(d.replace(' ', 'T'))) / 864e5); return days > 365 ? `${(days / 365).toFixed(1)} años` : days > 60 ? `${Math.round(days / 30)} meses` : `${days} días`; };
// Horas como "22 h 49 min" (y "h:mm" en los campos de edición)
const mins = h => Math.round((h || 0) * 60);
const fmtH = h => { const m = mins(h), H = Math.floor(m / 60), M = m % 60; return H ? `${H.toLocaleString('es')} h${M ? ` ${M} min` : ''}` : `${M} min`; };
const fmtHM = h => { const m = mins(h); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
// Fecha de lanzamiento europea: "12/10/2013" o "12 de octubre de 2013"; si solo hay año, el año.
const relKey = g => g.release_eu || (g.year ? `${g.year}-99` : '');
const fmtDate = (g, long) => g.release_eu
  ? new Date(g.release_eu + 'T12:00:00').toLocaleDateString('es-ES', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' })
  : (g.year || '—');

const saved = JSON.parse(localStorage.getItem('gs_prefs') || '{}');
const state = {
  games: [],
  me: { editor: false },
  guestPreview: false,
  q: '',
  f: { platform: new Set(), status: new Set(), format: new Set() },
  sort: saved.sort || 'added',
  dir: saved.dir ?? -1,
  view: saved.view || 'grid',
  shape: saved.shape || 'rect',
  theme: saved.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
};
const savePrefs = () => localStorage.setItem('gs_prefs', JSON.stringify({ sort: state.sort, dir: state.dir, view: state.view, theme: state.theme, shape: state.shape }));
const editor = () => state.me.editor && !state.guestPreview;
const $ = s => document.querySelector(s);

// ---------------------------------------------------------------- Arranque
async function boot() {
  document.documentElement.dataset.theme = state.theme;
  // Si hay una versión publicada más nueva que la que tiene el navegador en caché, recarga con ?v=nueva
  // (una URL distinta obliga al navegador a pedir el HTML y los JS/CSS nuevos).
  try {
    const { version } = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json();
    if (version && version !== window.APP_VERSION && sessionStorage.getItem('gs_reloaded') !== version) {
      sessionStorage.setItem('gs_reloaded', version);
      location.replace(location.pathname + '?v=' + version + location.hash);
      return;
    }
  } catch { /* sin conexión o en local: seguimos */ }
  if (location.hash.startsWith('#k=')) {
    // QR de editor: el token viaja en el fragmento (#), que nunca se envía a ningún servidor.
    // Se guarda en este dispositivo y se borra de la barra de direcciones.
    try { await claimFromHash(); toast('✏️ Modo editor activado en este dispositivo', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }
  await load();
  state.me = await api('/api/me');
  state.games = await api('/api/games');
  setupUI();
  applyMode();
  render();
  if (hasCreds() && !state.me.editor) toast('Tu token de GitHub ya no es válido: vuelve a configurarlo en 🔑', 'err');
  if (location.hash === '#setup') openSetup();
  window.addEventListener('gs-games-changed', async () => { state.games = await api('/api/games'); render(true); });
  setSaveListener((st, msg) => {
    if (!editor()) return;
    $('#modeBadge').textContent = {
      pending: 'Editor · cambios sin guardar…', saving: 'Editor · guardando en GitHub…', saved: 'Editor · guardado ✓', error: 'Editor · error al guardar',
    }[st];
    if (st === 'error') toast('No se pudo guardar en GitHub: ' + msg, 'err');
  });
  // Aviso si se intenta cerrar con cambios pendientes de subir
  window.addEventListener('beforeunload', e => { if (/sin guardar|guardando/.test($('#modeBadge').textContent)) e.preventDefault(); });
}

function applyShape() {
  document.body.classList.toggle('sq', state.shape === 'square');
  document.querySelectorAll('#shapeSeg button').forEach(b => b.classList.toggle('on', b.dataset.shape === state.shape));
}

function applyMode() {
  document.body.classList.toggle('is-editor', editor());
  const b = $('#modeBadge');
  b.textContent = state.me.editor ? (state.guestPreview ? 'Vista previa invitado' : 'Modo editor') : 'Invitado · solo lectura';
  b.classList.toggle('editor', editor());
  // El botón de vista previa debe seguir visible en modo invitado-preview para poder volver.
  $('#btnGuestView').classList.remove('editor-only');
  $('#btnGuestView').hidden = !state.me.editor;
  $('#btnGuestView').textContent = state.guestPreview ? '✏️' : '👁';
  $('#btnGuestView').title = state.guestPreview ? 'Volver a modo editor' : 'Ver como invitado';
  $('#btnLogin').hidden = state.me.editor;
}

// ---------------------------------------------------------------- UI fija
function setupUI() {
  const sel = $('#sortKey');
  sel.innerHTML = Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  sel.value = state.sort;
  sel.onchange = () => { state.sort = sel.value; state.dir = SORTS[state.sort].dir; savePrefs(); render(); };
  $('#sortDir').onclick = () => { state.dir *= -1; savePrefs(); render(); };
  $('#search').oninput = debounce(e => { state.q = e.target.value; render(); }, 80);
  $('#viewSeg').onclick = e => { const v = e.target.closest('button')?.dataset.view; if (v) { state.view = v; savePrefs(); render(); } };
  $('#shapeSeg').onclick = e => { const v = e.target.closest('button')?.dataset.shape; if (v) { state.shape = v; savePrefs(); applyShape(); } };
  applyShape();
  $('#btnFilters').onclick = () => $('#filters').classList.toggle('open');
  $('#clearFilters').onclick = () => { Object.values(state.f).forEach(s => s.clear()); render(); };
  $('#btnTheme').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.theme; savePrefs(); };
  $('#btnGuestView').onclick = () => { state.guestPreview = !state.guestPreview; applyMode(); render(); toast(state.guestPreview ? 'Así ven tu catálogo los invitados' : 'De vuelta al modo editor'); };
  $('#btnRandom').onclick = $('#mbRandom').onclick = () => openRandom();
  $('#btnStats').onclick = () => openStats();
  $('#btnQR').onclick = () => openQR('editor');
  $('#btnLogin').onclick = () => openSetup();
  $('#btnImport').onclick = $('#mbHours').onclick = () => openImport();
  $('#btnAdd').onclick = e => { e.stopPropagation(); $('#addMenu').classList.toggle('open'); };
  document.addEventListener('click', () => $('#addMenu').classList.remove('open'));
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    $('#addMenu').classList.remove('open');
    ({ photo: openAddPhoto, shelf: openShelfScan, manual: () => openGameForm() })[b.dataset.add]();
  });
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select') || $('#modal').open) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    if (e.key.toLowerCase() === 'r') openRandom();
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
}

// ---------------------------------------------------------------- Filtrado / orden
function filtered() {
  const q = state.q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const { platform, status, format } = state.f;
  return state.games.filter(g => {
    if (platform.size && !platform.has(g.platform)) return false;
    if (status.size && !status.has(g.status)) return false;
    if (format.size && !format.has(g.format)) return false;
    if (!q) return true;
    const hay = [g.title, g.alt_title, g.platform, g.developer, g.publisher, g.notes, g.edition, g.year, ...(g.genres || [])].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return q.split(/\s+/).every(w => hay.includes(w));
  });
}

function sorted(list) {
  const s = SORTS[state.sort];
  const byTitle = SORTS.title.cmp;
  if (state.sort === 'marathon') {
    const acc = {};
    for (const g of state.games) if (g.hours > 0) { (acc[g.platform] ||= []).push(g.hours); }
    platAvg = Object.fromEntries(Object.entries(acc).map(([p, a]) => [p, a.reduce((x, y) => x + y, 0) / a.length]));
  }
  return [...list].sort((a, b) => s.cmp(a, b) * state.dir || byTitle(a, b));
}

// ---------------------------------------------------------------- Render principal
function render(soft = false) {
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  $('#sortKey').value = state.sort;
  $('#sortDir').textContent = state.dir === 1 ? '↑' : '↓';
  renderFilters();
  renderStatStrip();
  const list = sorted(filtered());
  $('#resultCount').textContent = `${list.length} de ${state.games.length} juegos`;
  $('#empty').hidden = list.length > 0;
  const root = $('#catalog');
  const scroll = window.scrollY;
  if (state.view === 'shelf') root.innerHTML = renderShelf(list);
  else if (state.view === 'list') root.innerHTML = renderList(list);
  else root.innerHTML = renderGrid(list, soft);
  wireCovers(root);
  wireCatalog(root);
  if (soft) window.scrollTo(0, scroll);
}

function renderFilters() {
  const count = (key, val) => state.games.filter(g => g[key] === val).length;
  const plats = [...new Set(state.games.map(g => g.platform))].sort((a, b) => platOrder(a) - platOrder(b));
  const chip = (group, val, label, color) => `<button class="chip ${state.f[group].has(val) ? 'on' : ''}" data-f="${group}" data-v="${esc(val)}">${color ? `<span class="dot" style="background:${color}"></span>` : ''}${esc(label)} <small>${count(group, val)}</small></button>`;
  $('#fPlatform').innerHTML = plats.map(p => chip('platform', p, p, platStyle(p).c)).join('');
  $('#fStatus').innerHTML = Object.entries(STATUS).map(([k, s]) => chip('status', k, s.label, s.color)).join('');
  $('#fFormat').innerHTML = Object.entries(FORMAT).map(([k, l]) => chip('format', k, l)).join('');
  const n = Object.values(state.f).reduce((a, s) => a + s.size, 0);
  $('#filterCount').textContent = n || '';
  document.querySelectorAll('.chip[data-f]').forEach(c => c.onclick = () => {
    const set = state.f[c.dataset.f]; const v = c.dataset.v;
    set.has(v) ? set.delete(v) : set.add(v);
    render();
  });
}

function renderStatStrip() {
  const g = state.games;
  const hours = g.reduce((a, x) => a + (x.hours || 0), 0);
  const done = g.filter(x => x.status === 'completado' || x.status === 'masterizado').length;
  const playing = g.filter(x => x.status === 'jugando');
  const pct = g.length ? Math.round(done / g.length * 100) : 0;
  const plats = new Set(g.map(x => x.platform)).size;
  $('#statstrip').innerHTML = `
    <div class="stat"><b>${g.length}</b><span>juegos · ${plats} sistemas</span></div>
    <div class="stat"><b>${Math.round(hours).toLocaleString('es')} h</b><span>jugadas en total</span></div>
    <div class="stat"><b>${pct}%</b><span>completados (${done})</span><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="stat"><b>${g.filter(x => x.status === 'pendiente').length}</b><span>en el backlog</span></div>
    <div class="stat"><b>${playing.length}</b><span>${playing.length ? esc(playing.slice(0, 2).map(x => x.title.split(':')[0]).join(', ')) : 'jugando ahora'}</span></div>`;
}

function cardHTML(g, i) {
  const ps = platStyle(g.platform);
  const hint = SORTS[state.sort].hint?.(g);
  return `<article class="card" data-id="${g.id}" style="animation-delay:${Math.min(i, 30) * 18}ms" tabindex="0">
    <div class="cover">
      <div class="plat-band" style="background:${ps.c};color:${ps.t || '#fff'}">${esc(ps.short)}</div>
      <img loading="lazy" alt="" ${coverSrc(g)}>
      ${g.format === 'especial' ? '<span class="special-tag" title="Edición especial">✨</span>' : g.format === 'digital' ? '<span class="special-tag" title="Digital">☁️</span>' : ''}
      <span class="status-pill st-${g.status}">${esc(STATUS[g.status].short || STATUS[g.status].label)}</span>
      ${g.hours > 0 ? `<span class="badge-hours">${fmtH(g.hours)}</span>` : ''}
    </div>
    <div class="card-title">${esc(g.title)}</div>
    <div class="card-sub">${fmtDate(g)}${g.developer ? ' · ' + esc(g.developer) : ''}${hint ? ` · <b>${esc(hint)}</b>` : ''}</div>
  </article>`;
}

function grouped(list) {
  const s = SORTS[state.sort];
  if (!s.group) return [[null, list]];
  const map = new Map();
  for (const g of list) { const k = s.group(g); if (!map.has(k)) map.set(k, []); map.get(k).push(g); }
  return [...map];
}

function renderGrid(list) {
  let i = 0;
  return grouped(list).map(([name, games]) => `
    ${name ? `<div class="group-title"><span class="swatch" style="background:${state.sort === 'status' ? Object.values(STATUS).find(s => s.label === name)?.color : platStyle(name).c}"></span>${esc(name)} <small>${games.length} ${games.length === 1 ? "juego" : "juegos"} · ${fmtH(games.reduce((a, g) => a + g.hours, 0))}</small></div>` : ''}
    <div class="grid">${games.map(g => cardHTML(g, i++)).join('')}</div>`).join('');
}

function renderShelf(list) {
  // Estantería: una balda por consola (o por grupo del orden activo), lomos con el color de cada sistema.
  const groups = SORTS[state.sort].group ? grouped(list) : (() => {
    const m = new Map();
    for (const g of list) { if (!m.has(g.platform)) m.set(g.platform, []); m.get(g.platform).push(g); }
    return [...m];
  })();
  if (!SORTS[state.sort].group) groups.sort((a, b) => platOrder(a[0]) - platOrder(b[0]));
  let i = 0;
  // Una única librería continua: los lomos fluyen y saltan de balda; cada grupo empieza con un separador.
  return `<div class="bookcase">${groups.map(([name, games]) => {
    const color = state.sort === 'status' ? Object.values(STATUS).find(s => s.label === name)?.color : platStyle(name).c;
    return `<div class="cell"><div class="divider" style="--c:${color}"><span>${esc(name)} · ${games.length}</span></div></div>` + games.map(g => {
      const ps = platStyle(g.platform);
      return `<div class="cell"><div class="spine" data-id="${g.id}" tabindex="0" title="${esc(g.title)}" style="--c:${ps.spine || ps.c};--t:${ps.t || '#fff'};--b:${ps.c};--h:${ps.h || 250}px;animation-delay:${Math.min(i++, 80) * 8}ms">
        <span class="sp-logo">${esc(ps.short)}</span><span class="sp-title">${esc(g.title)}</span><span class="sp-dot" style="background:${STATUS[g.status].color}"></span></div></div>`;
    }).join('');
  }).join('')}</div>`;
}

function renderList(list) {
  return `<table class="list"><thead><tr><th></th><th>Título</th><th>Plataforma</th><th>Lanzamiento</th><th>Estado</th><th>Formato</th><th class="num">Horas</th></tr></thead><tbody>
    ${list.map(g => `<tr data-id="${g.id}"><td><img loading="lazy" alt="" ${coverSrc(g)}></td><td><b>${esc(g.title)}</b><br><small style="color:var(--muted)">${esc(g.developer || '')}</small></td>
      <td>${esc(g.platform)}</td><td>${fmtDate(g)}</td><td><span class="status-pill st-${g.status}" style="position:static">${STATUS[g.status].short || STATUS[g.status].label}</span></td>
      <td>${FORMAT[g.format]}</td><td class="num">${fmtH(g.hours)}</td></tr>`).join('')}
  </tbody></table>`;
}

function wireCatalog(root) {
  root.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', e => {
      const g = state.games.find(x => x.id === +el.dataset.id);
      openDetail(g);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
  });
  // Vista previa de carátula al pasar por un lomo
  let peek;
  root.querySelectorAll('.spine').forEach(sp => {
    sp.addEventListener('mouseenter', () => {
      const g = state.games.find(x => x.id === +sp.dataset.id);
      peek = document.createElement('div');
      peek.className = 'spine-peek';
      peek.innerHTML = `<img alt="" ${coverSrc(g)}><div><b>${esc(g.title)}</b><br>${fmtDate(g)} · ${STATUS[g.status].label}${g.hours ? ' · ' + fmtH(g.hours) : ''}</div>`;
      document.body.appendChild(peek);
      wireCovers(peek);
      const r = sp.getBoundingClientRect();
      peek.style.left = Math.min(innerWidth - 180, Math.max(8, r.left + r.width / 2 - 85)) + 'px';
      peek.style.top = Math.max(8, r.top - 300) + 'px';
    });
    sp.addEventListener('mouseleave', () => peek?.remove());
  });
}

// ---------------------------------------------------------------- Guardado de cambios
async function patchGame(id, body, msg) {
  const updated = await api(`/api/games/${id}`, { method: 'PATCH', body });
  replaceGame(updated);
  if (msg) toast(msg, 'ok');
  return updated;
}
function replaceGame(g) {
  const i = state.games.findIndex(x => x.id === g.id);
  if (i >= 0) state.games[i] = g; else state.games.push(g);
  render(true);
}

// ---------------------------------------------------------------- Modal genérico
function openModal(html, { wide } = {}) {
  const m = $('#modal');
  m.style.width = wide ? 'min(1100px, calc(100vw - 24px))' : '';
  $('#modalBody').innerHTML = `<button class="btn icon ghost modal-close no-print" data-close>✕</button>${html}`;
  $('#modalBody').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  if (!m.open) m.showModal();
  wireCovers($('#modalBody'));
  return $('#modalBody');
}
function closeModal() { $('#modal').close(); }

// ---------------------------------------------------------------- Ficha
function openDetail(g) {
  const ed = editor();
  const ps = platStyle(g.platform);
  const body = openModal(`
    <div class="detail">
      <div>
        <div class="cover"><div class="plat-band" style="background:${ps.c};color:${ps.t || '#fff'}">${esc(g.platform)}</div><img alt="" ${coverSrc(g)}></div>
        ${ed ? `<div class="row" style="margin-top:12px"><button class="btn sm" id="dCover">🖼 Cambiar carátula</button><button class="btn sm" id="dEdit">✎ Editar ficha</button></div>` : ''}
      </div>
      <div>
        <h2>${esc(g.title)}</h2>
        <div class="genres">${(g.genres || []).map(x => `<span class="genre">${esc(x)}</span>`).join('')}</div>
        <div class="meta-grid">
          <div><span>Plataforma</span><b>${esc(g.platform)}</b></div>
          <div><span>Lanzamiento (Europa)</span><b>${fmtDate(g, true)}</b></div>
          <div><span>Desarrolladora</span><b>${esc(g.developer || '—')}</b></div>
          <div><span>Editora</span><b>${esc(g.publisher || '—')}</b></div>
          <div><span>Formato</span><b>${FORMAT[g.format]}${g.edition ? ' · ' + esc(g.edition) : ''}</b></div>
          <div><span>Región</span><b>${esc(g.region || '—')}</b></div>
          <div><span>Añadido</span><b>${new Date(g.added_at.replace(' ', 'T') + 'Z').toLocaleDateString('es')}</b></div>
          <div><span>Exophase</span><b>${g.in_exophase ? '✔ Sincronizado' : g.in_exophase === false ? '✘ No está' : '—'}</b></div>
          <div><span>Última partida</span><b>${g.last_played ? esc(String(g.last_played).slice(0, 10)) : '—'}</b></div>
        </div>
        <div class="status-seg" id="dStatus">${Object.entries(STATUS).map(([k, s]) => `<button data-s="${k}" class="${g.status === k ? 'on' : ''}" style="${g.status === k ? `background:${s.color}` : ''}" ${ed ? '' : 'disabled'}>${s.label}</button>`).join('')}</div>
        <div class="hours-box">
          <div><div class="big">${Math.floor(mins(g.hours) / 60).toLocaleString('es')}<small> h </small>${mins(g.hours) % 60}<small> min</small></div><div class="src">Fuente: ${SOURCE[g.hours_source] || g.hours_source}</div></div>
          ${ed ? `<div class="btns">
            <button class="btn sm" data-h="-1">−1</button><button class="btn sm" data-h="0.5">+½</button><button class="btn sm" data-h="1">+1</button><button class="btn sm" data-h="5">+5</button>
            <input type="text" id="dHoursSet" value="${fmtHM(g.hours)}" placeholder="h:mm" title="Ej.: 22:49, 22h 49m o 22,5" style="width:90px;height:30px;padding:2px 8px">
            <button class="btn sm primary" id="dHoursSave">Fijar</button></div>` : ''}
        </div>
        <div class="row"><span style="color:var(--muted);font-size:13px">Mi valoración</span>
          <span class="stars" id="dStars">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}" class="${(g.rating || 0) >= n ? 'on' : ''}" ${ed ? '' : 'disabled'}>★</button>`).join('')}</span></div>
        <h3>Notas</h3>
        ${ed ? `<textarea id="dNotes" style="width:100%;min-height:90px" placeholder="Logros, rutas, recuerdos…">${esc(g.notes || '')}</textarea>
               <div class="row end" style="margin-top:12px"><button class="btn danger sm" id="dDelete">🗑 Borrar</button><span class="spacer"></span><button class="btn primary" id="dNotesSave">Guardar notas</button></div>`
             : `<p class="notes">${esc(g.notes || 'Sin notas.')}</p>`}
      </div>
    </div>`);
  if (!ed) return;
  const refresh = u => { replaceGame(u); openDetail(u); };
  body.querySelector('#dStatus').onclick = async e => { const s = e.target.dataset.s; if (s) refresh(await patchGame(g.id, { status: s })); };
  body.querySelector('#dStars').onclick = async e => { const r = +e.target.dataset.r; if (r) refresh(await patchGame(g.id, { rating: r === g.rating ? null : r })); };
  body.querySelectorAll('[data-h]').forEach(b => b.onclick = async () => refresh(await api(`/api/games/${g.id}/hours`, { method: 'POST', body: { delta: +b.dataset.h } })));
  body.querySelector('#dHoursSave').onclick = async () => refresh(await api(`/api/games/${g.id}/hours`, { method: 'POST', body: { set: parseHours(body.querySelector('#dHoursSet').value) ?? g.hours } }));
  body.querySelector('#dNotesSave').onclick = async () => { await patchGame(g.id, { notes: body.querySelector('#dNotes').value }, 'Notas guardadas'); };
  body.querySelector('#dDelete').onclick = async () => {
    if (!confirm(`¿Borrar "${g.title}" del catálogo?`)) return;
    await api(`/api/games/${g.id}`, { method: 'DELETE' });
    state.games = state.games.filter(x => x.id !== g.id);
    closeModal(); render(true); toast('Juego borrado');
  };
  body.querySelector('#dCover').onclick = () => openCoverPicker(g);
  body.querySelector('#dEdit').onclick = () => openGameForm(g);
}

// ---------------------------------------------------------------- Selector de carátula
async function openCoverPicker(g) {
  const body = openModal(`<h2>Elegir carátula</h2><p class="lead">${esc(g.title)} · ${esc(g.platform)}</p>
    <div class="row" style="margin-bottom:12px"><input type="text" id="cpQ" value="${esc(g.title)}" style="flex:1"><button class="btn" id="cpSearch">Buscar</button></div>
    <div id="cpRes"><div class="loading"><span class="spinner"></span> Buscando portadas…</div></div>
    <div class="row" style="margin-top:14px"><input type="text" id="cpUrl" placeholder="…o pega la URL de una imagen" style="flex:1"><button class="btn" id="cpUseUrl">Usar URL</button></div>
    <div class="row end" style="margin-top:14px"><button class="btn ghost" id="cpBack">← Volver a la ficha</button></div>`);
  const search = async () => {
    body.querySelector('#cpRes').innerHTML = '<div class="loading"><span class="spinner"></span> Buscando portadas…</div>';
    const list = await api(`/api/covers/search?title=${encodeURIComponent(body.querySelector('#cpQ').value)}&platform=${encodeURIComponent(g.platform)}`);
    body.querySelector('#cpRes').innerHTML = list.length
      ? `<div class="cover-picker">${list.map(c => `<button class="cover-opt" data-url="${esc(c.cover)}" title="${esc(c.title)}"><img loading="lazy" src="${esc(c.thumb || c.cover)}" alt=""><small>${esc(c.source)}</small></button>`).join('')}</div>`
      : '<p class="empty">Sin resultados. Prueba otro término o pega una URL.</p>';
    body.querySelectorAll('.cover-opt').forEach(b => b.onclick = () => choose(b.dataset.url));
  };
  const choose = async url => {
    body.querySelector('#cpRes').innerHTML = '<div class="loading"><span class="spinner"></span> Guardando carátula…</div>';
    const u = await api(`/api/games/${g.id}/cover`, { method: 'POST', body: { url } });
    replaceGame(u); toast('Carátula actualizada', 'ok'); openDetail(u);
  };
  body.querySelector('#cpSearch').onclick = search;
  body.querySelector('#cpUseUrl').onclick = () => choose(body.querySelector('#cpUrl').value.trim());
  body.querySelector('#cpBack').onclick = () => openDetail(g);
  search().catch(e => toast(e.message, 'err'));
}

// ---------------------------------------------------------------- Formulario (alta manual / edición / resultado de foto)
function formHTML(g = {}) {
  const plats = Object.keys(PLAT);
  return `<div class="form">
    <label class="full">Título<input type="text" name="title" value="${esc(g.title || '')}" required></label>
    <label>Plataforma<input type="text" name="platform" list="platList" value="${esc(g.platform || '')}"><datalist id="platList">${plats.map(p => `<option value="${esc(p)}">`).join('')}</datalist></label>
    <label>Lanzamiento (Europa)<input type="date" name="release_eu" value="${g.release_eu || ''}"></label>
    <label>Desarrolladora<input type="text" name="developer" value="${esc(g.developer || '')}"></label>
    <label>Editora<input type="text" name="publisher" value="${esc(g.publisher || '')}"></label>
    <label class="full">Géneros (separados por comas)<input type="text" name="genres" value="${esc((g.genres || []).join(', '))}"></label>
    <label>Formato<select name="format">${Object.entries(FORMAT).map(([k, l]) => `<option value="${k}" ${g.format === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Edición<input type="text" name="edition" value="${esc(g.edition || '')}" placeholder="Coleccionista, Nintendo Selects…"></label>
    <label>Región<select name="region">${['', 'PAL', 'NTSC-U', 'NTSC-J'].map(r => `<option ${g.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label>Estado<select name="status">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${(g.status || 'pendiente') === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
    <label>Horas jugadas (h:mm)<input type="text" name="hours" value="${fmtHM(g.hours)}" placeholder="h:mm"></label>
    <label>Valoración (0–5)<input type="number" name="rating" min="0" max="5" value="${g.rating ?? ''}"></label>
    <label class="full">Notas<textarea name="notes">${esc(g.notes || '')}</textarea></label>
  </div>`;
}
const readForm = root => Object.fromEntries([...root.querySelectorAll('.form [name]')].map(el => [el.name, el.value]));

function openGameForm(g = null, { covers = null, duplicate = null } = {}) {
  const isNew = !g?.id;
  const body = openModal(`<h2>${isNew ? 'Añadir juego' : 'Editar ficha'}</h2>
    ${duplicate ? `<div class="callout" style="border-left-color:${duplicate.kind === 'exact' ? 'var(--bad)' : 'var(--warn)'};margin-bottom:14px">${duplicate.kind === 'exact' ? '⚠️ <b>Ya lo tienes</b>' : 'ℹ️ <b>Lo tienes en otra plataforma</b>'}: ${esc(duplicate.game.title)} (${esc(duplicate.game.platform)}).</div>` : ''}
    ${formHTML(g || {})}
    <h3>Carátula</h3>
    <div class="row" style="margin-bottom:10px"><button class="btn sm" id="fSearchCovers">🔎 Buscar carátulas</button>${isNew && state.me.igdb ? '<button class="btn sm" id="fAuto">✨ Autocompletar datos (IGDB)</button>' : ''}<small style="color:var(--muted)">Si no eliges ninguna, se busca automáticamente.</small></div>
    <div id="fCovers"></div>
    <div class="row end" style="margin-top:18px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="fSave">${isNew ? 'Añadir al catálogo' : 'Guardar cambios'}</button></div>`, { wide: true });
  let chosen = g?.cover_url || null;
  const showCovers = list => {
    const box = body.querySelector('#fCovers');
    if (!list.length) { box.innerHTML = '<p style="color:var(--muted)">No se encontraron carátulas.</p>'; return; }
    if (isNew && !chosen) chosen = list[0].cover;
    box.innerHTML = `<div class="cover-picker">${list.map(c => `<button class="cover-opt ${c.cover === chosen ? 'on' : ''}" data-url="${esc(c.cover)}" title="${esc(c.title)}"><img loading="lazy" src="${esc(c.thumb || c.cover)}" alt=""><small>${esc(c.source)}</small></button>`).join('')}</div>`;
    box.querySelectorAll('.cover-opt').forEach(b => b.onclick = () => { chosen = b.dataset.url; box.querySelectorAll('.cover-opt').forEach(x => x.classList.toggle('on', x === b)); });
  };
  if (covers) showCovers(covers);
  body.querySelector('#fSearchCovers').onclick = async () => {
    const v = readForm(body);
    body.querySelector('#fCovers').innerHTML = '<div class="loading"><span class="spinner"></span> Buscando…</div>';
    showCovers(await api(`/api/covers/search?title=${encodeURIComponent(v.title)}&platform=${encodeURIComponent(v.platform)}`));
  };
  body.querySelector('#fAuto')?.addEventListener('click', async () => {
    const v = readForm(body);
    const m = await api(`/api/metadata?title=${encodeURIComponent(v.title)}&platform=${encodeURIComponent(v.platform)}`);
    if (!m) return toast('Sin coincidencias en IGDB', 'err');
    const set = (n, val) => { const el = body.querySelector(`[name=${n}]`); if (val && el) el.value = val; };
    set('title', m.title); set('year', m.year); set('developer', m.developer); set('publisher', m.publisher); set('genres', (m.genres || []).join(', '));
    toast('Datos completados desde IGDB', 'ok');
  });
  body.querySelector('#fSave').onclick = async () => {
    const v = readForm(body);
    if (!v.title.trim()) return toast('Falta el título', 'err');
    try {
      if (isNew) {
        let created;
        try { created = await api('/api/games', { method: 'POST', body: { ...v, cover_url: chosen } }); }
        catch (e) {
          if (e.status !== 409 || !confirm('Ese juego ya está en tu catálogo para esa plataforma. ¿Añadir otra copia igualmente?')) throw e;
          created = await api('/api/games', { method: 'POST', body: { ...v, cover_url: chosen, force: true } });
        }
        replaceGame(created); toast(`✔ ${created.title} añadido`, 'ok'); openDetail(created);
      } else {
        let u = await patchGame(g.id, v);
        if (chosen && chosen !== g.cover_url) u = await api(`/api/games/${g.id}/cover`, { method: 'POST', body: { url: chosen } });
        replaceGame(u); toast('Ficha guardada', 'ok'); openDetail(u);
      }
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------- Subida de fotos
function dropzone(body, { multiple, onFiles, hint }) {
  const z = body.querySelector('.drop');
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple });
  input.setAttribute('capture', 'environment'); // en móvil abre la cámara directamente
  const camOnly = !matchMedia('(pointer:fine)').matches;
  if (!camOnly) input.removeAttribute('capture');
  z.innerHTML = `<div class="big">📷</div><b>${hint}</b><br><small style="color:var(--muted)">Toca para hacer una foto o elegir de la galería · también puedes arrastrar aquí</small>`;
  z.onclick = () => input.click();
  input.onchange = () => onFiles([...input.files]);
  z.ondragover = e => { e.preventDefault(); z.classList.add('over'); };
  z.ondragleave = () => z.classList.remove('over');
  z.ondrop = e => { e.preventDefault(); z.classList.remove('over'); onFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))); };
}

function needVision() {
  if (state.me.vision) return false;
  openModal(`<h2>Falta la clave de Claude</h2><div class="callout">La identificación por foto usa la API de Claude (visión). Añade tu clave en <b>▣ QR → 🔑 Configuración</b>: se guarda solo en este dispositivo, nunca en GitHub. Mientras tanto puedes añadir juegos <b>a mano</b> (con búsqueda de carátula).</div>
    <div class="row end" style="margin-top:16px"><button class="btn primary" id="goManual">Añadir a mano</button></div>`);
  $('#goManual').onclick = () => openGameForm();
  return true;
}

function openAddPhoto() {
  if (needVision()) return;
  let images = [];
  const body = openModal(`<h2>Añadir por foto</h2><p class="lead">Carátula, lomo, cartucho, disco o caja. Puedes subir hasta 4 fotos del mismo juego (p. ej. portada + lomo).</p>
    <div class="drop"></div><div class="thumbs" id="apThumbs"></div>
    <div class="row end" style="margin-top:16px"><button class="btn primary" id="apGo" disabled>🔍 Identificar juego</button></div>`);
  dropzone(body, {
    multiple: true, hint: 'Foto del juego',
    onFiles: async files => {
      images = images.concat(await Promise.all(files.slice(0, 4 - images.length).map(f => fileToDataUrl(f, 1600))));
      body.querySelector('#apThumbs').innerHTML = images.map(src => `<img src="${src}" alt="">`).join('');
      body.querySelector('#apGo').disabled = !images.length;
    },
  });
  body.querySelector('#apGo').onclick = async () => {
    body.querySelector('#apGo').outerHTML = '<div class="loading"><span class="spinner"></span> Analizando la imagen…</div>';
    try {
      const r = await api('/api/vision/identify', { method: 'POST', body: { images } });
      if (!r.result.found) {
        openModal(`<h2>No he reconocido el juego</h2><p class="lead">Prueba con más luz, menos reflejos o una foto de la portada.</p><div class="row end"><button class="btn" id="again">Reintentar</button><button class="btn primary" id="manual">Añadir a mano</button></div>`);
        $('#again').onclick = openAddPhoto; $('#manual').onclick = () => openGameForm();
        return;
      }
      const g = { ...r.result, status: 'pendiente', hours: 0 };
      openGameForm(g, { covers: r.covers, duplicate: r.duplicate });
      const conf = Math.round((r.result.confidence || 0) * 100);
      const alts = (r.result.alternatives || []).filter(a => a.title !== g.title);
      $('#modalBody h2').insertAdjacentHTML('afterend', `<p class="lead">Identificado con un ${conf}% de confianza. Revisa los datos y confirma.${alts.length ? `<br>¿O era…? ${alts.map(a => `<button class="chip" data-alt="${esc(a.title)}" data-plat="${esc(a.platform || '')}">${esc(a.title)}</button>`).join(' ')}` : ''}</p>`);
      document.querySelectorAll('[data-alt]').forEach(b => b.onclick = () => {
        $('#modalBody [name=title]').value = b.dataset.alt;
        if (b.dataset.plat) $('#modalBody [name=platform]').value = b.dataset.plat;
        $('#fSearchCovers').click();
      });
    } catch (e) { toast(e.message, 'err'); openAddPhoto(); }
  };
}

function openShelfScan() {
  if (needVision()) return;
  let images = [];
  const body = openModal(`<h2>Escanear estantería</h2><p class="lead">Haz fotos de frente a los lomos (hasta 8, pueden solaparse). Detectaré los juegos y evitaré duplicados.</p>
    <div class="callout" style="margin-bottom:12px">💡 <b>Consejos:</b> una balda por foto, sin flash (evita reflejos), lomos nítidos y rectos. Los juegos repetidos entre fotos se fusionan.</div>
    <div class="drop"></div><div class="thumbs" id="ssThumbs"></div>
    <div class="row end" style="margin-top:16px"><button class="btn primary" id="ssGo" disabled>📚 Detectar juegos</button></div>`, { wide: true });
  dropzone(body, {
    multiple: true, hint: 'Fotos de la estantería',
    onFiles: async files => {
      images = images.concat(await Promise.all(files.slice(0, 8 - images.length).map(f => fileToDataUrl(f, 2400))));
      body.querySelector('#ssThumbs').innerHTML = images.map(src => `<img src="${src}" alt="">`).join('');
      body.querySelector('#ssGo').disabled = !images.length;
    },
  });
  body.querySelector('#ssGo').onclick = async () => {
    body.querySelector('#ssGo').outerHTML = `<div class="loading"><span class="spinner"></span> Leyendo lomos de ${images.length} foto(s)… puede tardar un poco</div>`;
    try {
      const r = await api('/api/vision/shelf', { method: 'POST', body: { images } });
      showDetections(r.detections, r.errors);
    } catch (e) { toast(e.message, 'err'); openShelfScan(); }
  };
}

function showDetections(dets, errors = []) {
  const plats = Object.keys(PLAT);
  const body = openModal(`<h2>${dets.length} juegos detectados</h2>
    <p class="lead">Marca los que quieras añadir y corrige lo que haga falta. Los que ya tienes vienen desmarcados.</p>
    ${errors.length ? `<div class="callout" style="border-left-color:var(--warn);margin-bottom:10px">Alguna foto falló: ${esc(errors.join(' · '))}</div>` : ''}
    <div class="row" style="margin-bottom:10px"><button class="linkbtn" id="dtAll">Marcar nuevos</button><button class="linkbtn" id="dtNone">Desmarcar todo</button><span class="spacer"></span>
      <label style="font-size:13px;color:var(--muted)">Estado por defecto <select id="dtStatus">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${k === 'pendiente' ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label></div>
    <div class="det-list">${dets.map((d, i) => {
      const tag = d.duplicate?.kind === 'exact' ? '<span class="tag dup">Ya lo tienes</span>' : d.duplicate ? `<span class="tag other" title="${esc(d.duplicate.game.platform)}">En otra consola</span>` : '<span class="tag new">Nuevo</span>';
      return `<div class="det" data-i="${i}">
        <input type="checkbox" ${!d.duplicate || d.duplicate.kind !== 'exact' ? (d.confidence >= 0.5 ? 'checked' : '') : ''}>
        <div><input type="text" name="title" value="${esc(d.title)}"><div class="conf" title="Confianza ${Math.round(d.confidence * 100)}% · lomo: ${esc(d.spine_text)}"><i style="width:${Math.round(d.confidence * 100)}%"></i></div></div>
        <select name="platform">${[...new Set([d.platform, ...plats])].map(p => `<option ${p === d.platform ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <select name="format">${Object.entries(FORMAT).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        ${tag}
      </div>`;
    }).join('') || '<p class="empty">No se leyó ningún lomo. Prueba con otra foto más cercana.</p>'}</div>
    <div class="row end" style="margin-top:16px"><button class="btn ghost" id="dtMore">+ Más fotos</button><button class="btn primary" id="dtAdd">Añadir seleccionados</button></div>`, { wide: true });
  const rows = [...body.querySelectorAll('.det')];
  body.querySelector('#dtAll').onclick = () => rows.forEach((r, i) => r.querySelector('input[type=checkbox]').checked = dets[i].duplicate?.kind !== 'exact');
  body.querySelector('#dtNone').onclick = () => rows.forEach(r => r.querySelector('input[type=checkbox]').checked = false);
  body.querySelector('#dtMore').onclick = openShelfScan;
  body.querySelector('#dtAdd').onclick = async () => {
    const status = body.querySelector('#dtStatus').value;
    const games = rows.filter(r => r.querySelector('input[type=checkbox]').checked).map(r => ({
      title: r.querySelector('[name=title]').value, platform: r.querySelector('[name=platform]').value, format: r.querySelector('[name=format]').value, status,
    }));
    if (!games.length) return toast('No hay nada seleccionado', 'err');
    const res = await api('/api/games/bulk', { method: 'POST', body: { games } });
    res.created.forEach(g => state.games.push(g));
    closeModal(); render();
    toast(`✔ ${res.created.length} añadidos${res.skipped.length ? ` · ${res.skipped.length} duplicados omitidos` : ''}. Buscando carátulas…`, 'ok');
    setTimeout(async () => { state.games = await api('/api/games'); render(true); }, 8000);
  };
}

// ---------------------------------------------------------------- Importar horas
function openImport(tab = 'quick') {
  const body = openModal(`<h2>Horas de juego</h2><p class="lead">Importa automáticamente o ajusta a mano en segundos.</p>
    <div class="tabs" id="imTabs">
      <button data-t="quick">⚡ Editor rápido</button><button data-t="exophase">🏆 Exophase</button><button data-t="retroarch">🕹 RetroArch</button><button data-t="csv">📄 CSV (3DS / Wii U / otros)</button>
    </div><div id="imBody"></div>`, { wide: true });
  body.querySelector('#imTabs').onclick = e => { const t = e.target.dataset.t; if (t) showTab(t); };
  const showTab = t => {
    body.querySelectorAll('#imTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    ({ quick: tabQuick, exophase: tabExophase, retroarch: tabRetro, csv: tabCSV })[t](body.querySelector('#imBody'));
  };
  showTab(tab);
}

function tabQuick(el) {
  const plats = [...new Set(state.games.map(g => g.platform))].sort((a, b) => platOrder(a) - platOrder(b));
  el.innerHTML = `<div class="callout" style="margin-bottom:12px">Pensado para pasar las horas desde el <b>Registro de actividad de 3DS</b> o el <b>Registro diario de Wii U</b>: elige la consola y teclea las horas seguidas (Tab para saltar). Se guarda al salir de cada casilla.</div>
    <div class="row" style="margin-bottom:10px"><select id="qPlat"><option value="">Todas las consolas</option>${plats.map(p => `<option>${esc(p)}</option>`).join('')}</select><input type="text" id="qFind" placeholder="Filtrar…"></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Juego</th><th>Plataforma</th><th>Fuente</th><th class="num">Horas</th></tr></thead><tbody id="qRows"></tbody></table></div>`;
  const draw = () => {
    const p = el.querySelector('#qPlat').value, f = el.querySelector('#qFind').value.toLowerCase();
    el.querySelector('#qRows').innerHTML = state.games.filter(g => (!p || g.platform === p) && (!f || g.title.toLowerCase().includes(f)))
      .sort(SORTS.title.cmp)
      .map(g => `<tr><td>${esc(g.title)}</td><td>${esc(g.platform)}</td><td><small>${SOURCE[g.hours_source]}</small></td><td class="num"><input type="text" placeholder="h:mm" data-id="${g.id}" value="${fmtHM(g.hours)}" style="width:80px"></td></tr>`).join('');
    el.querySelectorAll('input[data-id]').forEach(inp => inp.onchange = async () => {
      const u = await api(`/api/games/${inp.dataset.id}/hours`, { method: 'POST', body: { set: parseHours(inp.value) ?? 0 } });
      const i = state.games.findIndex(x => x.id === u.id); state.games[i] = u;
      inp.style.borderColor = 'var(--good)'; render(true);
    });
  };
  el.querySelector('#qPlat').onchange = draw;
  el.querySelector('#qFind').oninput = draw;
  draw();
}

function exophaseBookmarklet() {
  // Se ejecuta en https://www.exophase.com/user/<usuario>/ (en TU navegador) y copia tus juegos + horas al portapapeles.
  const fn = async () => {
    const games = [], seen = new Set();
    const add = g => { const k = (g.title || '') + '|' + (g.platform || ''); if (g.title && !seen.has(k)) { seen.add(k); games.push(g); } };
    const pid = document.querySelector('[data-playerid]')?.getAttribute('data-playerid')
      || (document.documentElement.innerHTML.match(/["']?player_?id["']?\s*[:=]\s*["']?(\d+)/i) || [])[1];
    if (pid) {
      for (let p = 1; p <= 80; p++) {
        try {
          const r = await fetch('https://api.exophase.com/public/player/' + pid + '/games?page=' + p + '&environment=', { credentials: 'omit' });
          if (!r.ok) break;
          const j = await r.json();
          const a = j.games || j.data || [];
          if (!a.length) break;
          a.forEach(g => add({
            id: g.master_id || g.game_id || g.id,
            title: (g.meta && g.meta.title) || g.title,
            platform: (g.meta && g.meta.platforms && g.meta.platforms[0] && (g.meta.platforms[0].slug || g.meta.platforms[0].name)) || (g.meta && g.meta.environment) || g.environment || '',
            playtime: g.playtime, last_played: g.lastplayed || g.last_played,
          }));
          if (j.more === false) break;
        } catch (e) { break; }
      }
    }
    if (!games.length) {
      document.querySelectorAll('[data-gameid]').forEach(li => {
        const t = li.querySelector('h3 a,h3,.title a,.title,a[href*="/game/"]');
        const h = li.querySelector('.hours,.playtime,[class*="hour"],[class*="playtime"]');
        const pl = li.querySelector('.platforms span,.platform,[class*="platform"]');
        add({ id: li.getAttribute('data-gameid'), title: t && t.textContent.trim(), playtime: h && h.textContent.trim(), platform: pl && (pl.getAttribute('title') || pl.textContent.trim()) });
      });
    }
    if (!games.length) { alert('GameShelf: no encontré juegos. Abre tu perfil de Exophase en la pestaña de juegos, baja hasta el final y vuelve a pulsar el marcador.'); return; }
    const json = JSON.stringify({ games });
    try { await navigator.clipboard.writeText(json); alert('GameShelf: ' + games.length + ' juegos copiados. Vuelve a GameShelf → Horas → Exophase → Pegar.'); }
    catch (e) { prompt('Copia este JSON y pégalo en GameShelf → Horas → Exophase:', json); }
  };
  return 'javascript:' + encodeURIComponent('(' + fn.toString() + ')();');
}

function tabExophase(el) {
  el.innerHTML = `
    <div class="two-col">
      <div>
        <h3>1 · Arrastra este botón a tu barra de marcadores</h3>
        <a class="bookmarklet" href="${esc(exophaseBookmarklet())}" onclick="event.preventDefault();alert('Arrástralo a la barra de marcadores y púlsalo estando en tu perfil de Exophase.')">⇪ GameShelf ← Exophase</a>
        <h3>2 · Púlsalo en tu perfil de Exophase</h3>
        <p style="color:var(--muted);font-size:14px;line-height:1.5">Abre <code>exophase.com/user/&lt;tu-usuario&gt;</code>, pestaña de juegos, baja hasta el final y pulsa el marcador: copiará tus juegos y horas al portapapeles.</p>
        <h3>3 · Pégalos aquí</h3>
        <textarea id="exJson" style="width:100%;min-height:110px" placeholder='{"games":[{"title":"Hades","platform":"steam","playtime":5316}]}'></textarea>
        <div class="row end" style="margin-top:8px"><button class="btn" id="exClip">📋 Pegar del portapapeles</button><button class="btn primary" id="exParse">Previsualizar</button></div>
      </div>
      <div><div class="callout"><b>¿Por qué un marcador y no una conexión directa?</b> Exophase no tiene API pública oficial y su web está protegida por Cloudflare: las peticiones automáticas reciben un 403. El marcador se ejecuta en <b>tu navegador</b>, donde ya has pasado esa verificación, y solo lee tu propio perfil. Exophase registra horas de Steam, PlayStation, Xbox y otras tiendas; <b>no de 3DS ni Wii U</b> (para esas usa el editor rápido o CSV).</div></div>
    </div><div id="exPreview"></div>`;
  el.querySelector('#exClip').onclick = async () => {
    try { el.querySelector('#exJson').value = await navigator.clipboard.readText(); } catch { toast('El navegador no deja leer el portapapeles: pega con Ctrl+V', 'err'); }
  };
  el.querySelector('#exParse').onclick = async () => {
    try { previewTable(el.querySelector('#exPreview'), await api('/api/import/preview', { method: 'POST', body: { source: 'exophase', payload: JSON.parse(el.querySelector('#exJson').value) } })); }
    catch (e) { toast('JSON no válido: ' + e.message, 'err'); }
  };
}

function tabRetro(el) {
  el.innerHTML = `<div class="callout" style="margin-bottom:12px">Activa en RetroArch <b>Ajustes → Guardado → “Registrar tiempo de juego (por contenido)”</b>. Los tiempos quedan en <code>RetroArch/playlists/logs/&lt;núcleo&gt;/*.lrtl</code>. Selecciona esa carpeta <code>logs</code> entera: la consola se deduce del núcleo (Snes9x → SNES, mGBA → GBA, Citra → 3DS…).</div>
    <div class="row"><button class="btn" id="raDir">📁 Elegir carpeta logs</button><button class="btn ghost" id="raFiles">o archivos .lrtl sueltos</button></div><div id="raPreview"></div>`;
  const pick = dir => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.lrtl' });
    if (dir) input.webkitdirectory = true;
    input.onchange = async () => {
      const files = await Promise.all([...input.files].filter(f => f.name.endsWith('.lrtl')).map(async f => ({ name: f.name, path: f.webkitRelativePath || f.name, content: await f.text() })));
      if (!files.length) return toast('No hay archivos .lrtl', 'err');
      previewTable(el.querySelector('#raPreview'), await api('/api/import/preview', { method: 'POST', body: { source: 'retroarch', files } }));
    };
    input.click();
  };
  el.querySelector('#raDir').onclick = () => pick(true);
  el.querySelector('#raFiles').onclick = () => pick(false);
}

function tabCSV(el) {
  el.innerHTML = `<div class="two-col"><div>
      <textarea id="csvText" style="width:100%;min-height:170px;font-family:ui-monospace,monospace;font-size:12px" placeholder="titulo;plataforma;horas&#10;Pokémon Ultra Sun;3DS;48:30&#10;Splatoon;Wii U;89"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn ghost" id="csvFile">📄 Cargar archivo</button><span class="spacer"></span>
        <select id="csvPlat"><option value="">Plataforma por defecto…</option>${Object.keys(PLAT).map(p => `<option>${esc(p)}</option>`).join('')}</select><button class="btn" id="csvGo">Previsualizar</button></div>
    </div><div class="callout">Columnas reconocidas: <code>titulo</code>, <code>plataforma</code>, <code>horas</code> (admite <code>12,5</code>, <code>12:30</code>, <code>12h 30m</code>) o <code>minutos</code>, y opcional <code>ultima_vez</code>. Separador <code>,</code> <code>;</code> o tabulador.<br><br>
      <b>3DS:</b> el Registro de actividad (menú HOME) muestra el tiempo total por juego; con homebrew puedes volcarlo a CSV (ver README).<br><b>Wii U:</b> Control parental → Registro diario muestra el tiempo por juego; transcríbelo aquí o en el editor rápido.</div></div>
    <div id="csvPreview"></div>`;
  el.querySelector('#csvFile').onclick = () => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,.txt,.tsv' });
    i.onchange = async () => { el.querySelector('#csvText').value = await i.files[0].text(); };
    i.click();
  };
  el.querySelector('#csvGo').onclick = async () => {
    try { previewTable(el.querySelector('#csvPreview'), await api('/api/import/preview', { method: 'POST', body: { source: 'csv', text: el.querySelector('#csvText').value, defaultPlatform: el.querySelector('#csvPlat').value } })); }
    catch (e) { toast(e.message, 'err'); }
  };
}

function previewTable(el, rows) {
  const LBL = { update: '↻ Actualizar', same: '＝ Igual', new: '＋ No está', skip: '— Sin horas' };
  el.innerHTML = `<h3>Vista previa · ${rows.length} filas</h3>
    <div class="scroll"><table class="tbl"><thead><tr><th></th><th>Importado</th><th>Coincide con</th><th class="num">Ahora</th><th class="num">Nuevo</th><th>Acción</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" ${r.action === 'update' ? 'checked' : ''} ${r.action === 'skip' || r.action === 'same' ? 'disabled' : ''}></td>
      <td>${esc(r.title)}<br><small style="color:var(--muted)">${esc(r.platform || '')}</small></td>
      <td>${r.match ? `${esc(r.match.title)} <small style="color:var(--muted)">${Math.round(r.match.score * 100)}%</small>` : '<small style="color:var(--muted)">—</small>'}</td>
      <td class="num">${r.match ? fmtH(r.match.hours) : ''}</td><td class="num">${r.hours != null ? fmtH(r.hours) : '—'}</td><td>${LBL[r.action]}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row" style="margin-top:12px">
      <label><input type="radio" name="mode" value="max" checked> Solo subir horas (nunca bajar)</label>
      <label><input type="radio" name="mode" value="overwrite"> Sobrescribir</label>
      <label><input type="checkbox" id="pvCreate"> Añadir al catálogo los marcados que no estén</label>
      <span class="spacer"></span><button class="btn primary" id="pvApply">Aplicar</button></div>`;
  el.querySelector('#pvApply').onclick = async () => {
    const items = [...el.querySelectorAll('input[data-i]:checked')].map(c => rows[+c.dataset.i]);
    const r = await api('/api/import/apply', { method: 'POST', body: { items, mode: el.querySelector('[name=mode]:checked').value, createMissing: el.querySelector('#pvCreate').checked } });
    state.games = await api('/api/games'); render(true);
    toast(`✔ ${r.updated} actualizados · ${r.created} añadidos`, 'ok');
    el.innerHTML = '';
  };
}

// ---------------------------------------------------------------- Configuración de editor + QR
let QR = null;
async function qrDataUrl(text) {
  QR ??= (await import('https://esm.sh/qrcode@1.5.4')).default;
  return QR.toDataURL(text, { width: 640, margin: 2, errorCorrectionLevel: 'L', color: { dark: '#0b0d17', light: '#ffffff' } });
}

function openSetup() {
  const c = getCreds();
  const tokenUrl = 'https://github.com/settings/personal-access-tokens/new';
  const mask = v => (v ? '••••••••••••' + esc(v.slice(-4)) : '');
  const body = openModal(`<h2>🔑 Configurar modo editor</h2>
    <p class="lead">Tu catálogo se guarda en el repositorio <b>${esc(REPO.owner)}/${esc(REPO.repo)}</b> de GitHub. Para editar hace falta un token limitado a ese repositorio. Se configura <b>una sola vez</b>: después generas el QR y el resto de dispositivos entran escaneándolo.</p>
    <div class="callout" style="margin-bottom:14px"><b>Crear el token (2 minutos):</b><br>
      1. Abre <a href="${tokenUrl}" target="_blank" rel="noopener">GitHub → Fine-grained personal access token</a>.<br>
      2. <b>Repository access</b> → <i>Only select repositories</i> → <code>${esc(REPO.repo)}</code>.<br>
      3. <b>Permissions</b> → <i>Contents</i> → <b>Read and write</b> (nada más).<br>
      4. Elige caducidad (p. ej. 1 año) → <i>Generate token</i> → cópialo y pégalo aquí.</div>
    <div class="form">
      <label class="full">Token de GitHub<input type="text" id="suGh" autocomplete="off" spellcheck="false" placeholder="github_pat_…" value="${mask(c.gh)}"></label>
      <label class="full">Clave de Claude (opcional: identificar juegos por foto)<input type="text" id="suAk" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${mask(c.ak)}"></label>
    </div>
    <p style="color:var(--muted);font-size:12px;margin-top:10px">Las claves se guardan solo en este navegador; nunca se suben al repositorio. Pon un límite de gasto a la clave de Claude en console.anthropic.com.</p>
    <div class="row end" style="margin-top:12px">${c.gh ? '<button class="btn ghost danger" id="suOut">Salir del modo editor aquí</button><span class="spacer"></span>' : ''}<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="suSave">Guardar y verificar</button></div>`);
  body.querySelector('#suOut')?.addEventListener('click', async () => {
    clearCreds(); await load();
    state.me = await api('/api/me'); state.games = await api('/api/games');
    closeModal(); applyMode(); render(); toast('Ahora estás en solo lectura');
  });
  body.querySelector('#suSave').onclick = async () => {
    const ghv = body.querySelector('#suGh').value.trim(), akv = body.querySelector('#suAk').value.trim();
    const btn = body.querySelector('#suSave');
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      if (!ghv && !c.gh) throw new Error('Falta el token de GitHub');
      await saveCreds({ gh: ghv.startsWith('••') ? undefined : ghv, ak: akv.startsWith('••') ? undefined : akv });
      state.me = await api('/api/me'); state.games = await api('/api/games');
      applyMode(); render(); toast('✏️ Modo editor activado', 'ok');
      openQR('editor');
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Guardar y verificar'; }
  };
}

async function openQR(kind = 'editor') {
  if (kind === 'editor' && !state.me.editor) return openSetup();
  const hasClaude = !!getCreds().ak;
  const withClaude = kind === 'editor' && hasClaude && localStorage.getItem('gs_qr_claude') !== '0';
  const url = kind === 'editor' ? editorLink(withClaude) : publicUrl();
  const dataUrl = await qrDataUrl(url);
  const body = openModal(`<h2>${kind === 'editor' ? 'QR de editor' : 'QR de invitado'}</h2>
    <p class="lead">${kind === 'editor' ? 'Quien lo escanee entra directamente en <b>modo edición</b>, sin contraseñas. Guárdalo solo para ti.' : 'Para compartir: abre el catálogo en <b>solo lectura</b> desde cualquier sitio.'}</p>
    <div class="qr-wrap">
      <img src="${dataUrl}" alt="Código QR">
      <div>
        <div class="tabs no-print"><button class="${kind === 'editor' ? 'on' : ''}" data-k="editor">✏️ Editor</button><button class="${kind === 'guest' ? 'on' : ''}" data-k="guest">👀 Invitado</button></div>
        <div class="url-box">${kind === 'editor' ? esc(url.split('#')[0]) + '#k=••••••' : esc(url)}</div>
        ${kind === 'editor' && hasClaude ? `<label class="no-print" style="display:block;margin-top:10px;font-size:13px"><input type="checkbox" id="qrClaude" ${withClaude ? 'checked' : ''}> Incluir también la clave de Claude (para escanear juegos desde el móvil)</label>` : ''}
        <div class="row no-print" style="margin-top:12px"><button class="btn sm" id="qrCopy">Copiar enlace</button><button class="btn sm" id="qrPrint">🖨 Imprimir</button><a class="btn sm" download="gameshelf-${kind}.png" href="${dataUrl}">⬇ PNG</a></div>
        <div class="callout no-print" style="margin-top:14px">🌍 Funciona desde cualquier red: la app está publicada en GitHub Pages.${kind === 'editor' ? '<br>🔐 El QR contiene tu token. Si se filtra, <b>bórralo en GitHub</b> (Settings → Developer settings → Fine-grained tokens) y el QR deja de funcionar al instante; después crea uno nuevo en 🔑 Configuración.' : ''}</div>
        ${kind === 'editor' ? '<div class="row no-print" style="margin-top:12px"><button class="btn sm" id="qrSetup">🔑 Configuración</button><button class="btn sm ghost" id="qrBackup">💾 Copia de seguridad</button></div>' : ''}
      </div>
    </div>`);
  body.querySelectorAll('[data-k]').forEach(b => b.onclick = () => openQR(b.dataset.k));
  body.querySelector('#qrClaude')?.addEventListener('change', e => { localStorage.setItem('gs_qr_claude', e.target.checked ? '1' : '0'); openQR('editor'); });
  body.querySelector('#qrCopy').onclick = async () => { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'ok'); };
  body.querySelector('#qrPrint').onclick = () => print();
  body.querySelector('#qrSetup')?.addEventListener('click', openSetup);
  body.querySelector('#qrBackup')?.addEventListener('click', exportJSON);
}

// ---------------------------------------------------------------- Estadísticas
function openStats() {
  const g = state.games;
  const total = g.reduce((a, x) => a + (x.hours || 0), 0);
  const done = g.filter(x => ['completado', 'masterizado'].includes(x.status));
  const byPlat = {};
  for (const x of g) { const p = (byPlat[x.platform] ||= { n: 0, h: 0 }); p.n++; p.h += x.hours || 0; }
  const plats = Object.entries(byPlat).sort((a, b) => b[1].n - a[1].n);
  const maxN = Math.max(...plats.map(p => p[1].n));
  const maxH = Math.max(...plats.map(p => p[1].h), 1);
  const top = [...g].sort((a, b) => b.hours - a.hours).slice(0, 8);
  const genres = {};
  g.forEach(x => (x.genres || []).forEach(ge => genres[ge] = (genres[ge] || 0) + 1));
  const topGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const decades = {};
  g.forEach(x => { if (x.year) { const d = Math.floor(x.year / 10) * 10; decades[d] = (decades[d] || 0) + 1; } });
  const avgDone = done.filter(x => x.hours > 0);
  const avgH = avgDone.length ? avgDone.reduce((a, x) => a + x.hours, 0) / avgDone.length : 20;
  const backlog = g.filter(x => x.status === 'pendiente').length;
  const fav = plats.slice().sort((a, b) => b[1].h - a[1].h)[0];
  const tile = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  const body = openModal(`<h2>Tu colección en números</h2><p class="lead">${g.length} juegos, ${Math.round(total).toLocaleString('es')} horas — eso son ${(total / 24).toFixed(1).replace('.', ',')} días seguidos jugando.</p>
    <div class="stats-grid">
      ${tile(g.length, 'juegos')}${tile(Math.round(total).toLocaleString('es') + ' h', 'horas totales')}
      ${tile(Math.round(done.length / Math.max(1, g.length) * 100) + '%', 'completados')}${tile(g.filter(x => x.status === 'masterizado').length, 'masterizados 100%')}
      ${tile(fmtH(avgH), 'media por juego terminado')}${tile('≈ ' + Math.round(backlog * avgH).toLocaleString('es') + ' h', `para vaciar el backlog (${backlog})`)}
      ${tile(g.filter(x => x.format === 'fisico' || x.format === 'especial').length + ' / ' + g.filter(x => x.format === 'digital').length, 'físicos / digitales')}
      ${tile(fav ? esc(fav[0]) : '—', 'consola con más horas')}
    </div>
    <h3>Estados</h3>
    <div class="stack">${Object.entries(STATUS).map(([k, s]) => { const n = g.filter(x => x.status === k).length; return n ? `<i style="flex:${n};background:${s.color}" title="${s.label}: ${n}"></i>` : ''; }).join('')}</div>
    <div class="legend">${Object.entries(STATUS).map(([k, s]) => `<span><i style="background:${s.color}"></i>${s.label} · ${g.filter(x => x.status === k).length}</span>`).join('')}</div>
    <div class="two-col">
      <div><h3>Juegos por consola</h3>${plats.map(([p, v]) => `<div class="hbar"><span>${esc(p)}</span><div class="track"><i style="width:${v.n / maxN * 100}%;background:${platStyle(p).c}"></i></div><span class="v">${v.n}</span></div>`).join('')}</div>
      <div><h3>Horas por consola</h3>${plats.slice().sort((a, b) => b[1].h - a[1].h).map(([p, v]) => `<div class="hbar"><span>${esc(p)}</span><div class="track"><i style="width:${v.h / maxH * 100}%;background:${platStyle(p).c}"></i></div><span class="v">${fmtH(v.h)}</span></div>`).join('')}</div>
    </div>
    <div class="two-col">
      <div><h3>Top por horas</h3><ol class="top-list">${top.map(x => `<li data-id="${x.id}"><img alt="" ${coverSrc(x)}>${esc(x.title)}<span class="h">${fmtH(x.hours)}</span></li>`).join('')}</ol></div>
      <div><h3>Géneros favoritos</h3>${topGenres.map(([ge, n]) => `<div class="hbar"><span>${esc(ge)}</span><div class="track"><i style="width:${n / topGenres[0][1] * 100}%;background:var(--accent)"></i></div><span class="v">${n}</span></div>`).join('')}
        <h3>Por década</h3>${Object.entries(decades).sort().map(([d, n]) => `<div class="hbar"><span>${d}s</span><div class="track"><i style="width:${n / Math.max(...Object.values(decades)) * 100}%;background:var(--accent2)"></i></div><span class="v">${n}</span></div>`).join('')}</div>
    </div>`, { wide: true });
  body.querySelectorAll('.top-list li').forEach(li => li.onclick = () => openDetail(state.games.find(x => x.id === +li.dataset.id)));
}

// ---------------------------------------------------------------- Al azar
function openRandom() {
  const plats = [...new Set(state.games.map(g => g.platform))].sort((a, b) => platOrder(a) - platOrder(b));
  const body = openModal(`<h2>¿A qué juego?</h2><p class="lead">Deja que el destino decida.</p>
    <div class="row" style="justify-content:center;margin-bottom:10px">
      <select id="rPlat"><option value="">Cualquier consola</option>${plats.map(p => `<option>${esc(p)}</option>`).join('')}</select>
      <select id="rStatus"><option value="backlog">Pendientes y jugando</option><option value="pendiente">Solo pendientes</option><option value="jugando">Solo jugando</option><option value="replay">Rejugar un completado</option><option value="">Cualquiera</option></select>
      <select id="rLen"><option value="">Cualquier duración</option><option value="short">Algo corto (&lt; 15 h)</option><option value="long">Un viaje largo</option></select>
    </div>
    <div class="slot" id="slot"><div class="cover"><img alt="" src="${fallbackCover({ title: '?', platform: '' })}"></div><h2 id="slotTitle">&nbsp;</h2><p id="slotSub" style="color:var(--muted);margin:0">&nbsp;</p></div>
    <div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary" id="rGo">🎲 Tirar</button><button class="btn" id="rOpen" hidden>Ver ficha</button>${editor() ? '<button class="btn" id="rPlay" hidden>▶ ¡A jugar! (marcar “Jugando”)</button>' : ''}</div>`);
  // Duración estimada: horas reales si las hay; si no, media de su género principal.
  const est = g => g.hours || 20;
  let pick = null;
  body.querySelector('#rGo').onclick = () => {
    const p = body.querySelector('#rPlat').value, s = body.querySelector('#rStatus').value, len = body.querySelector('#rLen').value;
    const pool = state.games.filter(g => (!p || g.platform === p)
      && (s === '' || (s === 'backlog' ? ['pendiente', 'jugando'].includes(g.status) : s === 'replay' ? ['completado', 'masterizado'].includes(g.status) : g.status === s))
      && (!len || (len === 'short' ? est(g) < 15 : est(g) >= 30) || g.status === 'pendiente'));
    if (!pool.length) return toast('Nada que cumpla esos filtros', 'err');
    const slot = body.querySelector('#slot');
    slot.classList.add('spinning');
    body.querySelector('#rGo').disabled = true;
    let i = 0, delay = 50;
    const spin = () => {
      pick = pool[Math.floor(Math.random() * pool.length)];
      slot.querySelector('.cover').innerHTML = `<img alt="" ${coverSrc(pick)}>`;
      wireCovers(slot);
      body.querySelector('#slotTitle').textContent = pick.title;
      body.querySelector('#slotSub').textContent = `${pick.platform} · ${fmtDate(pick)} · ${STATUS[pick.status].label}`;
      if (++i < 16) { delay *= 1.17; setTimeout(spin, delay); }
      else {
        slot.classList.remove('spinning');
        body.querySelector('#rGo').disabled = false;
        body.querySelector('#rGo').textContent = '🎲 Otra vez';
        body.querySelector('#rOpen').hidden = false;
        body.querySelector('#rPlay')?.removeAttribute('hidden');
      }
    };
    spin();
  };
  body.querySelector('#rOpen').onclick = () => pick && openDetail(pick);
  body.querySelector('#rPlay')?.addEventListener('click', async () => { if (pick) { const u = await patchGame(pick.id, { status: 'jugando' }, `¡A jugar a ${pick.title}!`); openDetail(u); } });
}

boot().catch(e => { console.error(e); toast('Error cargando el catálogo: ' + e.message, 'err'); });
