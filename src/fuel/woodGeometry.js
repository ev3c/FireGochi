import * as THREE from '../../vendor/three/three.module.js';
import { valueNoise, fbm, smoothstep } from '../util/noise.js';
import { barkTextures, sampleBarkHeight, BARK_TILE, SPLIT_TILE } from '../scene/textures.js';

// Leña procedimental: se define una sección 2D (plano XZ) formada por tramos
// de corteza y de cara partida, y se extruye a lo largo del eje Y.
// Grupos de material: 0 = corteza, 1 = madera partida, 2 = testas.

const KINDS = {
  pine: ['round', 'round', 'half', 'quarter'],
  birch: ['round', 'round', 'half'],
  oak: ['quarter', 'half', 'quarter', 'third'],
  holm: ['quarter', 'half', 'third', 'quarter'],
};
const KIND_R = { round: 1, half: 1.38, third: 1.62, quarter: 1.85 };
const KIND_ARC = { round: Math.PI * 2, half: Math.PI, third: (Math.PI * 2) / 3, quarter: Math.PI / 2 };
const BARK_DEPTH = { pine: 0.007, oak: 0.006, holm: 0.0045, birch: 0.0012 };

export function chooseKind(type, F, rnd) {
  if (type === 'pine_thin') return 'round';
  if (F.shape === 'stick') return 'sliver';
  const list = KINDS[F.species] || ['round'];
  return list[Math.floor(rnd() * list.length)];
}

function lineStrip(p0, p1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t });
  }
  return pts;
}

// Sección: lista de tramos { kind: 'bark'|'split', pts: [{x,z,a?}] } recorridos en sentido antihorario.
function buildSection(kind, R, rnd) {
  const strips = [];
  if (kind === 'round') {
    const N = 56;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, a });
    }
    strips.push({ kind: 'bark', pts, closed: true });
    return strips;
  }
  if (kind === 'sliver') {
    // Astilla: trozo de corona circular de un tronco grande.
    const R1 = R, R0 = R * (0.72 + rnd() * 0.1), arc = 0.24 + rnd() * 0.08;
    const a0 = -arc / 2, a1 = arc / 2;
    const outer = [];
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (arc * i) / 6;
      outer.push({ x: Math.cos(a) * R1, z: Math.sin(a) * R1, a });
    }
    const hasBark = rnd() < 0.5;
    strips.push({ kind: hasBark ? 'bark' : 'split', pts: outer });
    const pIn1 = { x: Math.cos(a1) * R0, z: Math.sin(a1) * R0 };
    const pIn0 = { x: Math.cos(a0) * R0, z: Math.sin(a0) * R0 };
    strips.push({ kind: 'split', pts: lineStrip(outer[6], pIn1, 3) });
    strips.push({ kind: 'split', pts: lineStrip(pIn1, pIn0, 3) });
    strips.push({ kind: 'split', pts: lineStrip(pIn0, outer[0], 3) });
    return strips;
  }
  const arc = KIND_ARC[kind] * (0.92 + rnd() * 0.16);
  const a0 = -arc / 2;
  const N = Math.max(10, Math.round((56 * arc) / (Math.PI * 2)));
  const bark = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (arc * i) / N;
    bark.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, a });
  }
  strips.push({ kind: 'bark', pts: bark });
  const P0 = bark[0], P1 = bark[N];
  if (kind === 'half') {
    strips.push({ kind: 'split', pts: lineStrip(P1, P0, 10) });
  } else {
    // El corazón del tronco no queda justo en el centro: las cuñas reales son irregulares.
    const C = { x: (rnd() - 0.5) * R * 0.08 + R * 0.04, z: (rnd() - 0.5) * R * 0.08 };
    strips.push({ kind: 'split', pts: lineStrip(P1, C, 8) });
    strips.push({ kind: 'split', pts: lineStrip(C, P0, 8) });
  }
  return strips;
}

function polygonCentroid(poly) {
  let A = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cr = p.x * q.z - q.x * p.z;
    A += cr;
    cx += (p.x + q.x) * cr;
    cz += (p.z + q.z) * cr;
  }
  A *= 0.5;
  return { x: cx / (6 * A), z: cz / (6 * A), area: Math.abs(A) };
}

/**
 * Crea la geometría de una pieza de leña.
 * Devuelve { geometry, hull: [[x,z]...] (centrado), length, rEq, kind }.
 */
export function buildWood(type, F, rnd) {
  const kind = chooseKind(type, F, rnd);
  const species = F.species || 'pine';
  const isStick = kind === 'sliver';
  const R = isStick ? 0.11 : F.radius * KIND_R[kind] * (0.92 + rnd() * 0.16);
  const L = (isStick ? F.length : F.length) * (0.9 + rnd() * 0.2);
  const strips = buildSection(kind, R, rnd);
  const bark = barkTextures(species);
  const depth = (BARK_DEPTH[species] || 0.005) * (F.radius < 0.04 ? 0.5 : 1);
  const seed = Math.floor(rnd() * 10000);

  // Forma general: conicidad, curvatura y protuberancias suaves.
  const taper = (rnd() - 0.5) * 0.12;
  const bendX = (rnd() - 0.5) * 0.35 * R * (kind === 'round' ? 1 : 0.4);
  const bendZ = (rnd() - 0.5) * 0.35 * R * (kind === 'round' ? 1 : 0.4);
  const knots = [];
  const nk = isStick ? 0 : 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < nk; k++) knots.push({ a: rnd() * Math.PI * 2, y: (rnd() - 0.5) * L * 0.8, r: 0.012 + rnd() * 0.014, h: 0.004 + rnd() * 0.005 });
  // Cortes de las testas: inclinados e irregulares (sierra o hacha).
  const cut = [0, 1].map(() => ({ tx: (rnd() - 0.5) * 0.25, tz: (rnd() - 0.5) * 0.25 }));
  const uOff = rnd(), vOff = rnd();
  const nTilesAround = Math.max(1, Math.round((Math.PI * 2 * R) / BARK_TILE.u));
  const rings = Math.max(10, Math.round(L / 0.016));

  const positions = [], uvs = [], indices = [];
  const groups = [];
  const endOutline = [[], []];

  const shapeAt = (x, z, y) => {
    const t = y / L + 0.5;
    const s = 1 + taper * (t - 0.5) * 2;
    return [x * s + Math.sin(t * Math.PI) * bendX, z * s + Math.sin(t * Math.PI) * bendZ];
  };

  const addStripGeometry = (strip, groupIndex) => {
    const start = positions.length / 3;
    const pts = strip.pts;
    const n = pts.length;
    // Longitud acumulada para UVs de la cara partida.
    const sAcc = [0];
    for (let i = 1; i < n; i++) sAcc.push(sAcc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    let nx = 0, nz = 0;
    if (strip.kind === 'split') {
      const dx = pts[n - 1].x - pts[0].x, dz = pts[n - 1].z - pts[0].z;
      const len = Math.hypot(dx, dz) || 1;
      nx = dz / len;
      nz = -dx / len;
    }
    for (let j = 0; j <= rings; j++) {
      const yBase = (j / rings - 0.5) * L;
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        // Peso de desplazamiento: 0 en las aristas para que no se abran huecos.
        const edgeW = strip.closed ? 1 : smoothstep(0, 2.5, Math.min(i, n - 1 - i));
        let x = p.x, z = p.z, y = yBase;
        let u, v;
        if (strip.kind === 'bark') {
          const a = p.a ?? Math.atan2(p.z, p.x);
          u = (a / (Math.PI * 2)) * nTilesAround + uOff;
          v = (yBase + L / 2) / BARK_TILE.v + vOff;
          const hb = sampleBarkHeight(bark, u, v);
          let disp = (hb - 0.5) * depth * 2;
          disp += (fbm(Math.cos(a) * 1.5 + 4, Math.sin(a) * 1.5 + yBase * 6, 3, seed) - 0.5) * R * 0.12;
          for (const k of knots) {
            let da = Math.abs(a - k.a); if (da > Math.PI) da = Math.PI * 2 - da;
            const dd = Math.hypot(da * R, yBase - k.y) / k.r;
            disp += k.h * Math.exp(-dd * dd) - k.h * 1.4 * Math.exp(-dd * dd * 6);
          }
          const len = Math.hypot(x, z) || 1;
          x += (x / len) * disp * edgeW;
          z += (z / len) * disp * edgeW;
        } else {
          u = sAcc[i] / SPLIT_TILE.u + uOff;
          v = (yBase + L / 2) / SPLIT_TILE.v + vOff;
          // Fibras arrancadas y ondulación de la cara partida.
          // Las fibras corren a lo largo: el ruido cambia rápido a lo ancho y despacio a lo largo.
          const sz = isStick ? 0.4 : 1;
          const disp = ((valueNoise(sAcc[i] * 140, yBase * 5, seed + 3) - 0.5) * 0.0025 +
            (valueNoise(sAcc[i] * 45, yBase * 1.6, seed + 4) - 0.5) * 0.004 * sz +
            (fbm(sAcc[i] * 5, yBase * 1.2, 3, seed + 5) - 0.5) * 0.01 * sz) * edgeW;
          x += nx * disp;
          z += nz * disp;
        }
        if (j === 0 || j === rings) {
          const c = cut[j === 0 ? 0 : 1];
          y += (p.x * c.tx + p.z * c.tz) + (valueNoise(p.x * 60, p.z * 60, seed + j) - 0.5) * 0.004;
        }
        const [sx, sz] = shapeAt(x, z, y);
        positions.push(sx, y, sz);
        uvs.push(u, v);
      }
      if (j === 0 || j === rings) {
        const ring = endOutline[j === 0 ? 0 : 1];
        const base = positions.length / 3 - n;
        for (let i = 0; i < n - 1; i++) ring.push({ idx: base + i, ox: pts[i].x, oz: pts[i].z });
        if (strip.closed) continue;
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = start + j * n + i, b = a + 1, d = a + n, c = d + 1;
        indices.push(a, d, b, b, d, c);
      }
    }
    return { start, count: rings * (n - 1) * 6 };
  };

  // Tramos agrupados por material.
  for (const g of [['bark', 0], ['split', 1]]) {
    const begin = indices.length;
    for (const s of strips) if (s.kind === g[0]) addStripGeometry(s, g[1]);
    groups.push([begin, indices.length - begin, g[1]]);
  }

  // Testas: abanico desde el centroide, con vértices propios (arista viva).
  const capBegin = indices.length;
  const outline2D = [];
  for (const s of strips) for (let i = 0; i < s.pts.length - 1; i++) outline2D.push(s.pts[i]);
  const cen = polygonCentroid(outline2D);
  for (let e = 0; e < 2; e++) {
    const ring = endOutline[e];
    const cy = ring.reduce((acc, r) => acc + positions[r.idx * 3 + 1], 0) / ring.length;
    const [cx, cz] = shapeAt(cen.x, cen.z, cy);
    const ci = positions.length / 3;
    positions.push(cx, cy, cz);
    uvs.push(cen.x / R * 0.5 + 0.5, cen.z / R * 0.5 + 0.5);
    const first = positions.length / 3;
    for (const r of ring) {
      positions.push(positions[r.idx * 3], positions[r.idx * 3 + 1], positions[r.idx * 3 + 2]);
      uvs.push(r.ox / R * 0.5 + 0.5, r.oz / R * 0.5 + 0.5);
    }
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const p = first + i, q = first + ((i + 1) % m);
      if (e === 1) indices.push(ci, q, p);
      else indices.push(ci, p, q);
    }
  }
  groups.push([capBegin, indices.length - capBegin, 2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  for (const [s, c, m] of groups) geo.addGroup(s, c, m);
  // Centrar en el centroide para que coincida con el cuerpo físico.
  geo.translate(-cen.x, 0, -cen.z);
  geo.computeVertexNormals();

  // Envolvente simplificada para la física (polígono convexo).
  const hull = simplifyHull(outline2D, kind).map((p) => [p.x - cen.x, p.z - cen.z]);
  return { geometry: geo, hull, length: L, rEq: Math.sqrt(cen.area / Math.PI), kind };
}

function simplifyHull(outline, kind) {
  const target = kind === 'round' ? 12 : 9;
  const step = Math.max(1, Math.floor(outline.length / target));
  const pts = [];
  for (let i = 0; i < outline.length; i += step) pts.push(outline[i]);
  return convexHull(pts);
}

function convexHull(points) {
  const p = points.map((q) => ({ x: q.x, z: q.z })).sort((a, b) => a.x - b.x || a.z - b.z);
  // Giro a la izquierda con margen: se descartan puntos casi alineados (la física los necesita bien definidos).
  const left = (o, a, b) => {
    const ax = a.x - o.x, az = a.z - o.z, bx = b.x - o.x, bz = b.z - o.z;
    return ax * bz - az * bx > 0.03 * Math.hypot(ax, az) * Math.hypot(bx, bz);
  };
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && !left(lower[lower.length - 2], lower[lower.length - 1], q)) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && !left(upper[upper.length - 2], upper[upper.length - 1], q)) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
