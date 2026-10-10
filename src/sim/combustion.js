import { FUELS, WET_LIMIT } from './fuels.js';

// Simulación de combustión independiente del render.
// Cada pieza se modela como una cápsula (segmento a-b con radio r) para calcular
// distancias entre combustibles y repartir el calor.

const T_MAX = 960;
const FLAME_REACH = 0.07;
const GLOW_REACH = 0.045;
const BED_REACH = 0.12;

let nextId = 1;

export function createItem(type, opts = {}) {
  const F = FUELS[type];
  const m0 = opts.m0 ?? F.mass * (0.85 + Math.random() * 0.3);
  const vol0 = m0 * F.volatile;
  return {
    id: opts.id ?? nextId++,
    type,
    m0,
    vol0,
    vol: opts.vol ?? vol0,
    char: opts.char ?? m0 - vol0,
    moisture: opts.moisture ?? F.moisture,
    T: opts.T ?? 18,
    state: opts.state ?? 'cold',
    flame: 0,
    glow: 0,
    smoke: 0,
    steam: 0,
    seg: { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0.03 },
    q: 0,
    everLit: opts.everLit ?? false,
  };
}

export function ensureNextId(id) {
  if (id >= nextId) nextId = id + 1;
}

export function itemMassFraction(it) {
  return (it.vol + it.char) / it.m0;
}

function charredOf(it) {
  return 1 - it.vol / it.vol0;
}

export function createSim() {
  return {
    items: [],
    bed: 0,
    bedHeat: 0,
    bedGlow: 0,
    ash: 0,
    o2: 1,
    demand: 0,
    power: 0,
    flameTotal: 0,
    smokeTotal: 0,
    steamTotal: 0,
    events: [],
  };
}

function segDist(s, t) {
  // Distancia mínima entre dos segmentos 3D.
  const d1x = s.bx - s.ax, d1y = s.by - s.ay, d1z = s.bz - s.az;
  const d2x = t.bx - t.ax, d2y = t.by - t.ay, d2z = t.bz - t.az;
  const rx = s.ax - t.ax, ry = s.ay - t.ay, rz = s.az - t.az;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let sc, tc;
  if (a <= 1e-9 && e <= 1e-9) {
    sc = tc = 0;
  } else if (a <= 1e-9) {
    sc = 0;
    tc = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) {
      tc = 0;
      sc = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      sc = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      tc = (b * sc + f) / e;
      if (tc < 0) {
        tc = 0;
        sc = clamp(-c / a, 0, 1);
      } else if (tc > 1) {
        tc = 1;
        sc = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const px = s.ax + d1x * sc - (t.ax + d2x * tc);
  const py = s.ay + d1y * sc - (t.ay + d2y * tc);
  const pz = s.az + d1z * sc - (t.az + d2z * tc);
  return Math.sqrt(px * px + py * py + pz * pz);
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function pointSegDist(px, py, pz, s) {
  return segDist({ ax: px, ay: py, az: pz, bx: px, by: py, bz: pz }, s) - s.r;
}

// Matriz de acoplamiento térmico entre piezas. Se recalcula cuando cambian posiciones.
export function computeCoupling(sim) {
  const items = sim.items;
  const n = items.length;
  const flameK = new Float32Array(n * n);
  const glowK = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const si = items[i].seg;
    const yi = (si.ay + si.by) * 0.5;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const sj = items[j].seg;
      const d = Math.max(0, segDist(si, sj) - si.r - sj.r);
      const yj = (sj.ay + sj.by) * 0.5;
      // El calor sube: lo que está encima recibe mucho más de la llama de abajo.
      const dy = yi - yj;
      const vert = dy > 0.01 ? 1.4 : dy < -0.01 ? 0.45 : 0.9;
      flameK[i * n + j] = Math.exp(-d / FLAME_REACH) * vert;
      glowK[i * n + j] = Math.exp(-d / GLOW_REACH);
    }
  }
  sim.coupling = { n, flameK, glowK };
}

function lowY(seg) {
  return Math.min(seg.ay, seg.by) - seg.r;
}

/**
 * Avanza la simulación dt segundos.
 * env: { Tamb, supply, bellows, poke, match: {x,y,z} | null, bedY }
 */
export function stepSim(sim, dt, env) {
  const items = sim.items;
  const n = items.length;
  if (!sim.coupling || sim.coupling.n !== n) computeCoupling(sim);
  const { flameK, glowK } = sim.coupling;
  const bellows = env.bellows || 0;
  const o2 = sim.o2;
  const Tamb = env.Tamb;
  const bedY = env.bedY ?? 0;

  const bedGlowNow = sim.bedGlow * (1 + bellows * 0.9);

  // 1) Calor recibido por cada pieza (usando el estado del paso anterior).
  for (let i = 0; i < n; i++) {
    const it = items[i];
    let q = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const o = items[j];
      if (o.flame > 0) q += o.flame * FUELS[o.type].flameScale * 900 * flameK[i * n + j];
      if (o.glow > 0) q += o.glow * 420 * glowK[i * n + j];
    }
    if (bedGlowNow > 0) {
      q += bedGlowNow * 560 * Math.exp(-Math.max(0, lowY(it.seg) - bedY) / BED_REACH);
    }
    if (env.match) {
      const d = Math.max(0, pointSegDist(env.match.x, env.match.y, env.match.z, it.seg));
      q += 760 * Math.exp(-d / 0.018);
    }
    it.q = q;
  }

  // 2) Termodinámica y cambios de estado.
  let demand = 0;
  let power = 0, flameTotal = 0, smokeTotal = 0, steamTotal = 0;
  let bedFeed = 0;
  const survivors = [];

  for (let i = 0; i < n; i++) {
    const it = items[i];
    const F = FUELS[it.type];
    let self = 0;
    if (it.state === 'flaming') self = 380 * Math.min(1, it.flame / Math.max(o2, 0.2));
    else if (it.state === 'ember') self = 300 * it.glow;
    else if (it.state === 'smolder') self = 60;

    let target = Math.min(T_MAX, Tamb + it.q + self);
    const k = 1 - Math.exp(-dt / F.inertia);

    // Agua: primero se evapora; mientras está húmeda no supera los ~100 °C.
    it.steam = 0;
    if (it.moisture > 0.02 && target > 100) {
      const rate = 0.12 * (target - 100) / 600 / F.inertia * (it.moisture > WET_LIMIT ? 1 : 0.6);
      const dm = Math.min(it.moisture - 0.02, rate * dt);
      it.moisture -= dm;
      it.steam = (it.moisture > WET_LIMIT ? 1 : 0.35) * Math.min(1, rate * 400) * Math.sqrt(it.m0);
    }
    it.T += (target - it.T) * k;
    if (it.moisture > WET_LIMIT && it.T > 100) it.T = 100 + (it.T - 100) * 0.05;

    const wetFactor = clamp(1 - it.moisture * 1.6, 0.2, 1);
    let rawFlame = 0;
    it.smoke = 0;

    switch (it.state) {
      case 'cold':
      case 'smolder': {
        if (it.vol > 0 && it.T >= F.ignition && it.moisture <= WET_LIMIT && o2 > 0.15) {
          it.state = 'flaming';
          it.everLit = true;
          sim.events.push({ type: 'ignite', id: it.id });
        } else if (it.vol <= 0) {
          it.state = 'ember';
        } else if (it.T > 180) {
          it.state = 'smolder';
          const s = clamp((it.T - 170) / 160, 0, 1);
          it.smoke = s * Math.sqrt(it.m0) * 1.2;
          it.vol -= (it.vol0 / F.flameTime) * 0.04 * s * dt;
        } else {
          it.state = 'cold';
        }
        break;
      }
      case 'flaming': {
        rawFlame = clamp((it.T - (F.ignition - 80)) / 320, 0, 1.4) * wetFactor * (1 + bellows * 0.35);
        const f = rawFlame * o2;
        if (it.T < F.ignition - 80 || f < 0.02) {
          it.state = it.T > 180 ? 'smolder' : 'cold';
          sim.events.push({ type: 'flameout', id: it.id });
          it.flame = 0;
          break;
        }
        it.flame = f;
        const dv = Math.min(it.vol, (it.vol0 / F.flameTime) * f * dt);
        it.vol -= dv;
        sim.ash += dv * 0.012;
        // La capa carbonizada se agrieta y suelta trozos que caen al lecho.
        const shed = Math.min(it.char * 0.5, it.char * 0.0006 * f * (0.3 + charredOf(it)) * (1 + (env.poke || 0) * 4) * dt);
        it.char -= shed;
        bedFeed += shed;
        demand += F.demand * rawFlame;
        // Humo por falta de aire o por humedad residual.
        it.smoke = (1 - o2) * rawFlame * Math.sqrt(it.m0) * 1.1 + it.moisture * 0.5 * f;
        if (it.vol <= 0) {
          it.vol = 0;
          it.state = 'ember';
        }
        if (Math.random() < F.sparks * 0.25 * f * dt) sim.events.push({ type: 'pop', id: it.id });
        break;
      }
      case 'ember':
        break;
    }

    if (it.state !== 'flaming') it.flame = Math.max(0, it.flame - dt * 2);

    // Brillo de brasa: aparece cuando se forma carbón y la pieza está caliente.
    const charred = 1 - it.vol / it.vol0;
    if (it.state === 'ember') {
      const g = clamp((it.T - 330) / 380, 0, 1) * Math.min(1, o2 + 0.25) * (1 + bellows * 0.8);
      it.glow = clamp(g, 0, 1.3);
      // Llamitas residuales sobre la brasa.
      it.flame = Math.max(it.flame, 0.1 * it.glow * o2);
      const burn = ((it.m0 - it.vol0) / F.emberTime) * (0.25 + it.glow) * Math.min(1, o2 + 0.2);
      it.char -= burn * dt;
      sim.ash += burn * dt * 0.03;
      const shed = Math.min(Math.max(0, it.char) * 0.5, Math.max(0, it.char) * 0.0015 * (0.3 + it.glow) * (1 + (env.poke || 0) * 4) * dt);
      it.char -= shed;
      bedFeed += shed;
      demand += F.demand * 0.35 * it.glow;
      if (it.T > 250) it.smoke = Math.max(it.smoke, (1 - o2) * 0.3 * Math.sqrt(it.m0));
    } else if (it.state === 'flaming') {
      it.glow = clamp(charred * 1.2, 0, 1) * clamp((it.T - 300) / 400, 0, 1) * 0.7;
    } else {
      it.glow = Math.max(0, it.glow - dt * 0.05);
    }

    power += F.heatOut * (it.flame + it.glow * 0.55);
    flameTotal += it.flame * F.flameScale;
    smokeTotal += it.smoke;
    steamTotal += it.steam;

    // Cuando la brasa se consume casi del todo, se desmorona sobre el lecho.
    if (it.char <= it.m0 * 0.05 && it.vol <= 0) {
      bedFeed += Math.max(0, it.char) + it.m0 * 0.02;
      sim.ash += it.m0 * 0.01;
      sim.events.push({ type: 'collapse', id: it.id });
      continue;
    }
    survivors.push(it);
  }

  if (survivors.length !== n) {
    sim.items = survivors;
    sim.coupling = null;
  }

  // 3) Lecho de brasas bajo la parrilla.
  sim.bed += bedFeed;
  let heatIn = 0;
  for (const it of sim.items) {
    const h = Math.exp(-Math.max(0, lowY(it.seg) - bedY) / 0.25);
    heatIn += (it.flame * 0.35 + it.glow * 0.3) * h;
  }
  const bedMassFactor = Math.min(1, sim.bed / 0.25);
  const bedTarget = clamp(heatIn + bedMassFactor * 0.45, 0, 1) * Math.min(1, o2 + 0.3);
  sim.bedHeat += (bedTarget - sim.bedHeat) * (1 - Math.exp(-dt / 90));
  // Las brasas del lecho se consumen en ceniza; una capa gruesa de ceniza las protege y las hace durar más.
  const ashCover = Math.min(1, sim.ash / 0.1);
  const bedLoss = sim.bed * 0.0011 * (0.2 + sim.bedHeat) * (1 + bellows) / (1 + ashCover * 1.2) * dt;
  sim.bed = Math.max(0, sim.bed - bedLoss);
  sim.ash = Math.min(0.2, sim.ash + bedLoss * 0.04);
  sim.bedGlow = sim.bed > 0.005 ? sim.bedHeat * Math.min(1, sim.bed / 0.12 + 0.15) : sim.bedHeat * 0.3;
  if (sim.bed < 0.002 && heatIn < 0.01) sim.bedHeat *= Math.exp(-dt / 30);
  demand += sim.bedGlow * 0.08;
  power += sim.bedGlow * 0.7;

  // 4) Oxígeno disponible para el siguiente paso.
  const supply = env.supply * (1 + bellows * 1.3 + (env.poke || 0) * 0.5);
  sim.demand = demand;
  const ratio = demand > supply ? supply / demand : 1;
  const o2Target = Math.pow(ratio, 0.8);
  sim.o2 += (o2Target - sim.o2) * (1 - Math.exp(-dt / 4));

  sim.power = power;
  sim.flameTotal = flameTotal;
  sim.smokeTotal = smokeTotal;
  sim.steamTotal = steamTotal;
}

export function douse(sim) {
  for (const it of sim.items) {
    it.T = 30;
    it.moisture = Math.min(0.6, it.moisture + 0.35);
    if (it.state !== 'ember') it.state = 'cold';
    it.flame = 0;
    it.glow = 0;
  }
  sim.bedHeat = 0;
  sim.bedGlow = 0;
}

export function fireLevel(sim) {
  // Etiqueta del estado del fuego para la interfaz.
  const p = sim.power;
  if (sim.o2 < 0.55 && sim.smokeTotal > 0.4) return { id: 'choked', label: 'Sofocado' };
  if (p < 0.05 && sim.bedGlow < 0.03) {
    if (sim.smokeTotal > 0.1) return { id: 'smoking', label: 'Humeando' };
    return { id: 'out', label: 'Apagado' };
  }
  if (sim.flameTotal < 0.15) return { id: 'embers', label: 'Brasas' };
  if (p < 0.8) return { id: 'weak', label: 'Débil' };
  if (p < 2.0) return { id: 'steady', label: 'Estable' };
  if (p < 3.5) return { id: 'lively', label: 'Vivo' };
  return { id: 'roaring', label: 'Rugiente' };
}
