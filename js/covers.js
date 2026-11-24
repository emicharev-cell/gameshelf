// Búsqueda de carátulas desde el navegador: Wikipedia (imagen del infobox ≈ carátula de la caja).
// La API de Wikipedia admite CORS con origin=*, así que no hace falta servidor ni clave.
import { normalizePlatform, similarity } from './util.js?v=202611241120';

async function searchWikipedia(title, platform, lang = 'en') {
  const out = [];
  const plat = normalizePlatform(platform);
  const queries = [`${title} ${plat === 'Otra' ? '' : plat} video game`, `${title} video game`, title];
  for (const q of queries) {
    const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    u.search = new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrlimit: '6',
      prop: 'pageimages', piprop: 'original|thumbnail', pithumbsize: '600', pilicense: 'any', redirects: '1', origin: '*',
    });
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Wikipedia ${r.status}`);
    const pages = Object.values((await r.json())?.query?.pages || {}).sort((a, b) => a.index - b.index);
    for (const p of pages) {
      const img = p.original?.source || p.thumbnail?.source;
      if (!img || /\.svg$/i.test(img) || /logo/i.test(img)) continue;
      const clean = p.title.replace(/\s*\((?:\d{4} )?video ?game\)$/i, '');
      out.push({ source: `Wikipedia ${lang.toUpperCase()}`, title: clean, cover: img, thumb: p.thumbnail?.source || img, score: similarity(title, clean) });
    }
    if (out.length) break;
  }
  return out;
}

export async function searchCovers(title, platform) {
  const settled = await Promise.allSettled([searchWikipedia(title, platform, 'en'), searchWikipedia(title, platform, 'es')]);
  const seen = new Set();
  const list = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    .filter(c => c.cover && !seen.has(c.cover) && seen.add(c.cover))
    .sort((a, b) => b.score - a.score);
  list.failed = settled.filter(r => r.status === 'rejected').length;
  return list;
}
