// "Servidor" de GameShelf sobre GitHub.
// · Lectura (todos): data/games.json servido por GitHub Pages.
// · Escritura (editor): la API de GitHub hace un commit de data/games.json con un token
//   de acceso fine-grained limitado a ESTE repositorio (permiso Contents: read & write).
// · El token llega en el fragmento (#k=...) del QR: el fragmento nunca se envía a ningún servidor,
//   se guarda en localStorage del dispositivo y se borra de la barra de direcciones.
// Expone api(url, {method, body}) con las mismas rutas que tenía el servidor Node, para que la UI no cambie.
import { normalizePlatform, normTitle, bestMatch, round1, parseHours } from './util.js?v=202611262005';
import { parseCSV, parseRetroArch, parseExophase } from './importers.js?v=202611262005';
import { searchCovers } from './covers.js?v=202611262005';
import { identifyItem, identifyShelf, setVisionKey, visionAvailable } from './vision.js?v=202611262005';

// ---------------------------------------------------------------- Configuración del repo
const DEFAULT = { owner: 'emicharev-cell', repo: 'gameshelf', branch: 'main' };
export const REPO = (() => {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m && seg ? { ...DEFAULT, owner: m[1], repo: seg } : DEFAULT;
})();
const DATA_PATH = 'data/games.json';
const GH = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}`;

let creds = JSON.parse(localStorage.getItem('gs_creds') || '{}'); // { gh, ak }
setVisionKey(creds.ak);
let verified = false;
let games = [];
let retro = [];          // apps retro (NSO / Nintendo Classics) con sus juegos detallados
let retroDirty = false;
let sha = null;

const STATUSES = ['jugando', 'pendiente', 'completado', 'masterizado'];
const FORMATS = ['fisico', 'digital', 'especial'];

// ---------------------------------------------------------------- Utilidades
const err = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, data: extra }, extra);
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gh(path, { method = 'GET', body, token = creds.gh } = {}) {
  const r = await fetch(`${GH}${path}`, {
    method,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const noWrite = r.status === 403 || (r.status === 404 && method !== 'GET');
    const msg = r.status === 401 ? 'El token de GitHub no es válido o ha caducado.'
      : noWrite ? `Tu token de GitHub no tiene permiso de escritura en "${REPO.repo}". Crea uno nuevo con Repository access → ${REPO.repo} y Permissions → Contents: Read and write, y pégalo en 🔑 Configuración.`
      : data.message || `GitHub ${r.status}`;
    throw err(msg, r.status);
  }
  return data;
}

// ---------------------------------------------------------------- Sesión de editor
export const hasCreds = () => !!creds.gh;
export const getCreds = () => ({ ...creds });

/** Comprueba que el token puede escribir en el repo. */
export async function verifyToken(token) {
  const repo = await gh('', { token });
  if (!repo.permissions?.push) throw err('Ese token no tiene permiso de escritura en el repositorio.', 403);
  // "permissions" refleja tu usuario, no el token: probamos de verdad que el token puede escribir.
  await gh('/git/blobs', { method: 'POST', body: { content: 'gameshelf write check', encoding: 'utf-8' }, token });
  return true;
}

let writeChecked = null;
/** Comprueba (una vez por sesión) que el token guardado puede escribir. */
export function checkWrite() {
  if (!creds.gh) return Promise.resolve(false);
  return (writeChecked ??= verifyToken(creds.gh));
}

export async function saveCreds({ gh: token, ak }) {
  if (token) await verifyToken(token);
  creds = { gh: token || creds.gh, ak: ak === undefined ? creds.ak : ak || undefined };
  localStorage.setItem('gs_creds', JSON.stringify(creds));
  setVisionKey(creds.ak);
  verified = !!creds.gh;
  await load();
}
export function clearCreds() {
  creds = {}; verified = false; setVisionKey(null);
  localStorage.removeItem('gs_creds');
}

/** Lee #k=... del QR (base64url de {gh, ak}), lo guarda y limpia la URL. */
export async function claimFromHash() {
  const m = location.hash.match(/^#k=([A-Za-z0-9_\-+/=]+)/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  let payload;
  try { payload = JSON.parse(b64decode(m[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { throw err('El QR de editor no es válido.'); }
  await saveCreds(payload);
  return true;
}

export function editorLink(includeClaude = true) {
  const payload = { gh: creds.gh, ...(includeClaude && creds.ak ? { ak: creds.ak } : {}) };
  const k = b64encode(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${publicUrl()}#k=${k}`;
}
export const publicUrl = () => (location.hostname.endsWith('github.io') ? `${location.origin}/${REPO.repo}/` : location.origin + location.pathname);

// ---------------------------------------------------------------- Carga / guardado
export async function load() {
  if (creds.gh) {
    try {
      const f = await gh(`/contents/${DATA_PATH}?ref=${REPO.branch}`);
      sha = f.sha;
      const text = f.content ? b64decode(f.content) : await (await fetch(f.download_url, { cache: 'no-store' })).text();
      const parsed = JSON.parse(text);
      games = parsed.games || [];
      retro = parsed.retro || [];
      verified = true;
      return games;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { verified = false; console.warn(e.message); }
      else throw e;
    }
  }
  // Invitado (o token inválido): copia publicada en GitHub Pages
  const r = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
  const parsed = await r.json();
  games = parsed.games || [];
  retro = parsed.retro || [];
  return games;
}

let saveTimer = null, saving = Promise.resolve(), pendingMsg = new Set();
// Cambios locales pendientes de subir, campo a campo, para poder fusionarlos si otra persona/dispositivo
// (o un script) ha guardado mientras tanto: así nunca se pisan cambios ajenos.
const dirty = new Map();      // id → Set(campos modificados)
const created = new Set();    // ids creados aquí
const deleted = new Set();    // ids borrados aquí
const markDirty = (id, fields) => { if (!dirty.has(id)) dirty.set(id, new Set()); fields.forEach(f => dirty.get(id).add(f)); };

/** Aplica los cambios locales (snapshot) sobre la versión remota más reciente. */
function mergeInto(remoteGames, snap, local) {
  const out = remoteGames.filter(r => !snap.deleted.has(r.id)).map(r => ({ ...r }));
  for (const [id, fields] of snap.dirty) {
    if (snap.created.has(id)) continue;
    const l = local.find(x => x.id === id), r = out.find(x => x.id === id);
    if (!l || !r) continue;                       // borrado en remoto: respetamos el borrado
    for (const f of fields) r[f] = l[f];
    r.updated_at = l.updated_at;
  }
  for (const id of snap.created) {
    const l = local.find(x => x.id === id);
    if (!l) continue;
    const g = { ...l };
    if (out.some(x => x.id === g.id)) g.id = out.reduce((m, x) => Math.max(m, x.id), 0) + 1; // id ocupado en remoto
    out.push(g);
  }
  return out;
}
export let onSaveState = () => {};
export function setSaveListener(fn) { onSaveState = fn; }

/** Guarda inmediatamente y devuelve la promesa del commit (lanza si falla). */
function saveNow(msg) {
  pendingMsg.add(msg);
  clearTimeout(saveTimer);
  const p = saving.catch(() => {}).then(flush);
  saving = p.catch(() => {});
  return p;
}

/** Agrupa cambios seguidos (p. ej. varios +1h) en un solo commit. */
function scheduleSave(msg) {
  pendingMsg.add(msg);
  onSaveState('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saving = saving.then(flush).catch(() => {}); }, 1200);
  return saving;
}

async function flush() {
  const msgs = [...pendingMsg]; pendingMsg.clear();
  const message = msgs.length === 1 ? msgs[0] : `${msgs.length} cambios: ${msgs.slice(0, 3).join(' · ')}${msgs.length > 3 ? '…' : ''}`;
  const body = () => ({
    message: `GameShelf: ${message}`.slice(0, 200),
    content: b64encode(JSON.stringify({ version: 1, updated_at: new Date().toISOString(), games, retro }, (k, v) => (k === 'cover_preview' ? undefined : v), 1)),
    sha, branch: REPO.branch,
  });
  onSaveState('saving');
  const snap = { dirty: new Map([...dirty].map(([k, v]) => [k, new Set(v)])), created: new Set(created), deleted: new Set(deleted), retro: retroDirty };
  dirty.clear(); created.clear(); deleted.clear(); retroDirty = false;
  try {
    let res;
    for (let attempt = 0; ; attempt++) {
      try { res = await gh(`/contents/${DATA_PATH}`, { method: 'PUT', body: body() }); break; }
      catch (e) {
        if ((e.status !== 409 && e.status !== 422) || attempt >= 3) throw e;
        // Otro dispositivo (o un script) guardó antes: traemos lo último y aplicamos encima SOLO nuestros cambios.
        const f = await gh(`/contents/${DATA_PATH}?ref=${REPO.branch}`);
        const remoteAll = JSON.parse(f.content ? b64decode(f.content) : await (await fetch(f.download_url, { cache: 'no-store' })).text());
        games = mergeInto(remoteAll.games || [], snap, games);
        if (!snap.retro) retro = remoteAll.retro || retro; // si no tocamos retro, nos quedamos con lo remoto (p. ej. horas de Exophase)
        sha = f.sha;
      }
    }
    sha = res.content.sha;
    onSaveState('saved');
    window.dispatchEvent?.(new CustomEvent('gs-games-changed'));
  } catch (e) {
    // devolvemos los cambios a la cola para el siguiente intento
    for (const [k, v] of snap.dirty) markDirty(k, v);
    snap.created.forEach(x => created.add(x)); snap.deleted.forEach(x => deleted.add(x));
    if (snap.retro) retroDirty = true;
    onSaveState('error', e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- Modelo
function clean(input) {
  const out = {};
  const F = ['cover_locked', 'title', 'platform', 'year', 'release_eu', 'genres', 'developer', 'publisher', 'format', 'edition', 'region', 'status', 'rating', 'hours', 'hours_source', 'notes', 'cover_url', 'cover_local', 'exophase_id', 'last_played', 'added_at'];
  for (const f of F) if (input[f] !== undefined) out[f] = input[f];
  if (out.title !== undefined) out.title = String(out.title).trim();
  if (out.platform !== undefined) out.platform = normalizePlatform(out.platform);
  if (out.genres !== undefined) out.genres = (Array.isArray(out.genres) ? out.genres : String(out.genres || '').split(',')).map(s => String(s).trim()).filter(Boolean);
  if (out.year !== undefined) out.year = out.year ? parseInt(out.year, 10) || null : null;
  if (out.hours !== undefined) out.hours = Math.max(0, Math.round((parseHours(out.hours) ?? 0) * 10000) / 10000);
  if (out.release_eu !== undefined) { out.release_eu = /^\d{4}-\d{2}-\d{2}$/.test(out.release_eu || '') ? out.release_eu : null; if (out.release_eu) out.year = +out.release_eu.slice(0, 4); }
  if (out.rating !== undefined) out.rating = out.rating === null || out.rating === '' ? null : Math.max(0, Math.min(5, parseInt(out.rating, 10) || 0));
  if (out.status !== undefined && !STATUSES.includes(out.status)) out.status = 'pendiente';
  if (out.format !== undefined && !FORMATS.includes(out.format)) out.format = 'fisico';
  for (const k of ['developer', 'publisher', 'edition', 'region', 'notes', 'cover_url']) if (out[k] != null) out[k] = String(out[k]).trim() || null;
  return out;
}

const get = id => games.find(g => g.id === id) || null;

function create(input) {
  const g = clean(input);
  if (!g.title) throw err('El título es obligatorio');
  const game = {
    id: games.reduce((m, x) => Math.max(m, x.id), 0) + 1,
    title: g.title, platform: g.platform || 'Otra', year: null, genres: [], developer: null, publisher: null,
    format: 'fisico', edition: null, region: null, status: 'pendiente', rating: null, hours: 0, hours_source: 'manual',
    notes: null, cover_url: null, cover_local: null, exophase_id: null, last_played: null, added_at: now(), updated_at: now(),
    ...g,
  };
  games.push(game);
  created.add(game.id);
  return game;
}

function update(id, input) {
  const g = get(id);
  if (!g) throw err('No encontrado', 404);
  const ch = clean(input);
  Object.assign(g, ch, { updated_at: now() });
  markDirty(id, Object.keys(ch));
  return g;
}

function findDuplicate(title, platform) {
  const nt = normTitle(title), p = normalizePlatform(platform);
  const same = games.find(g => normTitle(g.title) === nt && g.platform === p);
  if (same) return { kind: 'exact', game: same };
  const other = games.find(g => normTitle(g.title) === nt);
  return other ? { kind: 'other_platform', game: other } : null;
}

// ---------------------------------------------------------------- Carátulas
/** Guarda la carátula: intenta subir una copia al repo (covers/) para que nunca se rompa; si no, deja la URL. */
async function setCover(id, url, { lock = true } = {}) {
  const g = get(id);
  if (!g) throw err('No encontrado', 404);
  let blob = null, type = '';
  if (url) {
    try { // muchas webs no dejan descargar sus imágenes desde otra página (CORS): entonces se guarda solo la URL
      const r = await fetch(url);
      type = r.headers.get('content-type') || '';
      if (r.ok && type.startsWith('image/')) blob = await r.blob();
    } catch (e) { console.warn('No se pudo descargar la imagen, se usará la URL:', e.message); }
  }
  let path = null;
  if (blob && blob.size < 8 * 1024 * 1024) {
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    path = `covers/${id}-${Date.now().toString(36)}.${ext}`;
    await gh(`/contents/${path}`, { method: 'PUT', body: { message: `GameShelf: carátula de ${g.title}`, content: await blobToB64(blob), branch: REPO.branch } });
  }
  update(id, { cover_url: url || null, cover_local: path, cover_locked: lock });
  await saveNow(`carátula de ${g.title}`);
  return g;
}

/** Sube una imagen elegida desde el dispositivo (data URL JPEG/PNG) como carátula. */
async function uploadCover(id, dataUrl) {
  const g = get(id);
  if (!g) throw err('No encontrado', 404);
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw err('Imagen no válida');
  const path = `covers/${id}-user-${Date.now().toString(36)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  await gh(`/contents/${path}`, { method: 'PUT', body: { message: `GameShelf: carátula de ${g.title} (subida)`, content: m[2], branch: REPO.branch } });
  update(id, { cover_url: null, cover_local: path, cover_locked: true });
  await saveNow(`carátula de ${g.title}`);
  return g;
}

async function autoCovers(list) {
  for (const g of list) {
    if (g.cover_url || g.cover_local) continue;
    try {
      const found = await searchCovers(g.title, g.platform);
      const best = found.find(c => c.score >= 0.6);
      if (best) await setCover(g.id, best.cover, { lock: false });
    } catch { /* sin carátula: se usa la generada */ }
  }
  window.dispatchEvent(new CustomEvent('gs-games-changed'));
}

// ---------------------------------------------------------------- Importación
function previewImport(rows) {
  return rows.map(r => {
    const m = bestMatch(r.title, r.platform, games, 0.7);
    const action = !m ? 'new' : r.hours == null ? 'skip' : Math.abs((m.game.hours || 0) - r.hours) < 0.05 ? 'same' : 'update';
    return { ...r, match: m ? { id: m.game.id, title: m.game.title, platform: m.game.platform, hours: m.game.hours, score: round1(m.score * 100) / 100 } : null, action };
  });
}
function applyImport(items, { mode = 'max', createMissing = false } = {}) {
  let updated = 0, created = 0;
  for (const it of items) {
    if (it.match?.id && it.hours != null) {
      const cur = get(it.match.id);
      if (!cur) continue;
      const hours = mode === 'overwrite' ? it.hours : Math.max(cur.hours || 0, it.hours);
      update(cur.id, { hours, hours_source: it.source || 'csv', last_played: it.last_played || cur.last_played, exophase_id: it.source === 'exophase' ? it.external_id : cur.exophase_id });
      updated++;
    } else if (!it.match && createMissing) {
      create({ title: it.title, platform: it.platform, hours: it.hours || 0, hours_source: it.source || 'csv', format: 'digital', status: it.hours > 0 ? 'jugando' : 'pendiente', last_played: it.last_played });
      created++;
    }
  }
  return { updated, created };
}

// ---------------------------------------------------------------- Router (mismas rutas que el antiguo servidor)
export async function api(url, { method = 'GET', body = {} } = {}) {
  const u = new URL(url, location.href);
  const p = u.pathname.replace(/^.*\/api\//, '/api/');
  const q = Object.fromEntries(u.searchParams);
  const idm = p.match(/^\/api\/games\/(\d+)/);
  const id = idm ? +idm[1] : null;
  const write = method !== 'GET' && !/^\/api\/import\/preview$/.test(p);
  if (write && !(creds.gh && verified)) throw err('Modo solo lectura: escanea el QR de editor para hacer cambios.', 403);

  if (p === '/api/me') return { editor: !!(creds.gh && verified), vision: visionAvailable(), igdb: false, steamgriddb: false, repo: REPO };
  if (p === '/api/games' && method === 'GET') return games;
  if (p === '/api/retro' && method === 'GET') return retro;
  const rm = p.match(/^\/api\/retro\/([\w-]+)\/games(?:\/(\d+))?(\/cover)?$/);
  if (rm) {
    const emu = retro.find(r => r.id === rm[1]);
    if (!emu) throw err('Emulador no encontrado', 404);
    emu.games ||= [];
    const idx = rm[2] !== undefined ? +rm[2] : null;
    if (rm[3] && method === 'POST' && idx !== null && emu.games[idx]) {
      // imagen propia subida desde el dispositivo
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(body.image || '');
      if (!m) throw err('Imagen no válida');
      const path = `covers/retro/${emu.id}-${Date.now().toString(36)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
      await gh(`/contents/${path}`, { method: 'PUT', body: { message: `GameShelf: imagen de ${emu.games[idx].title}`, content: m[2], branch: REPO.branch } });
      emu.games[idx].cover = path;
      emu.games[idx].cover_preview = body.image; // solo en memoria (no se guarda): se ve al instante hasta que Pages publique la copia
    } else if (method === 'POST' && idx === null) {
      const title = String(body.title || '').trim();
      if (!title) throw err('Falta el nombre del juego');
      const game = { title, hours: Math.max(0, parseHours(body.hours) ?? 0), notes: body.notes || null, cover: null };
      try { // miniatura automática (Wikipedia), copiada al repo para que no se rompa
        const found = await searchCovers(title, emu.platform);
        // la mejor coincidencia; si el título está en español y nada supera el umbral, el primer resultado de la búsqueda
        const best = found.find(c => c.score >= 0.6) || found[0];
        if (best) {
          const r = await fetch(best.thumb || best.cover);
          const type = r.headers.get('content-type') || '';
          if (r.ok && type.startsWith('image/')) {
            const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
            const path = `covers/retro/${emu.id}-${Date.now().toString(36)}.${ext}`;
            await gh(`/contents/${path}`, { method: 'PUT', body: { message: `GameShelf: imagen de ${title}`, content: await blobToB64(await r.blob()), branch: REPO.branch } });
            game.cover = path;
            game.cover_url = best.cover;
          }
        }
      } catch (e) { console.warn('Sin miniatura automática para', title, e.message); }
      emu.games.push(game);
    } else if (method === 'PATCH' && idx !== null && emu.games[idx]) {
      if (body.title !== undefined) emu.games[idx].title = String(body.title).trim() || emu.games[idx].title;
      if (body.hours !== undefined) emu.games[idx].hours = Math.max(0, parseHours(body.hours) ?? 0);
    } else if (method === 'DELETE' && idx !== null && emu.games[idx]) {
      emu.games.splice(idx, 1);
    } else throw err('Petición no válida');
    retroDirty = true;
    await saveNow(`retro: ${emu.title}`);
    return emu;
  }
  if (p === '/api/covers/search') return searchCovers(q.title || '', q.platform || '');

  if (p === '/api/games' && method === 'POST') {
    const { force, ...input } = body;
    const dup = findDuplicate(input.title, input.platform);
    if (dup?.kind === 'exact' && !force) throw err('Ya está en tu catálogo', 409, { duplicate: dup });
    const g = create(input);
    if (input.cover_url) await setCover(g.id, input.cover_url);
    else { scheduleSave(`añadido ${g.title}`); autoCovers([g]); }
    return g;
  }
  if (p === '/api/games/bulk') {
    const created = [], skipped = [];
    for (const input of body.games || []) {
      if (findDuplicate(input.title, input.platform)?.kind === 'exact') { skipped.push({ title: input.title, reason: 'duplicado' }); continue; }
      created.push(create(input));
    }
    if (created.length) { scheduleSave(`añadidos ${created.length} juegos desde foto de estantería`); autoCovers(created); }
    return { created, skipped };
  }
  if (id && p.endsWith('/hours')) {
    const g = get(id); if (!g) throw err('No encontrado', 404);
    const hours = body.set !== undefined ? Number(body.set) : (g.hours || 0) + Number(body.delta || 0);
    update(id, { hours: Math.max(0, hours), hours_source: 'manual', last_played: new Date().toISOString().slice(0, 10) });
    scheduleSave(`horas de ${g.title}: ${round1(g.hours)}`);
    return g;
  }
  if (id && p.endsWith('/cover-upload')) return uploadCover(id, body.image);
  if (id && p.endsWith('/cover')) return setCover(id, body.url);
  if (id && method === 'PATCH') {
    const b = { ...body };
    if (b.hours !== undefined && b.hours_source === undefined) {
      const cur = get(id);
      const nh = parseHours(b.hours);
      // el formulario reenvía las horas aunque no se toquen: solo pasan a "manual" si cambian de verdad
      if (cur && nh != null && Math.abs(nh - (cur.hours || 0)) < 1 / 120) delete b.hours;
      else b.hours_source = 'manual';
    }
    const g = update(id, b);
    scheduleSave(`editado ${g.title}`);
    return g;
  }
  if (id && method === 'DELETE') {
    const g = get(id); if (!g) throw err('No encontrado', 404);
    games = games.filter(x => x.id !== id);
    if (created.has(id)) created.delete(id); else deleted.add(id);
    dirty.delete(id);
    scheduleSave(`borrado ${g.title}`);
    return { ok: true };
  }
  if (p === '/api/vision/identify') {
    const r = await identifyItem(body.images);
    if (!r.found || !r.title) return { result: r, duplicate: null, covers: [] };
    r.platform = normalizePlatform(r.platform);
    const covers = await searchCovers(r.title, r.platform).catch(() => []);
    return { result: r, duplicate: findDuplicate(r.title, r.platform), covers: covers.slice(0, 12) };
  }
  if (p === '/api/vision/shelf') {
    const per = await Promise.all((body.images || []).slice(0, 8).map(img => identifyShelf(img).catch(e => ({ error: e.message }))));
    const errors = per.filter(x => x.error).map(x => x.error);
    const seen = new Set(), detections = [];
    per.forEach((list, photo) => {
      if (!Array.isArray(list)) return;
      for (const d of list) {
        const platform = normalizePlatform(d.platform);
        const key = `${normTitle(d.title)}|${platform}`;
        if (seen.has(key)) continue;
        seen.add(key);
        detections.push({ ...d, platform, photo, duplicate: findDuplicate(d.title, platform) });
      }
    });
    if (!detections.length && errors.length) throw err(errors[0], 502);
    return { detections, errors };
  }
  if (p === '/api/import/preview') {
    const { source, text, files, payload, defaultPlatform } = body;
    const rows = source === 'csv' ? parseCSV(text, defaultPlatform) : source === 'retroarch' ? parseRetroArch(files || []) : parseExophase(payload ?? JSON.parse(text || '[]'));
    return previewImport(rows);
  }
  if (p === '/api/import/apply') {
    const r = applyImport(body.items || [], body);
    if (r.updated || r.created) scheduleSave(`importadas horas (${r.updated} actualizados, ${r.created} nuevos)`);
    return r;
  }
  throw err(`Ruta desconocida: ${method} ${p}`, 404);
}

export function exportJSON() {
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), games }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `gameshelf-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
