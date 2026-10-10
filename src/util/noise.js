// Ruido de valor 2D con periodo opcional (para texturas que encajan sin costuras).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

export function valueNoise(x, y, seed = 0, px = 0, py = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (v, p) => (p ? ((v % p) + p) % p : v);
  const x0 = w(xi, px), x1 = w(xi + 1, px), y0 = w(yi, py), y1 = w(yi + 1, py);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = fade(xf), v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, oct = 4, seed = 0, px = 0, py = 0) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * valueNoise(x * f, y * f, seed + i * 17, px * f, py * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

// Voronoi con envoltura periódica. Devuelve distancia al borde y valor de celda.
export function makeVoronoi(count, seed, stretchY = 1) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([rnd(), rnd(), rnd()]);
  return function (u, v) {
    let d1 = 9, d2 = 9, cell = 0;
    for (const p of pts) {
      let dx = Math.abs(u - p[0]);
      let dy = Math.abs(v - p[1]);
      if (dx > 0.5) dx = 1 - dx;
      if (dy > 0.5) dy = 1 - dy;
      dy *= stretchY;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        cell = p[2];
      } else if (d < d2) d2 = d;
    }
    return { edge: Math.sqrt(d2) - Math.sqrt(d1), cell, d: Math.sqrt(d1) };
  };
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
