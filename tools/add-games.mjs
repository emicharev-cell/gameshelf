// Añade juegos al catálogo desde una lista y descarga su carátula de Wikipedia a covers/.
// Uso: node tools/add-games.mjs <lista.json>
//   lista = [[titulo, titulo_wikipedia_en, plataforma, año, "géneros, separados", desarrolladora, editora, copias], ...]
// Omite los que ya estén (mismo título normalizado + plataforma).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normTitle, normalizePlatform } from '../js/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/games.json');
const UA = 'GameShelf/1.0 (catalogo personal; github.com/emicharev-cell/gameshelf)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => normTitle(s).replace(/ /g, '-').slice(0, 50);

async function wikiImage(title) {
  const tries = [
    { titles: title, redirects: '1' },
    { generator: 'search', gsrsearch: `${title.replace(/\s*\(.*?\)$/, '')} video game`, gsrlimit: '1' },
  ];
  for (const t of tries) {
    const u = new URL('https://en.wikipedia.org/w/api.php');
    u.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'pageimages', piprop: 'original|thumbnail', pithumbsize: '500', pilicense: 'any', ...t });
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Wikipedia ${r.status}`);
    const page = Object.values((await r.json())?.query?.pages || {})[0];
    const img = page?.thumbnail?.source || page?.original?.source;
    if (img && !/\.svg/i.test(img)) return { thumb: img, original: page.original?.source || img };
  }
  return null;
}

const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
let nextId = cat.games.reduce((m, g) => Math.max(m, g.id), 0) + 1;
const missing = [];
let added = 0;

for (const [title, en, plat, year, genres, dev, pub, copies] of list) {
  const platform = normalizePlatform(plat);
  if (cat.games.some(g => normTitle(g.title) === normTitle(title) && g.platform === platform)) { console.log('= ya estaba:', title); continue; }
  const id = nextId++;
  let cover_url = null, cover_local = null;
  try {
    const img = await wikiImage(en);
    if (img) {
      const r = await fetch(img.thumb, { headers: { 'User-Agent': UA } });
      const type = r.headers.get('content-type') || '';
      if (r.ok && type.startsWith('image/')) {
        const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
        cover_local = `covers/${id}-${slug(title)}.${ext}`;
        fs.writeFileSync(path.join(ROOT, cover_local), Buffer.from(await r.arrayBuffer()));
        cover_url = img.original;
      }
    }
  } catch (e) { console.log('  ! carátula', title, e.message); }
  if (!cover_local) missing.push(title);
  cat.games.push({
    id, title, alt_title: en.replace(/\s*\((?:\d{4} )?video game\)$/i, ''), platform, year: year || null,
    genres: String(genres || '').split(',').map(s => s.trim()).filter(Boolean),
    developer: dev || null, publisher: pub || null, format: 'fisico', edition: null, region: 'PAL',
    status: 'pendiente', rating: null, hours: 0, hours_source: 'manual',
    notes: copies > 1 ? `Tengo ${copies} copias.` : null, copies: copies || 1,
    cover_url, cover_local, exophase_id: null, last_played: null, added_at: now, updated_at: now,
  });
  added++;
  process.stdout.write(`+ ${title}${cover_local ? '' : ' (sin carátula)'}\n`);
  await sleep(250);
}

cat.updated_at = new Date().toISOString();
fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 1));
console.log(`\nAñadidos: ${added} · total en catálogo: ${cat.games.length} · sin carátula: ${missing.length}${missing.length ? '\n  ' + missing.join('\n  ') : ''}`);
