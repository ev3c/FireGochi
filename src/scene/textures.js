import * as THREE from '../../vendor/three/three.module.js';
import { fbm, valueNoise, makeVoronoi, mulberry32, clamp01, smoothstep, lerp } from '../util/noise.js';
import { getLang } from '../i18n.js';

// Texturas generadas por código: no hace falta ningún archivo de imagen.

// Tamaño físico (m) que cubre una baldosa de textura de corteza: alrededor y a lo largo.
export const BARK_TILE = { u: 0.2, v: 0.32 };
// Tamaño físico de una baldosa de madera partida.
export const SPLIT_TILE = { u: 0.12, v: 0.32 };

function canvasTex(w, h, painter, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  painter(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function put(d, i, r, g, b, a = 255) {
  d[i] = r;
  d[i + 1] = g;
  d[i + 2] = b;
  d[i + 3] = a;
}

// Mapa de normales (espacio tangente) a partir de un campo de alturas periódico.
function normalFromHeight(h, W, H, strength) {
  return canvasTex(W, H, (d) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xl = h[y * W + ((x - 1 + W) % W)], xr = h[y * W + ((x + 1) % W)];
      const yu = h[((y - 1 + H) % H) * W + x], yd = h[((y + 1) % H) * W + x];
      const nx = (xl - xr) * strength, ny = (yd - yu) * strength;
      const len = Math.hypot(nx, ny, 1);
      put(d, (y * W + x) * 4, (nx / len * 0.5 + 0.5) * 255, (ny / len * 0.5 + 0.5) * 255, (1 / len * 0.5 + 0.5) * 255);
    }
  }, { srgb: false });
}

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// Ladrillo refractario: piezas grandes color ocre con juntas oscuras.
// Una baldosa de textura = 3 ladrillos de ancho x 6 hiladas.
export function brickTextures(kind = 'refractory') {
  return cached('brick-' + kind, () => {
    const W = 1024, H = 1024, cols = 3, rows = 6;
    const bw = W / cols, bh = H / rows;
    const joint = kind === 'refractory' ? 7 : 9;
    const rnd = mulberry32(kind === 'refractory' ? 11 : 23);
    const tints = [];
    for (let i = 0; i < cols * rows * 2; i++) tints.push([rnd(), rnd(), rnd()]);
    const heights = new Float32Array(W * H);

    const map = canvasTex(W, H, (d) => {
      for (let y = 0; y < H; y++) {
        const row = Math.floor(y / bh);
        const off = row % 2 ? bw / 2 : 0;
        for (let x = 0; x < W; x++) {
          const xx = (x + off) % W;
          const col = Math.floor(xx / bw);
          const lx = xx - col * bw, ly = y - row * bh;
          const edge = Math.min(lx, bw - lx, ly, bh - ly);
          const tint = tints[(row * cols + col) % tints.length];
          const n = fbm(x / 64, y / 64, 4, 3, W / 64, H / 64);
          const fine = valueNoise(x / 3, y / 3, 9);
          const pits = valueNoise(x / 9, y / 9, 5) > 0.86 ? 0.75 : 1;
          const stain = smoothstep(0.45, 0.8, fbm(x / 140, y / 140, 3, 21, W / 140, H / 140));
          let r, g, b, h;
          if (edge < joint) {
            const m = 0.45 + n * 0.35;
            if (kind === 'refractory') { r = 104 * m; g = 90 * m; b = 70 * m; }
            else { r = 104 * m; g = 92 * m; b = 76 * m; }
            h = 0.15 * smoothstep(0, joint, edge);
          } else {
            const bevel = smoothstep(joint, joint + 10, edge);
            const shade = (0.78 + 0.22 * bevel) * (0.8 + n * 0.3 + (fine - 0.5) * 0.14) * pits * (1 - stain * 0.3);
            if (kind === 'refractory') {
              r = (220 + tint[0] * 22) * shade;
              g = (170 + tint[1] * 20) * shade;
              b = (106 + tint[2] * 16) * shade;
            } else {
              r = (198 + tint[0] * 32) * shade;
              g = (150 + tint[1] * 26) * shade;
              b = (92 + tint[2] * 18) * shade;
            }
            h = 0.5 + bevel * 0.4 + (n - 0.5) * 0.3 + (fine - 0.5) * 0.1 - (pits < 1 ? 0.2 : 0);
          }
          heights[y * W + x] = h;
          put(d, (y * W + x) * 4, r, g, b);
        }
      }
    });

    const bump = canvasTex(W, H, (d) => {
      for (let i = 0; i < W * H; i++) {
        const v = clamp01(heights[i]) * 255;
        put(d, i * 4, v, v, v);
      }
    }, { srgb: false });

    return { map, bump, tileW: kind === 'refractory' ? 0.9 : 0.66, tileH: kind === 'refractory' ? 0.69 : 0.42 };
  });
}

// Corteza por especie. u = alrededor del tronco, v = a lo largo.
// Devuelve también el campo de alturas para desplazar la geometría.
export function barkTextures(species) {
  return cached('bark-' + species, () => {
    const W = 768, H = 768;
    const h = new Float32Array(W * H);
    let painter;
    if (species === 'pine') {
      // Placas rojizas separadas por fisuras profundas y oscuras.
      const vor = makeVoronoi(60, 4, 0.5);
      const vor2 = makeVoronoi(260, 5, 0.6);
      painter = (u, v) => {
        const c = vor(u, v);
        const c2 = vor2(u, v);
        const n = fbm(u * 10, v * 10, 5, 2, 10, 10);
        const fiss = smoothstep(0.0, 0.03, c.edge + (n - 0.5) * 0.012);
        const flake = smoothstep(0.0, 0.01, c2.edge) * 0.25 + 0.75;
        const plate = (0.62 + c.cell * 0.32 + (n - 0.5) * 0.45) * flake;
        const k = fiss * plate;
        const scale = smoothstep(0.55, 0.9, fbm(u * 24, v * 18, 3, 9, 24, 18)) * fiss;
        return [lerp(22, 150, k) + scale * 25, lerp(13, 74, k) + scale * 10, lerp(9, 44, k), fiss * (0.55 + c.cell * 0.2 + n * 0.25)];
      };
    } else if (species === 'oak') {
      // Surcos verticales profundos con crestas grisáceas y algo de liquen.
      painter = (u, v) => {
        const warp = fbm(u * 4, v * 2, 3, 7, 4, 2);
        const ridgeN = valueNoise(u * 16 + warp * 5, v * 3 + warp, 3, 16, 3);
        const ridge = 1 - Math.abs(ridgeN * 2 - 1);
        const cross = smoothstep(0.7, 0.95, valueNoise(u * 16 + warp * 5, v * 14, 4, 16, 14));
        const n = fbm(u * 20, v * 20, 4, 5, 20, 20);
        const hgt = clamp01(smoothstep(0.15, 0.75, ridge) - cross * 0.5);
        const k = hgt * (0.65 + n * 0.5);
        const lichen = smoothstep(0.74, 0.8, fbm(u * 18, v * 18, 3, 33, 18, 18)) * hgt * 0.5;
        return [lerp(22, 96, k) + lichen * 22, lerp(19, 86, k) + lichen * 30, lerp(16, 74, k) + lichen * 12, hgt * (0.8 + n * 0.2)];
      };
    } else if (species === 'birch') {
      // Corteza blanca lisa con lenticelas horizontales y manchas negras.
      const rnd = mulberry32(31);
      const marks = [];
      for (let i = 0; i < 90; i++) marks.push([rnd(), rnd(), 0.02 + rnd() * 0.1, 0.003 + rnd() * 0.008]);
      painter = (u, v) => {
        const n = fbm(u * 10, v * 10, 4, 8, 10, 10);
        const k = 0.84 + (n - 0.5) * 0.22;
        let dark = 0;
        for (const m of marks) {
          let du = Math.abs(u - m[0]); if (du > 0.5) du = 1 - du;
          let dv = Math.abs(v - m[1]); if (dv > 0.5) dv = 1 - dv;
          if (du < m[2] && dv < m[3]) dark = Math.max(dark, (1 - du / m[2]) * (1 - dv / m[3]));
        }
        const patch = smoothstep(0.62, 0.68, fbm(u * 3, v * 3, 4, 12, 3, 3));
        const peel = smoothstep(0.7, 0.75, fbm(u * 5, v * 9, 3, 15, 5, 9));
        dark = Math.max(dark, patch * 0.92);
        const r = lerp(228 * k, 28, dark) - peel * 30, g = lerp(222 * k, 26, dark) - peel * 45, b = lerp(206 * k, 24, dark) - peel * 70;
        return [r, g, b, 0.6 - dark * 0.35 + peel * 0.15 + n * 0.1];
      };
    } else {
      // Encina: corteza gris oscura cuarteada en pequeños bloques.
      const vor = makeVoronoi(170, 9, 1.0);
      painter = (u, v) => {
        const c = vor(u, v);
        const n = fbm(u * 14, v * 14, 4, 3, 14, 14);
        const fiss = smoothstep(0.0, 0.02, c.edge + (n - 0.5) * 0.008);
        const k = fiss * (0.55 + c.cell * 0.3 + (n - 0.5) * 0.4);
        return [lerp(16, 92, k), lerp(14, 80, k), lerp(12, 70, k), fiss * (0.7 + c.cell * 0.3)];
      };
    }
    const map = canvasTex(W, H, (d) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const [r, g, b, hh] = painter(x / W, y / H);
        h[y * W + x] = hh;
        put(d, (y * W + x) * 4, r, g, b);
      }
    });
    const strength = species === 'birch' ? 3 : 9;
    const normal = normalFromHeight(h, W, H, strength);
    return { map, normal, height: h, W, H };
  });
}

// Lectura bilineal del campo de alturas de la corteza (u, v en baldosas).
export function sampleBarkHeight(bark, u, v) {
  const { height, W, H } = bark;
  const x = (((u % 1) + 1) % 1) * W - 0.5, y = (((v % 1) + 1) % 1) * H - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i = (xx, yy) => height[(((yy % H) + H) % H) * W + (((xx % W) + W) % W)];
  return lerp(lerp(i(x0, y0), i(x0 + 1, y0), fx), lerp(i(x0, y0 + 1), i(x0 + 1, y0 + 1), fx), fy);
}

const WOOD = {
  pine: { light: [222, 182, 128], late: [178, 118, 62], heart: [196, 132, 76], bark: [62, 36, 22] },
  birch: { light: [230, 210, 172], late: [204, 178, 136], heart: [214, 190, 150], bark: [212, 206, 192] },
  oak: { light: [196, 158, 112], late: [140, 100, 62], heart: [150, 108, 66], bark: [62, 56, 48] },
  holm: { light: [186, 128, 88], late: [128, 78, 50], heart: [132, 80, 54], bark: [48, 42, 38] },
};

// Testa: anillos (madera temprana y tardía), duramen, grietas en cuña y marcas de sierra.
export function endGrainTexture(species) {
  return cached('end-' + species, () => {
    const S = 512;
    const C = WOOD[species] || WOOD.pine;
    const rnd = mulberry32(species.length * 13 + 7);
    const cx = 0.5 + (rnd() - 0.5) * 0.04, cy = 0.5 + (rnd() - 0.5) * 0.04;
    const cracks = Array.from({ length: 4 }, () => [rnd() * Math.PI * 2, 0.5 + rnd() * 0.5]);
    const rings = species === 'oak' || species === 'holm' ? 32 : 22;
    const saw = rnd() * Math.PI;
    return canvasTex(S, S, (d) => {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const dx = u - cx, dy = v - cy;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const a = Math.atan2(dy, dx);
        const wob = (fbm(Math.cos(a) * 1.5 + 5, Math.sin(a) * 1.5 + 5, 3, 4) - 0.5) * 0.08;
        const f = ((r + wob) * rings) % 1;
        const late = smoothstep(0.6, 0.85, f) * (1 - smoothstep(0.9, 1, f));
        const heart = species === 'birch' ? 0 : smoothstep(0.62, 0.55, r + wob * 0.5);
        let c = [0, 1, 2].map((i) => lerp(lerp(C.light[i], C.heart[i], heart * 0.7), C.late[i], late * 0.85));
        if (species === 'oak') {
          // Radios medulares del roble.
          const ray = smoothstep(0.92, 1, valueNoise(a * 60, r * 4, 5));
          c = c.map((ch) => ch * (1 + ray * 0.12));
        }
        const n = 0.86 + valueNoise(x / 3, y / 3, 2) * 0.2;
        const sawMark = 0.96 + 0.04 * Math.sin((Math.cos(saw) * u + Math.sin(saw) * v) * 260 + fbm(u * 4, v * 4, 2, 3) * 6);
        const grime = 1 - smoothstep(0.6, 0.95, r) * 0.25;
        c = c.map((ch) => ch * n * sawMark * grime);
        for (const [ca, len] of cracks) {
          let da = Math.abs(a - ca); if (da > Math.PI) da = Math.PI * 2 - da;
          const w = 0.003 + 0.03 * Math.pow(r, 2);
          if (r > 1 - len && da * r < w * smoothstep(1 - len, 1, r)) c = c.map((ch) => ch * 0.22);
        }
        if (r < 0.025) c = c.map((ch) => ch * 0.6);
        const barkEdge = 0.86 + (valueNoise(a * 8, 1, 3) - 0.5) * 0.05;
        if (r > barkEdge) {
          const bn = 0.7 + valueNoise(a * 30, r * 40, 6) * 0.5;
          c = C.bark.map((ch) => ch * bn);
        } else if (r > barkEdge - 0.03) c = c.map((ch) => ch * 0.72);
        put(d, (y * S + x) * 4, c[0], c[1], c[2]);
      }
    });
  });
}

// Cara de madera partida: fibras longitudinales, vetas y algún nudo.
export function splitWoodTextures(species = 'pine') {
  return cached('split-' + species, () => {
    const W = 384, H = 768;
    const C = WOOD[species] || WOOD.pine;
    const h = new Float32Array(W * H);
    const rnd = mulberry32(species.length * 31);
    const knots = Array.from({ length: 2 }, () => [rnd(), rnd(), 0.05 + rnd() * 0.05]);
    const map = canvasTex(W, H, (d) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        let warp = (fbm(u * 2, v * 2, 3, 3, 2, 2) - 0.5) * 0.35;
        let knot = 0;
        for (const [ku, kv, kr] of knots) {
          let du = Math.abs(u - ku); if (du > 0.5) du = 1 - du;
          let dv = Math.abs(v - kv); if (dv > 0.5) dv = 1 - dv;
          const dd = Math.hypot(du, dv * 2.2) / kr;
          if (dd < 3) warp += Math.sign(u - ku || 1) * Math.exp(-dd * dd) * 0.08;
          knot = Math.max(knot, 1 - smoothstep(0.35, 0.6, dd));
        }
        const f = (((u + warp) * 6) % 1 + 1) % 1;
        const late = smoothstep(0.6, 0.85, f) * (1 - smoothstep(0.88, 1, f)) * 0.5;
        const fiber = valueNoise(u * 160, v * 5, 7, 160, 5) * 0.6 + valueNoise(u * 60, v * 3, 8, 60, 3) * 0.4;
        const tear = smoothstep(0.75, 0.95, valueNoise(u * 40, v * 2, 11, 40, 2));
        const n = fbm(u * 6, v * 6, 3, 6, 6, 6);
        let c = [0, 1, 2].map((i) => lerp(C.light[i], C.late[i], late * 0.8) * (0.88 + fiber * 0.16 + (n - 0.5) * 0.2) * (1 - tear * 0.25));
        c = c.map((ch, i) => lerp(ch, [70, 40, 24][i], knot * 0.85));
        h[y * W + x] = fiber * 0.5 + late * 0.3 - tear * 0.4 + knot * 0.3;
        put(d, (y * W + x) * 4, c[0], c[1], c[2]);
      }
    });
    return { map, normal: normalFromHeight(h, W, H, 5) };
  });
}

// Mapa de grietas para la brasa:
// R = grietas incandescentes, G = valor de celda, B = variación interna.
export function crackTexture() {
  return cached('crack', () => {
    const S = 512;
    const vor = makeVoronoi(90, 77, 1);
    const vor2 = makeVoronoi(300, 78, 1);
    return canvasTex(S, S, (d) => {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const c = vor(u, v);
        const c2 = vor2(u, v);
        const big = 1 - smoothstep(0.0, 0.03, c.edge);
        const small = (1 - smoothstep(0.0, 0.012, c2.edge)) * 0.55;
        const n = fbm(u * 10, v * 10, 3, 4, 10, 10);
        const crack = clamp01(Math.max(big, small) * (0.6 + n * 0.6));
        put(d, (y * S + x) * 4, crack * 255, c.cell * 255, (0.3 + n * 0.7) * 255);
      }
    }, { srgb: false });
  });
}

// Papel de periódico con columnas de texto y algún titular.
export function newspaperTexture(seed = 1) {
  const en = getLang() === 'en';
  return cached(`paper-${en ? 'en' : 'es'}-${seed}`, () => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e4ddcc';
    ctx.fillRect(0, 0, 512, 512);
    const rnd = mulberry32(seed * 101);
    ctx.fillStyle = '#2a2724';
    ctx.font = 'bold 44px Georgia, serif';
    ctx.fillText(en ? 'THE DAILY' : 'EL DIARIO', 30, 60);
    ctx.font = 'bold 22px Georgia, serif';
    ctx.fillText(en ? 'Cold nights ahead: below zero' : 'Llega el frío: noches bajo cero', 30, 100);
    for (let col = 0; col < 4; col++) {
      for (let line = 0; line < 30; line++) {
        const x = 20 + col * 124;
        const y = 130 + line * 12.5;
        let cx = x;
        while (cx < x + 110) {
          const w = 6 + rnd() * 22;
          ctx.globalAlpha = 0.55 + rnd() * 0.3;
          ctx.fillRect(cx, y, Math.min(w, x + 110 - cx), 6);
          cx += w + 4;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#8c857a';
    ctx.fillRect(280, 140, 200, 120);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

// Tablas de madera para el suelo de la habitación.
export function floorTexture() {
  return cached('floor', () => {
    const W = 512, H = 512, planks = 4;
    const rnd = mulberry32(5);
    const tones = Array.from({ length: planks * 3 }, () => 0.75 + rnd() * 0.35);
    return canvasTex(W, H, (d) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = Math.floor((x / W) * planks);
        const seg = Math.floor(((y / H) + (p % 2) * 0.5) * 2) % 3;
        const lx = (x / W) * planks - p;
        const gap = lx < 0.015 || lx > 0.985 ? 0.35 : 1;
        const grain = 0.5 + 0.5 * Math.sin((lx * 30 + fbm(x / 40, y / 120, 3, p) * 6));
        const k = tones[p * 3 + seg] * gap * (0.85 + grain * 0.15);
        put(d, (y * W + x) * 4, 96 * k, 60 * k, 36 * k);
      }
    });
  });
}
