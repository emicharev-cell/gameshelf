// Descarga de Wikipedia las carátulas que falten (juegos sin cover_local), despacio y reintentando si hay límite (429).
// Uso: node tools/fill-covers.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normTitle } from '../js/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/games.json');
const UA = 'GameShelf/1.0 (catalogo personal; github.com/emicharev-cell/gameshelf)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => normTitle(s).replace(/ /g, '-').slice(0, 50);

async function get(url) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status !== 429) return r;
    const wait = (Number(r.headers.get('retry-after')) || 20 * (i + 1)) * 1000;
    console.log(`  … límite de Wikipedia, espero ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
  throw new Error('Wikipedia sigue limitando');
}

async function wikiImage(title) {
  const tries = [{ titles: title, redirects: '1' }, { generator: 'search', gsrsearch: `${title} video game`, gsrlimit: '1' }];
  for (const t of tries) {
    const u = new URL('https://en.wikipedia.org/w/api.php');
    u.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'pageimages', piprop: 'original|thumbnail', pithumbsize: '500', pilicense: 'any', ...t });
    const r = await get(u);
    if (!r.ok) throw new Error(`Wikipedia ${r.status}`);
    const page = Object.values((await r.json())?.query?.pages || {})[0];
    const img = page?.thumbnail?.source || page?.original?.source;
    if (img && !/\.svg/i.test(img)) return { thumb: img, original: page.original?.source || img };
  }
  return null;
}

const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const todo = cat.games.filter(g => !g.cover_local);
console.log(`Faltan ${todo.length} carátulas`);
const save = () => fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 1));
let ok = 0;
for (const g of todo) {
  try {
    const img = await wikiImage(g.alt_title || g.title);
    if (img) {
      await sleep(800);
      const r = await get(img.thumb);
      const type = r.headers.get('content-type') || '';
      if (r.ok && type.startsWith('image/')) {
        const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
        g.cover_local = `covers/${g.id}-${slug(g.title)}.${ext}`;
        g.cover_url = img.original;
        fs.writeFileSync(path.join(ROOT, g.cover_local), Buffer.from(await r.arrayBuffer()));
        ok++;
        console.log(`✓ ${g.title}`);
        if (ok % 10 === 0) save();
      }
    } else console.log(`✗ ${g.title} (sin imagen en Wikipedia)`);
  } catch (e) { console.log(`✗ ${g.title}: ${e.message}`); }
  await sleep(1500);
}
save();
console.log(`\nDescargadas ${ok}/${todo.length}. Siguen sin carátula: ${cat.games.filter(g => !g.cover_local).map(g => g.title).join(', ') || 'ninguna'}`);
