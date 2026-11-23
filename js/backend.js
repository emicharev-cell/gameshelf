// "Servidor" de GameShelf sobre GitHub.
// · Lectura (todos): data/games.json servido por GitHub Pages.
// · Escritura (editor): la API de GitHub hace un commit de data/games.json con un token
//   de acceso fine-grained limitado a ESTE repositorio (permiso Contents: read & write).
// · El token llega en el fragmento (#k=...) del QR: el fragmento nunca se envía a ningún servidor,
//   se guarda en localStorage del dispositivo y se borra de la barra de direcciones.
// Expone api(url, {method, body}) con las mismas rutas que tenía el servidor Node, para que la UI no cambie.
import { normalizePlatform, normTitle, bestMatch, round1, parseHours } from './util.js?v=202611232209';
import { parseCSV, parseRetroArch, parseExophase } from './importers.js?v=202611232209';
import { searchCovers } from './covers.js?v=202611232209';
import { identifyItem, identifyShelf, setVisionKey, visionAvailable } from './vision.js?v=202611232209';

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
  if (!r.ok) throw err(r.status === 401 ? 'El token de GitHub no es válido o ha caducado.' : data.message || `GitHub ${r.status}`, r.status);
  return data;
}

// ---------------------------------------------------------------- Sesión de editor
export const hasCreds = () => !!creds.gh;
export const getCreds = () => ({ ...creds });

/** Comprueba que el token puede escribir en el repo. */
export async function verifyToken(token) {
  const repo = await gh('', { token });
  if (!repo.permissions?.push) throw err('Ese token no tiene permiso de escritura en el repositorio.', 403);
  return true;
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
      games = JSON.parse(text).games || [];
      verified = true;
      return games;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { verified = false; console.warn(e.message); }
      else throw e;
    }
  }
  // Invitado (o token inválido): copia publicada en GitHub Pages
  const r = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
  games = (await r.json()).games || [];
  return games;
}

let saveTimer = null, saving = Promise.resolve(), pendingMsg = new Set();
export let onSaveState = () => {};
export function setSaveListener(fn) { onSaveState = fn; }

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
    content: b64encode(JSON.stringify({ version: 1, updated_at: new Date().toISOString(), games }, null, 1)),
    sha, branch: REPO.branch,
  });
  onSaveState('saving');
  try {
    let res;
    try { res = await gh(`/contents/${DATA_PATH}`, { method: 'PUT', body: body() }); }
    catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      // Alguien guardó desde otro dispositivo: tomamos el sha nuevo y gana la última escritura.
      sha = (await gh(`/contents/${DATA_PATH}?ref=${REPO.branch}`)).sha;
      res = await gh(`/contents/${DATA_PATH}`, { method: 'PUT', body: body() });
    }
    sha = res.content.sha;
    onSaveState('saved');
  } catch (e) {
    onSaveState('error', e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- Modelo
function clean(input) {
  const out = {};
  const F = ['title', 'platform', 'year', 'release_eu', 'genres', 'developer', 'publisher', 'format', 'edition', 'region', 'status', 'rating', 'hours', 'hours_source', 'notes', 'cover_url', 'cover_local', 'exophase_id', 'last_played', 'added_at'];
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
  return game;
}

function update(id, input) {
  const g = get(id);
  if (!g) throw err('No encontrado', 404);
  Object.assign(g, clean(input), { updated_at: now() });
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
async function setCover(id, url) {
  const g = update(id, { cover_url: url || null, cover_local: null });
  if (url) {
    try {
      const r = await fetch(url);
      const type = r.headers.get('content-type') || '';
      if (r.ok && type.startsWith('image/')) {
        const blob = await r.blob();
        if (blob.size < 8 * 1024 * 1024) {
          const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
          const path = `covers/${id}-${Date.now().toString(36)}.${ext}`;
          await gh(`/contents/${path}`, { method: 'PUT', body: { message: `GameShelf: carátula de ${g.title}`, content: await blobToB64(blob), branch: REPO.branch } });
          g.cover_local = path;
        }
      }
    } catch (e) { console.warn('No se pudo copiar la carátula, se usará la URL:', e.message); }
  }
  await scheduleSave(`carátula de ${g.title}`);
  return g;
}

async function autoCovers(list) {
  for (const g of list) {
    if (g.cover_url || g.cover_local) continue;
    try {
      const found = await searchCovers(g.title, g.platform);
      const best = found.find(c => c.score >= 0.6);
      if (best) await setCover(g.id, best.cover);
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
  if (id && p.endsWith('/cover')) return setCover(id, body.url);
  if (id && method === 'PATCH') {
    const b = { ...body };
    if (b.hours !== undefined && b.hours_source === undefined) b.hours_source = 'manual';
    const g = update(id, b);
    scheduleSave(`editado ${g.title}`);
    return g;
  }
  if (id && method === 'DELETE') {
    const g = get(id); if (!g) throw err('No encontrado', 404);
    games = games.filter(x => x.id !== id);
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
