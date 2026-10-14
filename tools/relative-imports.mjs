import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = path.join(root, 'vendor/three/three.module.js');
const ADDONS = path.join(root, 'vendor/three/addons');
const CANNON = path.join(root, 'vendor/cannon/cannon-es.js');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

const rel = (from, to) => {
  let r = path.relative(path.dirname(from), to).split(path.sep).join('/');
  return r.startsWith('.') ? r : './' + r;
};

let changed = 0;
for (const file of [...walk(path.join(root, 'src')), ...walk(ADDONS)]) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/from '(three|three\/addons\/[^']+|cannon-es)'/g, (m, spec) => {
    if (spec === 'three') return `from '${rel(file, THREE)}'`;
    if (spec === 'cannon-es') return `from '${rel(file, CANNON)}'`;
    return `from '${rel(file, path.join(ADDONS, spec.slice('three/addons/'.length)))}'`;
  });
  if (out !== src) {
    fs.writeFileSync(file, out);
    changed++;
  }
}
console.log(`files changed: ${changed}`);
