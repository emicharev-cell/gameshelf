import { esc } from './lib.js?v=202611241552';

// Color de marca, abreviatura, color de lomo y altura relativa de la caja (las de 3DS/DS son más bajas).
export const PLAT = {
  'Nintendo Switch 2': { logo: 'img/consoles/switch2.png', c: '#e60012', short: 'Switch 2', spine: '#c4000f', h: 250 },
  'Nintendo Switch': { logo: 'img/consoles/switch.png', c: '#e60012', short: 'Switch', h: 245 },
  'Nintendo 3DS': { logo: 'img/consoles/3ds.png', c: '#d0021b', short: '3DS', spine: '#f4f4f4', t: '#1a1a1a', h: 190 },
  'Nintendo DS': { logo: 'img/consoles/ds.png', c: '#6b6b6b', short: 'DS', spine: '#f4f4f4', t: '#1a1a1a', h: 190 },
  'Wii U': { logo: 'img/consoles/wiiu.png', c: '#009ac7', short: 'Wii U', spine: '#1d8fc4', h: 265 },
  'Wii': { logo: 'img/consoles/wii.png', c: '#8f9aa3', short: 'Wii', spine: '#f6f6f6', t: '#1a1a1a', h: 265 },
  'GameCube': { logo: 'img/consoles/gamecube.png', c: '#6a4fb6', short: 'GCN', spine: '#2b2b2b', h: 265 },
  'Nintendo 64': { c: '#1b8f3a', short: 'N64', spine: '#3a3a3a', h: 220 },
  'SNES': { c: '#7a6fb5', short: 'SNES', spine: '#cfcfd6', t: '#2a2342', h: 220 },
  'NES': { c: '#b91c1c', short: 'NES', spine: '#202020', h: 220 },
  'Game Boy Advance': { logo: 'img/consoles/gba.png', c: '#4b3fb0', short: 'GBA', h: 175 },
  'Game Boy': { c: '#7b8b3a', short: 'GB', h: 175 },
  'PlayStation 5': { c: '#0070d1', short: 'PS5', h: 255 },
  'PlayStation 4': { c: '#003791', short: 'PS4', h: 255 },
  'PlayStation 3': { c: '#1f1f1f', short: 'PS3', h: 255 },
  'PlayStation 2': { c: '#0e1a40', short: 'PS2', spine: '#111', h: 268 },
  'PlayStation': { c: '#5b5b5b', short: 'PS1', spine: '#1a1a1a', h: 215 },
  'PS Vita': { c: '#1e40af', short: 'Vita', h: 185 },
  'PSP': { c: '#222', short: 'PSP', h: 210 },
  'Xbox Series X|S': { c: '#107c10', short: 'Xbox', h: 255 },
  'Xbox One': { c: '#0e7a0d', short: 'XB1', h: 255 },
  'Xbox 360': { c: '#5dc21e', short: '360', t: '#0b2b05', h: 255 },
  'Xbox': { c: '#1a6b1a', short: 'Xbox', h: 268 },
  'PC': { c: '#1b2838', short: 'PC', spine: '#24364d', h: 250 },
  'Mega Drive': { c: '#111', short: 'MD', h: 240 },
  'Dreamcast': { c: '#e66a00', short: 'DC', spine: '#f2f2f2', t: '#1a1a1a', h: 230 },
  'Saturn': { c: '#30305a', short: 'Saturn', h: 240 },
  'Virtual Boy': { c: '#b91c1c', short: 'VB', h: 200 },
};

export function platStyle(p) {
  if (PLAT[p]) return PLAT[p];
  let h = 0; for (const ch of String(p)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { c: `hsl(${h} 45% 40%)`, short: String(p || '?').slice(0, 6), h: 240 };
}

/** Carátula generada (SVG) para cuando no hay imagen o el enlace falla. */
export function fallbackCover(g) {
  const ps = platStyle(g.platform);
  const words = String(g.title || '?').split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 14) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  lines.push(cur.trim());
  const text = lines.slice(0, 5).map((l, i) => `<text x="25" y="${170 + i * 34}" font-family="Space Grotesk,Arial" font-weight="700" font-size="28" fill="#fff">${esc(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 490"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ps.c}"/><stop offset="1" stop-color="#0b0d17"/></linearGradient></defs><rect width="350" height="490" fill="url(#g)"/><circle cx="300" cy="420" r="160" fill="#fff" opacity=".06"/><circle cx="40" cy="60" r="90" fill="#fff" opacity=".05"/>${text}<text x="25" y="455" font-family="Inter,Arial" font-size="16" fill="#fff" opacity=".7">${esc(g.platform || '')} ${g.year ? '· ' + g.year : ''}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Atributos <img>: local → remota → generada. */
export function coverSrc(g) {
  const chain = [g.cover_local, g.cover_url].filter(Boolean);
  const first = chain.shift() || fallbackCover(g);
  return `src="${esc(first)}" data-alt="${esc(chain.join('|'))}" data-fb="${esc(fallbackCover(g))}"`;
}

export function wireCovers(root) {
  root.querySelectorAll('img[data-fb]').forEach(img => {
    if (img.dataset.wired) return;
    img.dataset.wired = 1;
    const fail = () => {
      const alts = (img.dataset.alt || '').split('|').filter(Boolean);
      if (alts.length) { img.dataset.alt = alts.slice(1).join('|'); img.src = alts[0]; }
      else if (img.src !== img.dataset.fb) img.src = img.dataset.fb;
    };
    img.addEventListener('error', fail);
    if (img.complete && img.naturalWidth === 0 && img.src) fail();
  });
}
