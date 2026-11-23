// Carátulas PAL oficiales desde GameTDB (https://www.gametdb.com) para Switch, 3DS, DS, Wii, Wii U y GameCube.
// Uso:
//   node tools/gametdb-covers.mjs <carpeta-con-xml> [--apply] [--ids 12,16,30]
// · <carpeta-con-xml>: contiene 3dstdb.xml, dstdb.xml, wiitdb.xml, wiiutdb.xml, switchtdb.xml
//   (descarga: https://www.gametdb.com/<plat>tdb.zip?LANG=ES)
// · Sin --apply solo muestra el emparejado propuesto. Con --apply descarga a covers/ y actualiza data/games.json.
// · Prefiere la edición europea (PAL) y, si hay varias, la que incluye español.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { similarity, normTitle } from '../js/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/games.json');
const UA = 'GameShelf/1.0 (catalogo personal; github.com/emicharev-cell/gameshelf)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [dir, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
const DATES = flags.includes('--dates'); // solo rellena release_eu (fecha de lanzamiento europea) sin tocar carátulas
const ONLY = flags.includes('--ids') ? new Set(flags[flags.indexOf('--ids') + 1].split(',').map(Number)) : null;

const DB = {
  'Nintendo Switch': ['switchtdb.xml', 'switch'], 'Nintendo Switch 2': ['switchtdb.xml', 'switch'],
  'Nintendo 3DS': ['3dstdb.xml', '3ds'], 'Nintendo DS': ['dstdb.xml', 'ds'],
  'Wii': ['wiitdb.xml', 'wii'], 'GameCube': ['wiitdb.xml', 'wii'], 'Wii U': ['wiiutdb.xml', 'wiiu'],
};
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const xml = fs.readFileSync(path.join(dir, file), 'utf8');
  const games = [];
  for (const m of xml.matchAll(/<game name="([^"]*)">([\s\S]*?)<\/game>/g)) {
    const body = m[2];
    const id = /<id>([^<]+)<\/id>/.exec(body)?.[1];
    if (!id) continue;
    games.push({
      id, name: m[1],
      type: /<type>([^<]*)<\/type>/.exec(body)?.[1] || '',
      region: /<region>([^<]*)<\/region>/.exec(body)?.[1] || '',
      languages: /<languages>([^<]*)<\/languages>/.exec(body)?.[1] || '',
      titles: [...body.matchAll(/<title>([^<]*)<\/title>/g)].map(t => t[1].replace(/&amp;/g, '&').replace(/&apos;/g, "'")),
      date: (d => (d && d[1] && d[2] && d[3] ? `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}` : null))(/<date year="(\d*)" month="(\d*)" day="(\d*)"/.exec(body)),
    });
  }
  return (cache[file] = games);
}

const clean = t => normTitle(String(t).replace(/[’`´]/g, "'").replace(/\((?:Europe|USA|Japan|EN|ES|[A-Z]{2}(?:,[A-Z]{2})*)\)/g, '').replace(/–|-/g, ' '));

function bestFor(g) {
  const conf = DB[g.platform];
  if (!conf) return null;
  if (g.gametdb_id) { const e = load(conf[0]).find(x => x.id === g.gametdb_id); if (e) return { e, s: 2, folder: conf[1] }; }
  const typeOk = e => (g.platform === 'GameCube' ? e.type === 'GameCube' : g.platform === 'Wii' ? e.type === 'Wii' || e.type === '' : true)
    && !/demo|kiosk|trial|beta|proto/i.test(e.name);
  let best = null;
  for (const e of load(conf[0]).filter(typeOk)) {
    let s = 0;
    for (const t of [...e.titles, e.name]) for (const mine of [g.title, g.alt_title].filter(Boolean)) {
      const v = clean(t) === clean(mine) ? 1 : similarity(clean(t), clean(mine));
      if (v > s) s = v;
    }
    if (/PAL|EUR|ALL/.test(e.region)) s += 0.04;
    if (/ES/.test(e.languages)) s += 0.02;
    if (!best || s > best.s) best = { e, s };
  }
  return best && best.s >= 0.9 ? { ...best, folder: conf[1] } : best ? { ...best, weak: true, folder: conf[1] } : null;
}

async function fetchCover(folder, id) {
  const langs = ['ES', 'EN', 'FR', 'DE', 'IT', 'US', 'JA'];
  const kinds = ['coverM', 'cover', 'coverHQ', 'coverfullHQ'];
  for (const kind of kinds) for (const lang of langs) {
    for (const ext of ['jpg', 'png']) {
      const url = `https://art.gametdb.com/${folder}/${kind}/${lang}/${id}.${ext}`;
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) return { url, buf: Buffer.from(await r.arrayBuffer()), ext };
      await sleep(60);
    }
  }
  return null;
}

const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const targets = cat.games.filter(g => DB[g.platform] && (!ONLY || ONLY.has(g.id)) && (DATES || !g.cover_locked));
let changed = 0;
for (const g of targets) {
  const m = bestFor(g);
  const tag = m ? `${m.e.id} ${m.e.region} "${m.e.titles[0] || m.e.name}" (${m.s.toFixed(2)})${m.weak ? ' ¿DUDOSO?' : ''}` : 'sin coincidencia';
  console.log(`${String(g.id).padStart(3)} ${g.title} → ${tag}`);
  if (DATES) {
    if (m && !m.weak && m.e.date && !g.release_eu_manual) { g.release_eu = m.e.date; g.year = +m.e.date.slice(0, 4); changed++; console.log(`     fecha UE: ${m.e.date}`); }
    continue;
  }
  if (!APPLY || !m || m.weak) continue;
  const c = await fetchCover(m.folder, m.e.id);
  if (!c) { console.log('     (GameTDB no tiene imagen)'); continue; }
  if (g.cover_local && fs.existsSync(path.join(ROOT, g.cover_local))) fs.rmSync(path.join(ROOT, g.cover_local));
  g.cover_local = `covers/${g.id}-tdb-${m.e.id}.${c.ext}`;
  g.cover_url = c.url;
  g.gametdb_id = m.e.id;
  fs.writeFileSync(path.join(ROOT, g.cover_local), c.buf);
  changed++;
  await sleep(250);
}
if (APPLY || DATES) {
  cat.updated_at = new Date().toISOString();
  fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 1));
  console.log(`\nCarátulas actualizadas: ${changed}`);
}
