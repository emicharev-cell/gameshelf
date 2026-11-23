// Utilidades compartidas: normalización de títulos/plataformas y similitud difusa.

export const PLATFORMS = {
  'Nintendo Switch 2': ['switch 2', 'ns2', 'nintendo switch 2'],
  'Nintendo Switch': ['switch', 'ns', 'nsw', 'nintendo switch'],
  'Nintendo 3DS': ['3ds', 'n3ds', 'new 3ds', 'new nintendo 3ds', '2ds', 'nintendo 3ds', 'nintendo 2ds'],
  'Nintendo DS': ['ds', 'nds', 'nintendo ds'],
  'Wii U': ['wiiu', 'wii u', 'nintendo wii u'],
  'Wii': ['wii', 'nintendo wii'],
  'GameCube': ['gc', 'ngc', 'gamecube', 'nintendo gamecube'],
  'Nintendo 64': ['n64', 'nintendo 64'],
  'SNES': ['snes', 'super nintendo', 'super nes', 'super famicom'],
  'NES': ['nes', 'famicom'],
  'Game Boy Advance': ['gba', 'game boy advance'],
  'Game Boy': ['gb', 'gbc', 'game boy', 'game boy color'],
  'PlayStation 5': ['ps5', 'playstation 5'],
  'PlayStation 4': ['ps4', 'playstation 4'],
  'PlayStation 3': ['ps3', 'playstation 3'],
  'PlayStation 2': ['ps2', 'playstation 2'],
  'PlayStation': ['ps1', 'psx', 'psone', 'playstation'],
  'PS Vita': ['vita', 'psvita', 'ps vita', 'playstation vita'],
  'PSP': ['psp', 'playstation portable'],
  'Xbox Series X|S': ['xbox series', 'xbox series x', 'xbox series s', 'xsx', 'xbox series x|s'],
  'Xbox One': ['xbox one', 'xb1'],
  'Xbox 360': ['xbox 360', 'x360'],
  'Xbox': ['xbox', 'original xbox'],
  'PC': ['pc', 'windows', 'steam', 'gog', 'epic', 'win'],
  'Mega Drive': ['mega drive', 'genesis', 'sega genesis', 'md'],
  'Dreamcast': ['dreamcast', 'dc'],
  'Saturn': ['saturn', 'sega saturn'],
};

const aliasMap = new Map();
for (const [canon, aliases] of Object.entries(PLATFORMS)) {
  aliasMap.set(canon.toLowerCase(), canon);
  for (const a of aliases) aliasMap.set(a, canon);
}

export function normalizePlatform(p) {
  if (!p) return 'Otra';
  const k = String(p).trim().toLowerCase().replace(/[™®]/g, '');
  return aliasMap.get(k) || aliasMap.get(k.replace(/^(nintendo|sony|microsoft|sega) /, '')) || String(p).trim();
}

const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16' };
const STOP = new Set(['the', 'edition', 'edicion', 'deluxe', 'remastered', 'hd', 'goty']);

export function normTitle(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => ROMAN[w] || w)
    .filter(w => !STOP.has(w))
    .join(' ')
    .trim();
}

function bigrams(s) {
  const out = new Map();
  const str = ` ${s} `;
  for (let i = 0; i < str.length - 1; i++) {
    const g = str.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Coeficiente de Dice sobre bigramas (0..1) entre títulos normalizados. */
export function similarity(a, b) {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.6 + 0.35 * Math.min(x.length, y.length) / Math.max(x.length, y.length);
  const A = bigrams(x), B = bigrams(y);
  let inter = 0, total = 0;
  for (const [g, n] of A) { total += n; if (B.has(g)) inter += Math.min(n, B.get(g)); }
  for (const n of B.values()) total += n;
  return (2 * inter) / total;
}

/** Mejor coincidencia de un título dentro de una lista de juegos (o null). */
export function bestMatch(title, platform, games, threshold = 0.72) {
  let best = null;
  const plat = platform ? normalizePlatform(platform) : null;
  for (const g of games) {
    let s = similarity(title, g.title);
    if (plat && g.platform === plat) s += 0.05;
    if (!best || s > best.score) best = { game: g, score: Math.min(1, s) };
  }
  return best && best.score >= threshold ? best : null;
}

/** "12:34:56" | "12h 30m" | "754 min" | number → horas (float). */
export function parseHours(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*min/);
  if (m) return parseFloat(m[1].replace(',', '.')) / 60;
  m = s.match(/^(?:(\d+(?:[.,]\d+)?)\s*h(?:rs?|oras?)?)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (m && (m[1] || m[2])) return (m[1] ? parseFloat(m[1].replace(',', '.')) : 0) + (m[2] ? +m[2] / 60 : 0);
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export const round1 = n => Math.round(n * 10) / 10;
