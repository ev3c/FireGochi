// Prueba de la simulación de combustión sin render: node tools/simtest.mjs [escenario]
import { createSim, createItem, stepSim, fireLevel, itemMassFraction } from '../src/sim/combustion.js';
import { FUELS } from '../src/sim/fuels.js';

function place(it, x, y, z, along = 'x') {
  const F = FUELS[it.type];
  const half = (F.length ?? 0) / 2;
  const r = F.shape === 'stick' ? F.width / 2 : F.radius;
  if (along === 'x') Object.assign(it.seg, { ax: x - half, bx: x + half, ay: y, by: y, az: z, bz: z, r });
  else Object.assign(it.seg, { ax: x, bx: x, ay: y, by: y, az: z - half, bz: z + half, r });
  return it;
}

const scenario = process.argv[2] || 'good';
const sim = createSim();
const add = (t, x, y, z, a, o) => { const it = place(createItem(t, o), x, y, z, a); sim.items.push(it); return it; };

if (scenario === 'good' || scenario === 'wet') {
  add('paper', -0.05, 0.055, 0);
  add('paper', 0.07, 0.055, 0.02);
  for (let i = 0; i < 4; i++) add('kindling', -0.06 + i * 0.04, 0.11, 0, 'z');
  for (let i = 0; i < 4; i++) add('kindling', 0, 0.13, -0.06 + i * 0.04, 'x');
  add('pine_thin', 0, 0.165, -0.04);
  add('pine_thin', 0, 0.165, 0.04);
  add('pine', 0, 0.22, -0.05, 'x', scenario === 'wet' ? { moisture: 0.42 } : undefined);
  add('pine', 0, 0.22, 0.06);
  add('oak', 0, 0.3, 0);
} else if (scenario === 'paper-log') {
  add('paper', 0, 0.055, 0);
  add('oak', 0, 0.16, 0);
} else if (scenario === 'kindling-only') {
  add('paper', 0, 0.055, 0);
  for (let i = 0; i < 4; i++) add('kindling', -0.06 + i * 0.04, 0.11, 0, 'z');
} else if (scenario === 'choke') {
  add('paper', 0, 0.055, 0);
  for (let i = 0; i < 8; i++) add('kindling', -0.12 + i * 0.035, 0.11, 0, 'z');
  for (let k = 0; k < 4; k++) for (let i = 0; i < 3; i++) add('pine', 0, 0.17 + k * 0.1, -0.11 + i * 0.11);
}

const env = { Tamb: 18, supply: 1, bellows: 0, poke: 0, match: null, bedY: 0 };
const dt = 0.25;
let t = 0;
const total = Number(process.argv[3] || 7200);
let nextPrint = 0;
while (t < total) {
  const p0 = sim.items[0]?.seg;
  env.match = t < 3 && p0 ? { x: p0.ax, y: p0.ay, z: p0.az + 0.06 } : null;
  stepSim(sim, dt, env);
  for (const e of sim.events) if (e.type !== 'pop') {
    const it = sim.items.find((i) => i.id === e.id);
    console.log(`  t=${t.toFixed(1)}s ${e.type} #${e.id} ${it ? it.type : ''}`);
  }
  sim.events.length = 0;
  if (t >= nextPrint) {
    const states = {};
    for (const it of sim.items) states[it.state] = (states[it.state] || 0) + 1;
    const big = sim.items.filter((i) => FUELS[i.type].shape === 'log')
      .map((i) => `${i.type}:${i.state[0]}${Math.round(i.T)}° ${Math.round(itemMassFraction(i) * 100)}% w${i.moisture.toFixed(2)}`).join(' | ');
    console.log(`[${(t / 60).toFixed(1)}min] ${fireLevel(sim).label} P=${sim.power.toFixed(2)} o2=${sim.o2.toFixed(2)} smoke=${sim.smokeTotal.toFixed(2)} bed=${sim.bed.toFixed(3)}/${sim.bedGlow.toFixed(2)} n=${sim.items.length} ${JSON.stringify(states)}\n     ${big}`);
    nextPrint += t < 300 ? 15 : 300;
  }
  t += dt;
}
