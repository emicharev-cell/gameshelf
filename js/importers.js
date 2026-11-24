// Importadores de horas de juego → filas normalizadas { title, platform, hours, last_played, source, external_id }.
// Fuentes: Exophase (JSON del bookmarklet o export), RetroArch (.lrtl), CSV genérico (3DS / Wii U / cualquier otra).
import { normalizePlatform, parseHours, round1 } from './util.js?v=202611241555';

// ---------- CSV genérico ----------
function splitCSVLine(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/** CSV con cabecera. Columnas reconocidas (es/en): title|titulo|juego|name, platform|plataforma|consola, hours|horas|playtime|tiempo, minutes|minutos, last_played|ultima_vez. */
export function parseCSV(text, defaultPlatform) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = [',', ';', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = splitCSVLine(lines[0], sep).map(h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const col = names => head.findIndex(h => names.includes(h));
  const iT = col(['title', 'titulo', 'juego', 'name', 'game', 'nombre']);
  const iP = col(['platform', 'plataforma', 'consola', 'system', 'sistema']);
  const iH = col(['hours', 'horas', 'playtime', 'tiempo', 'time', 'play time']);
  const iM = col(['minutes', 'minutos', 'mins']);
  const iL = col(['last_played', 'ultima_vez', 'last played', 'ultima partida']);
  if (iT < 0 || (iH < 0 && iM < 0)) throw Object.assign(new Error('El CSV necesita columnas "titulo" y "horas" (o "minutos").'), { status: 400 });
  return lines.slice(1).map(l => {
    const c = splitCSVLine(l, sep);
    const hours = iH >= 0 ? parseHours(c[iH]) : (parseFloat(c[iM]) || 0) / 60;
    return { title: c[iT], platform: normalizePlatform(c[iP] || defaultPlatform), hours, last_played: iL >= 0 ? c[iL] || null : null, source: 'csv' };
  }).filter(r => r.title && r.hours != null);
}

// ---------- RetroArch runtime logs (.lrtl) ----------
// Ruta típica: RetroArch/playlists/logs/<Core>/<Juego>.lrtl   →   {"runtime": "1:23:45", "last_played": "2024-05-01 20:11:02"}
const CORE_PLATFORM = [
  [/snes|bsnes|mesen-s/i, 'SNES'], [/nestopia|fceumm|mesen|quicknes/i, 'NES'], [/mupen|parallel|n64/i, 'Nintendo 64'],
  [/mgba|vba|gpsp/i, 'Game Boy Advance'], [/gambatte|sameboy|gearboy/i, 'Game Boy'], [/melonds|desmume/i, 'Nintendo DS'],
  [/citra|azahar/i, 'Nintendo 3DS'], [/dolphin/i, 'GameCube'], [/genesis|picodrive|blastem/i, 'Mega Drive'],
  [/beetle psx|mednafen psx|swanstation|duckstation|pcsx/i, 'PlayStation'], [/pcsx2|lrps2/i, 'PlayStation 2'],
  [/ppsspp/i, 'PSP'], [/flycast|redream/i, 'Dreamcast'], [/saturn|yabause|kronos/i, 'Saturn'],
];

export function parseRetroArch(files) {
  return files.map(({ name, path: rel, content }) => {
    let j; try { j = JSON.parse(content); } catch { return null; }
    const core = (rel || '').split(/[\\/]/).slice(-2, -1)[0] || '';
    const platform = CORE_PLATFORM.find(([re]) => re.test(core))?.[1] || 'Otra';
    const title = name.replace(/\.lrtl$/i, '').replace(/\s*[([].*?[)\]]/g, '').trim(); // quita "(USA)", "[!]"...
    return { title, platform, hours: parseHours(j.runtime), last_played: j.last_played || null, source: 'retroarch' };
  }).filter(r => r && r.title && r.hours != null);
}

// ---------- Exophase ----------
// Exophase no tiene API pública oficial y su web está tras Cloudflare: el marcador se ejecuta en TU navegador,
// en tu página de perfil, y copia este JSON al portapapeles. Aceptamos varias formas de forma tolerante.
const EXO_PLATFORM = { steam: 'PC', gog: 'PC', epic: 'PC', ubisoft: 'PC', ea: 'PC', xbox: 'Xbox Series X|S', psn: 'PlayStation 5', ps5: 'PlayStation 5', ps4: 'PlayStation 4', ps3: 'PlayStation 3', vita: 'PS Vita', nintendo: 'Nintendo Switch', switch: 'Nintendo Switch', retro: 'Otra' };

export function parseExophase(payload) {
  const list = Array.isArray(payload) ? payload : payload?.games || payload?.data || [];
  return list.map(g => {
    const title = g.title || g.name || g.meta?.title || g.game?.title;
    const platRaw = g.platform || g.environment || g.meta?.platforms?.[0]?.name || g.meta?.environment || '';
    const plat = EXO_PLATFORM[String(platRaw).toLowerCase()] || normalizePlatform(platRaw);
    let hours = g.hours ?? null;
    if (hours == null && g.playtime != null) hours = typeof g.playtime === 'number' ? g.playtime / 60 : parseHours(g.playtime); // API: minutos
    if (hours == null && g.minutes != null) hours = g.minutes / 60;
    return { title, platform: plat, hours: hours == null ? null : round1(hours), last_played: g.last_played || g.lastplayed || null, source: 'exophase', external_id: g.id ? String(g.id) : g.master_id ? String(g.master_id) : null };
  }).filter(r => r.title);
}

