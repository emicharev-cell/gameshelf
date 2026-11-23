// Valida data/games.json. Ejecutar SIEMPRE antes de hacer commit de datos:  node tools/check-data.mjs
// Falla (código 1) si hay marcadores de conflicto de git, el JSON no es válido o hay ids repetidos.
import fs from 'node:fs';

const s = fs.readFileSync(new URL('../data/games.json', import.meta.url), 'utf8');
const fail = msg => { console.error('✖ ' + msg); process.exit(1); };
if (/^(<<<<<<<|=======|>>>>>>>)/m.test(s)) fail('data/games.json tiene marcadores de conflicto de git');
let c;
try { c = JSON.parse(s); } catch (e) { fail('data/games.json no es JSON válido: ' + e.message); }
if (!Array.isArray(c.games) || !c.games.length) fail('data/games.json no tiene juegos');
const ids = new Set();
for (const g of c.games) { if (ids.has(g.id)) fail('id repetido: ' + g.id); ids.add(g.id); }
console.log(`✔ data/games.json válido (${c.games.length} juegos, ${(c.retro || []).length} retro)`);
