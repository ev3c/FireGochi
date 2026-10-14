// Prepara dist/firegochi.zip para subirlo a un hosting (Hostinger, etc.): node tools/build-dist.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const site = path.join(dist, 'site');
const zip = path.join(dist, 'firegochi.zip');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const version = (html.match(/class="ver">v([\d.]+)</) || [])[1];
if (!version) throw new Error('No se encontró la versión en index.html');

fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(site, { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', '.htaccess', 'privacy.html']) {
  fs.copyFileSync(path.join(root, f), path.join(site, f));
}
for (const d of ['src', 'vendor', 'icons', '.well-known']) {
  fs.cpSync(path.join(root, d), path.join(site, d), { recursive: true });
}
// El récord guardado en el servidor no va en el zip: al subir una versión nueva no se pierde.
fs.cpSync(path.join(root, 'api'), path.join(site, 'api'), {
  recursive: true,
  filter: (src) => !src.endsWith('record.json'),
});

// Cada import del juego lleva la versión: el navegador no puede mezclar módulos de subidas distintas.
// Las librerías de vendor no cambian y se dejan sin versión para que Three.js se cargue una sola vez.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}
for (const file of walk(path.join(site, 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/(from\s+|import\s*\(\s*)'(\.{1,2}\/[^'?]+\.js)'/g, (m, pre, spec) =>
    spec.includes('/vendor/') ? m : `${pre}'${spec}?v=${version}'`);
  fs.writeFileSync(file, out);
}
const page = path.join(site, 'index.html');
fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace(/\?v=[\d.]+/g, `?v=${version}`));

fs.rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${site.replace(/'/g, "''")}', '${zip.replace(/'/g, "''")}')`,
], { stdio: 'inherit' });
fs.rmSync(site, { recursive: true, force: true });
console.log(`dist/firegochi.zip listo (v${version}, ${(fs.statSync(zip).size / 1048576).toFixed(2)} MB)`);
