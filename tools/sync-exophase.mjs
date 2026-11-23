// Sincroniza horas de Exophase → data/games.json
// Uso: node tools/sync-exophase.mjs <exophase.json>
//   <exophase.json> = {"games":[{id,title,platform,playtime:"22h 49m",last_played:"2026-11-19"}...]}
//   (lo genera tools/exophase-extract.js ejecutado en la página de perfil de Exophase)
// · Solo actualiza juegos que YA están en el catálogo (el catálogo se alimenta con fotos).
// · Guarda la instantánea en data/exophase.json para saber qué juegos están en Exophase.
// · Imprime un resumen; código de salida 0 siempre que el JSON sea válido.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { similarity, normTitle, parseHours, round1 } from '../js/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/games.json');
const SNAPSHOT = path.join(ROOT, 'data/exophase.json');
const NINTENDO = /switch|nintendo|wii|3ds|ds|gamecube|game boy|snes|nes|64/i;

const src = process.argv[2];
if (!src) { console.error('Uso: node tools/sync-exophase.mjs <exophase.json>'); process.exit(1); }
const exo = (JSON.parse(fs.readFileSync(src, 'utf8')).games || [])
  .filter(g => g.title)
  .map(g => ({ ...g, hours: parseHours(g.playtime) ?? 0 }));
if (!exo.length) { console.error('La instantánea de Exophase está vacía: no toco nada.'); process.exit(1); }

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const clean = t => normTitle(String(t).replace(/[’`´]/g, "'").replace(/\b(demo( version)?|nintendo switch 2 edition)\b/gi, ''));

function find(game) {
  // 1) id de Exophase ya enlazado  2) título normalizado idéntico  3) similitud alta
  if (game.exophase_id) { const byId = exo.find(e => String(e.id) === String(game.exophase_id)); if (byId) return { e: byId, score: 1 }; }
  let best = null;
  for (const e of exo) {
    let s = clean(e.title) === clean(game.title) ? 1 : similarity(clean(e.title), clean(game.title));
    if (!NINTENDO.test(game.platform || '')) s -= 0.15; // Exophase de este usuario = Nintendo
    if (!best || s > best.score) best = { e, score: s };
  }
  return best && best.score >= 0.86 ? best : null;
}

const changes = [], notFound = [];
for (const g of catalog.games) {
  const m = find(g);
  if (!m) { notFound.push(g.title); if (g.in_exophase !== false) { g.in_exophase = false; } continue; }
  const { e } = m;
  const before = g.hours || 0;
  const hours = round1(e.hours);
  const upd = { in_exophase: true, exophase_id: String(e.id), exophase_title: e.title };
  if (hours > 0) Object.assign(upd, { hours, hours_source: 'exophase' }); // Exophase manda sobre las horas manuales
  if (e.last_played && (!g.last_played || e.last_played > g.last_played)) upd.last_played = e.last_played;
  const diff = Object.keys(upd).filter(k => JSON.stringify(g[k]) !== JSON.stringify(upd[k]));
  if (diff.length) {
    Object.assign(g, upd, { updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
    changes.push(`${g.title}: ${diff.includes('hours') ? `${before} h → ${hours} h` : 'enlazado'}`);
  }
}

fs.writeFileSync(SNAPSHOT, JSON.stringify({ synced_at: new Date().toISOString(), games: exo.map(({ hours, ...e }) => e) }, null, 1));
if (changes.length) {
  catalog.updated_at = new Date().toISOString();
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1));
}
console.log(`Exophase: ${exo.length} juegos · catálogo: ${catalog.games.length}`);
console.log(`Cambios (${changes.length}):${changes.length ? '\n  ' + changes.join('\n  ') : ' ninguno'}`);
console.log(`En el catálogo pero no en Exophase (${notFound.length}):${notFound.length ? '\n  ' + notFound.join('\n  ') : ' ninguno'}`);
