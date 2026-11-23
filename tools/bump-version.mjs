// Anti-caché: pone ?v=<versión> a los CSS/JS de la web y a los imports entre módulos, y escribe version.json.
// La web compara su versión con version.json (sin caché) al arrancar y, si hay una nueva, se recarga sola.
// Ejecutar SIEMPRE antes de publicar cambios de código (index.html, css/, js/):  node tools/bump-version.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12); // AAAAMMDDhhmm

const rewrite = (file, fn) => {
  const p = path.join(ROOT, file);
  fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8')));
};

rewrite('index.html', s => s
  .replace(/href="css\/styles\.css(\?v=\d+)?"/, `href="css/styles.css?v=${v}"`)
  .replace(/src="js\/app\.js(\?v=\d+)?"/, `src="js/app.js?v=${v}"`)
  .replace(/window\.APP_VERSION = '\d*'/, `window.APP_VERSION = '${v}'`));

for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
  rewrite(`js/${f}`, s => s.replace(/from '\.\/([\w-]+\.js)(\?v=\d+)?'/g, `from './$1?v=${v}'`));
}

fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ version: v }) + '\n');
console.log('Versión', v);
