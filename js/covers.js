// Búsqueda de carátulas desde el navegador: Wikipedia (imagen del infobox ≈ carátula de la caja).
// La API de Wikipedia admite CORS con origin=*, así que no hace falta servidor ni clave.
// Mejoras: 1) primero la página exacta del título, 2) bonificación si la página es de la misma consola,
// 3) se ignoran desambiguaciones entre paréntesis al comparar títulos ("Tetris (Game Boy video game)").
import { normalizePlatform, similarity } from './util.js?v=202611241308';

const PLATFORM_WORDS = {
  'Nintendo 64': /nintendo 64|n64/i, 'Game Boy Advance': /game boy advance|gba/i, 'Game Boy': /game boy(?! advance)/i,
  'SNES': /super nintendo|snes|super nes/i, 'NES': /\bnes\b|nintendo entertainment system|famicom/i,
  'GameCube': /gamecube/i, 'Wii U': /wii u/i, 'Wii': /\bwii\b(?! u)/i, 'Nintendo DS': /\bds\b/i, 'Nintendo 3DS': /3ds/i,
  'Nintendo Switch': /switch/i, 'Nintendo Switch 2': /switch 2/i, 'Mega Drive': /genesis|mega drive/i, 'Virtual Boy': /virtual boy/i,
};

const api = (lang, params) => {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'pageimages', piprop: 'original|thumbnail', pithumbsize: '600', pilicense: 'any', redirects: '1', origin: '*', ...params });
  return fetch(u).then(r => { if (!r.ok) throw new Error(`Wikipedia ${r.status}`); return r.json(); });
};

function toResults(pages, title, platform, lang, exactBonus = 0) {
  const words = PLATFORM_WORDS[normalizePlatform(platform)];
  const out = [];
  for (const p of pages) {
    const img = p.original?.source || p.thumbnail?.source;
    if (!img || /\.svg/i.test(img) || /logo/i.test(img)) continue;
    const paren = (p.title.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
    const base = p.title.replace(/\s*\([^)]*\)\s*$/, '');
    let score = similarity(title, base) + exactBonus - (p.index || 0) * 0.01;
    // "Wario" dentro de "Wario Ware Inc": una página con un título mucho más corto suele ser un personaje o una saga
    const nb = base.toLowerCase().replace(/[^a-z0-9]+/g, ''), nt = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (nb && nt.includes(nb) && nb.length < nt.length * 0.6) score -= 0.25;
    if (words && words.test(paren)) score += 0.12;          // "(Game Boy video game)" para un juego de Game Boy
    if (/remake|remaster|\b(19|20)\d\d\b/.test(paren) && words && !words.test(paren)) score -= 0.05;
    out.push({ source: `Wikipedia ${lang.toUpperCase()}`, title: base, cover: img, thumb: p.thumbnail?.source || img, score });
  }
  return out;
}

async function searchWikipedia(title, platform, lang = 'en') {
  const plat = normalizePlatform(platform);
  const out = [];
  // 1) Página exacta (y con "(video game)")
  try {
    const j = await api(lang, { titles: [title, `${title} (video game)`, plat !== 'Otra' ? `${title} (${plat} video game)` : null].filter(Boolean).join('|') });
    out.push(...toResults(Object.values(j?.query?.pages || {}).filter(p => !('missing' in p)), title, platform, lang, 0.08));
  } catch { /* seguimos con la búsqueda */ }
  // 2) Búsqueda
  for (const q of [`${title} ${plat === 'Otra' ? '' : plat} video game`, `${title} video game`, title]) {
    const j = await api(lang, { generator: 'search', gsrsearch: q, gsrlimit: '6' });
    const pages = Object.values(j?.query?.pages || {}).sort((a, b) => a.index - b.index);
    out.push(...toResults(pages, title, platform, lang));
    if (out.some(c => c.score >= 0.8)) break;
  }
  return out;
}

export async function searchCovers(title, platform) {
  // Inglés primero; español solo si no hay una coincidencia buena (menos peticiones = menos límites de Wikipedia)
  const settled = [await searchWikipedia(title, platform, 'en').then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))];
  if (!(settled[0].value || []).some(c => c.score >= 0.6)) {
    settled.push(await searchWikipedia(title, platform, 'es').then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason })));
  }
  const best = new Map();
  for (const c of settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))) {
    if (!c.cover) continue;
    const prev = best.get(c.cover);
    if (!prev || c.score > prev.score) best.set(c.cover, c);
  }
  const list = [...best.values()].sort((a, b) => b.score - a.score);
  list.failed = settled.filter(r => r.status === 'rejected').length;
  return list;
}
