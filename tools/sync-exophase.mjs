// Sincroniza horas de Exophase → data/games.json
// Uso: node tools/sync-exophase.mjs <exophase.json>
//   <exophase.json> = {"games":[{id,title,platform,playtime:"22h 49m",last_played,status,percent}...]}
//   (lo genera tools/exophase-extract.js ejecutado en la página de perfil de Exophase)
// Reglas:
// · Solo toca juegos que YA están en el catálogo (el catálogo se alimenta con fotos) y de Switch / Switch 2
//   (el Exophase de este usuario solo tiene la cuenta de Nintendo Switch).
// · Empareja por título y por alt_title (título inglés): "Pokémon Espada" ↔ "Pokémon Sword".
// · Recopilatorios: si el juego tiene exophase_titles: [...], suma las horas de todos ellos.
// · Las horas de Exophase mandan sobre las manuales.
// · Estado: "complete" en Exophase → completado; con ≥1 h y "pendiente" → jugando. Nunca rebaja "masterizado".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { similarity, normTitle, parseHours, round1 } from '../js/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/games.json');
const SNAPSHOT = path.join(ROOT, 'data/exophase.json');
const SYNC_PLATFORMS = new Set(['Nintendo Switch', 'Nintendo Switch 2']);

const src = process.argv[2];
if (!src) { console.error('Uso: node tools/sync-exophase.mjs <exophase.json>'); process.exit(1); }
const exo = (JSON.parse(fs.readFileSync(src, 'utf8')).games || [])
  .filter(g => g.title)
  .map(g => ({ ...g, hours: parseHours(g.playtime) ?? 0 }));
if (!exo.length) { console.error('La instantánea de Exophase está vacía: no toco nada.'); process.exit(1); }

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const clean = t => normTitle(String(t).replace(/[’`´]/g, "'").replace(/\s[–-]\s?nintendo switch 2 edition/i, '').replace(/\bdemo( version)?\b/gi, ''));

function match(game) {
  if (Array.isArray(game.exophase_titles)) {
    const parts = game.exophase_titles.map(t => exo.find(e => clean(e.title) === clean(t))).filter(Boolean);
    return parts.length ? parts : null;
  }
  if (game.exophase_id) { const byId = exo.find(e => String(e.id) === String(game.exophase_id)); if (byId) return [byId]; }
  let best = null;
  for (const e of exo) {
    for (const t of [game.title, game.alt_title].filter(Boolean)) {
      const s = clean(e.title) === clean(t) ? 1 : similarity(clean(e.title), clean(t));
      if (!best || s > best.s) best = { e, s };
    }
  }
  return best && best.s >= 0.9 ? [best.e] : null;
}

const changes = [], notFound = [];
const today = new Date().toISOString().replace('T', ' ').slice(0, 19);
for (const g of catalog.games) {
  if (!SYNC_PLATFORMS.has(g.platform)) continue;
  const m = match(g);
  if (!m) { notFound.push(g.title); g.in_exophase = false; continue; }
  const before = { hours: g.hours || 0, status: g.status };
  const hours = round1(m.reduce((a, e) => a + e.hours, 0));
  const last = m.map(e => e.last_played).filter(Boolean).sort().pop() || null;
  const upd = { in_exophase: true, exophase_id: m.map(e => String(e.id)).join('+'), exophase_title: m.map(e => e.title).join(' + ') };
  if (hours > 0) Object.assign(upd, { hours, hours_source: 'exophase' });
  if (last && (!g.last_played || last > g.last_played)) upd.last_played = last;
  if (g.status !== 'masterizado') {
    if (m.every(e => e.status === 'complete')) upd.status = 'completado';
    else if (g.status === 'pendiente' && hours >= 1) upd.status = 'jugando';
  }
  const diff = Object.keys(upd).filter(k => JSON.stringify(g[k]) !== JSON.stringify(upd[k]));
  if (diff.length) {
    Object.assign(g, upd, { updated_at: today });
    const bits = [];
    if (diff.includes('hours')) bits.push(`${before.hours} h → ${hours} h`);
    if (diff.includes('status')) bits.push(`${before.status} → ${upd.status}`);
    changes.push(`${g.title}: ${bits.join(', ') || 'enlazado'}`);
  }
}

fs.writeFileSync(SNAPSHOT, JSON.stringify({ synced_at: new Date().toISOString(), games: exo.map(({ hours, ...e }) => e) }, null, 1));
if (changes.length) {
  catalog.updated_at = new Date().toISOString();
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1));
}
const linked = new Set(catalog.games.flatMap(g => String(g.exophase_id || '').split('+')).filter(Boolean));
const exoOnly = exo.filter(e => !linked.has(String(e.id)) && e.hours >= 1);
console.log(`Exophase: ${exo.length} juegos · catálogo: ${catalog.games.length}`);
console.log(`Cambios (${changes.length}):${changes.length ? '\n  ' + changes.join('\n  ') : ' ninguno'}`);
console.log(`Switch del catálogo que no están en Exophase (${notFound.length}):${notFound.length ? '\n  ' + notFound.join('\n  ') : ' ninguno'}`);
console.log(`En Exophase (≥1 h) pero no en el catálogo (${exoOnly.length}): ${exoOnly.map(e => e.title).join(' · ')}`);
