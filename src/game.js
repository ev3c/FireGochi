import * as THREE from '../vendor/three/three.module.js';
import { FUELS, FUEL_ORDER, WET_LIMIT, WET_MOISTURE } from './sim/fuels.js';
import { createSim, createItem, stepSim, computeCoupling, fireLevel, itemMassFraction, ensureNextId, douseAt } from './sim/combustion.js';
import { createFuelMesh, setBurnVisual, disposeFuelMesh } from './fuel/meshes.js';
import { createBody, resizeBody } from './physics.js';
import { BED, BOX } from './scene/layout.js';
import { t, fuelShort } from './i18n.js';

const SAVE_KEY = 'chimenea-tamagotchi-v1';
const SIM_DT = 0.1;
const GARDEN_WAIT = 8 * 60;
const WETTABLE = ['pinecone', 'kindling', 'pine_thin', 'pine', 'birch', 'oak', 'holm'];
export const MATCH_BOX = { qty: 10, price: 6 };

// Cómo se encuentra la persona según la temperatura de la sala (°C, límite inferior de cada tramo).
export const BODY = [
  { id: 'dead', min: 50, face: '💀' },
  { id: 'heatstroke', min: 40, face: '😵' },
  { id: 'veryhot', min: 35, face: '😰' },
  { id: 'hot', min: 30, face: '🥵' },
  { id: 'warm', min: 26, face: '😅' },
  { id: 'comfy', min: 19, face: '😊' },
  { id: 'cool', min: 16, face: '🙂' },
  { id: 'cold', min: 10, face: '😬' },
  { id: 'freezing', min: -Infinity, face: '🥶' },
];
export const bodyState = (room) => BODY.find((b) => room >= b.min);
export const DEATH_TEMP = 50;

export const ACHIEVEMENTS = [
  { id: 'first', name: 'Primera llama', desc: 'Prende algo en la chimenea.' },
  { id: 'onematch', name: 'Una sola cerilla', desc: 'Consigue un fuego estable gastando una única cerilla.' },
  { id: 'phoenix', name: 'Ave fénix', desc: 'Reaviva el fuego desde las brasas sin usar cerillas.' },
  { id: 'hour', name: 'Una hora de calor', desc: 'Mantén el fuego vivo 1 hora seguida.' },
  { id: 'night', name: 'Noche entera', desc: 'Mantén el fuego vivo 8 horas seguidas.' },
  { id: 'keeper', name: 'Guardián del fuego', desc: 'Mantén el fuego vivo 24 horas seguidas.' },
  { id: 'cozy', name: 'Hogar acogedor', desc: 'Calienta la sala por encima de 21 °C.' },
  { id: 'roar', name: 'Fuego rugiente', desc: 'Consigue un fuego rugiente.' },
  { id: 'smoky', name: 'Ahumado', desc: 'Ahoga el fuego hasta llenarlo de humo.' },
  { id: 'dryer', name: 'Paciencia', desc: 'Haz arder un tronco que estaba húmedo.' },
  { id: 'collector', name: 'Coleccionista', desc: 'Quema todos los tipos de combustible.' },
  { id: 'cold', name: 'Contra la ola de frío', desc: 'Mantén la sala a 18 °C o más durante una ola de frío.' },
];

const WEATHER = {
  cold: { name: 'Ola de frío', icon: '🥶', dur: 40 * 60, msg: 'Llega una ola de frío: la temperatura exterior se desploma.' },
  rain: { name: 'Lluvia', icon: '🌧️', dur: 50 * 60, msg: 'Empieza a llover: la leña del jardín estará húmeda.' },
  wind: { name: 'Viento', icon: '💨', dur: 25 * 60, msg: 'Sopla el viento: la chimenea tira más y el fuego consume más rápido.' },
  gift: { name: 'Visita', icon: '🎁', dur: 0, msg: 'Un vecino te ha traído un par de troncos de encina.' },
};

function defaultState() {
  return {
    inventory: { paper: 8, pinecone: 4, kindling: 6, pine_thin: 4, pine: 3, birch: 1, oak: 2, holm: 1, 'pine:wet': 1, 'oak:wet': 1 },
    matches: 12,
    points: 40,
    room: 13,
    gameTime: 0,
    stats: {
      aliveFor: 0, bestStreak: 0, totalAlive: 0, deadFor: 0,
      matchesThisFire: 0, matchesTotal: 0, burned: {}, embersFor: 0,
      litCount: 0,
    },
    achievements: {},
    weather: { id: null, until: 0, nextAt: 12 * 60 },
    gardenReadyAt: 0, // segundos de tiempo de juego en los que el jardín vuelve a estar listo
    dryProgress: 0,
    speed: 1,
    sound: true,
    tutorialSeen: false,
    coldSnapComfort: 0,
  };
}

export class Game {
  constructor({ scene, phys, audio, sparks, smoke, notify }) {
    this.scene = scene;
    this.phys = phys;
    this.audio = audio;
    this.sparks = sparks;
    this.smoke = smoke;
    this.notify = notify || (() => {});
    this.state = defaultState();
    this.sim = createSim();
    this.entries = new Map();
    this.simAcc = 0;
    this.couplingAcc = 0;
    this.env = { Tamb: 15, supply: 1, bellows: 0, poke: 0, match: null, bedY: BED.y };
    this.level = fireLevel(this.sim);
    this.roomSmoke = 0;
    this.wasAlive = false;
  }

  // ---------- Piezas ----------

  addFuel(key, pos, quat, opts = {}) {
    const [type, wetFlag] = key.split(':');
    const wet = wetFlag === 'wet';
    const it = createItem(type, { moisture: wet ? WET_MOISTURE : undefined, ...opts.item });
    const seed = opts.seed ?? it.id;
    const vis = createFuelMesh(type, seed, wet ? 1 : 0);
    vis.mesh.position.copy(pos);
    vis.mesh.quaternion.copy(quat);
    vis.mesh.userData.entryId = it.id;
    this.scene.add(vis.mesh);
    const body = createBody(this.phys, type, it.m0, pos, quat, vis.wood);
    body.entryId = it.id;
    let lastSound = 0;
    body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const now = performance.now();
      if (v < 0.5 || now - lastSound < 150) return;
      lastSound = now;
      if (FUELS[type].shape === 'ball') this.audio.paperRustle();
      else this.audio.thud(Math.min(1, v / 2.5) * Math.min(1, it.m0 * 1.5 + 0.2));
    });
    const entry = { it, vis, body, rs: 1, ls: 1, seed, visFlame: 0, wasWet: wet, key };
    this.entries.set(it.id, entry);
    this.sim.items.push(it);
    this.sim.coupling = null;
    this.updateSeg(entry);
    return entry;
  }

  removeEntry(id) {
    const e = this.entries.get(id);
    if (!e) return;
    this.scene.remove(e.vis.mesh);
    disposeFuelMesh(e.vis);
    this.phys.world.removeBody(e.body);
    this.entries.delete(id);
    const idx = this.sim.items.indexOf(e.it);
    if (idx >= 0) {
      this.sim.items.splice(idx, 1);
      this.sim.coupling = null;
    }
  }

  updateSeg(e) {
    const F = FUELS[e.it.type];
    const b = e.body;
    const s = e.it.seg;
    const wood = e.vis.wood;
    if (wood) {
      const h = (wood.length * e.ls) / 2;
      const q = b.quaternion;
      // Eje Y local rotado.
      const ax = 2 * (q.x * q.y - q.w * q.z), ay = 1 - 2 * (q.x * q.x + q.z * q.z), az = 2 * (q.y * q.z + q.w * q.x);
      s.ax = b.position.x - ax * h; s.ay = b.position.y - ay * h; s.az = b.position.z - az * h;
      s.bx = b.position.x + ax * h; s.by = b.position.y + ay * h; s.bz = b.position.z + az * h;
      s.r = wood.rEq * e.rs;
    } else {
      s.ax = s.bx = b.position.x; s.ay = s.by = b.position.y; s.az = s.bz = b.position.z;
      s.r = F.radius * e.rs;
    }
  }

  shrinkFactors(it) {
    const F = FUELS[it.type];
    const f = Math.max(0, itemMassFraction(it));
    switch (F.shape) {
      case 'log': return [0.38 + 0.62 * Math.pow(f, 0.7), 0.72 + 0.28 * f];
      case 'stick': return [0.4 + 0.6 * f, 0.75 + 0.25 * f];
      case 'cone': return [0.6 + 0.4 * f, 1];
      default: return [0.3 + 0.7 * f, 1];
    }
  }

  // ---------- Bucle ----------

  update(dt, time, input) {
    const st = this.state;
    if (st.dead) return;
    this.phys.world.step(1 / 60, dt, 4);

    this.env.bellows = input.bellows;
    this.env.poke = Math.max(0, this.env.poke - dt * 0.25);
    this.env.match = input.match;
    this.env.Tamb = st.room;
    this.env.supply = 1 + (st.weather.id === 'wind' ? 0.35 : 0);

    for (const e of this.entries.values()) {
      const p = e.body.position;
      // Red de seguridad: si una pieza fina atraviesa el suelo o una pared, vuelve al hogar.
      if (p.y < -0.03 || p.y > 2 || p.x < BOX.xMin - 0.05 || p.x > BOX.xMax + 0.05 || p.z < BOX.zBack - 0.05 || p.z > BOX.zFront + 0.3) {
        p.set(THREE.MathUtils.clamp(p.x, BOX.xMin + 0.15, BOX.xMax - 0.15), 0.06, THREE.MathUtils.clamp(p.z, BOX.zBack + 0.1, BOX.zFront - 0.1));
        e.body.velocity.setZero();
        e.body.angularVelocity.setZero();
      }
      e.vis.mesh.position.copy(e.body.position);
      e.vis.mesh.quaternion.copy(e.body.quaternion);
      this.updateSeg(e);
    }
    this.couplingAcc += dt;
    if (this.couplingAcc > 0.5) {
      this.couplingAcc = 0;
      computeCoupling(this.sim);
    }

    const simDt = dt * st.speed;
    this.simAcc += simDt;
    let steps = 0;
    while (this.simAcc >= SIM_DT && steps < 200) {
      this.simAcc -= SIM_DT;
      steps++;
      stepSim(this.sim, SIM_DT, this.env);
      this.handleEvents(true);
      this.tickEconomy(SIM_DT);
    }
    if (steps >= 200) this.simAcc = 0;

    this.updateVisuals(dt, time);
    this.level = fireLevel(this.sim);
  }

  handleEvents(live) {
    for (const ev of this.sim.events) {
      const e = this.entries.get(ev.id);
      if (ev.type === 'collapse') {
        if (e && live) {
          const p = e.body.position;
          this.sparks.burst(p.x, p.y, p.z, 25, 0.8);
          this.audio.thud(0.4);
          this.audio.crackle(1.2);
        }
        if (e) {
          const t = e.it.type;
          this.state.stats.burned[t] = true;
          if (e.wasWet && FUELS[t].shape !== 'ball') this.unlock('dryer');
        }
        this.removeEntry(ev.id);
      } else if (ev.type === 'ignite') {
        if (e) {
          this.unlock('first');
          this.state.stats.burned[e.it.type] = true;
          if (e.wasWet) this.unlock('dryer');
        }
      } else if (ev.type === 'pop' && e && live) {
        const s = e.it.seg;
        const t = Math.random();
        this.sparks.burst(s.ax + (s.bx - s.ax) * t, s.ay + s.r, s.az + (s.bz - s.az) * t, 8 + Math.floor(Math.random() * 18), 1.2);
        this.audio.pop();
      }
    }
    this.sim.events.length = 0;
  }

  outsideTemp() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    let t = 4 + 4.5 * Math.cos(((h - 15) / 24) * Math.PI * 2);
    if (this.state.weather.id === 'cold') t -= 9;
    if (this.state.weather.id === 'rain') t -= 2;
    return t;
  }

  isAlive() {
    return this.sim.power > 0.08 || this.sim.bedGlow > 0.05;
  }

  tickEconomy(dt) {
    const st = this.state;
    const s = st.stats;
    st.gameTime += dt;
    const alive = this.isAlive();

    const Tout = this.outsideTemp();
    const Teq = Tout + 5 + this.sim.power * 3.2;
    st.room += (Teq - st.room) * (1 - Math.exp(-dt / 1200));
    if (st.room >= DEATH_TEMP) {
      st.dead = true;
      return;
    }

    this.level = fireLevel(this.sim);
    if (this.level.id === 'embers') {
      if (!s.embersFor) this.embersMatchMark = s.matchesTotal;
      s.embersFor = (s.embersFor || 0) + dt;
    } else if (['steady', 'lively', 'roaring'].includes(this.level.id)) {
      if (s.embersFor > 90 && s.matchesTotal === this.embersMatchMark) this.unlock('phoenix');
      s.embersFor = 0;
    }

    if (alive) {
      s.aliveFor += dt;
      s.totalAlive += dt;
      s.deadFor = 0;
      s.bestStreak = Math.max(s.bestStreak, s.aliveFor);
      if (!this.wasAlive) s.litCount++;
    } else {
      s.deadFor += dt;
      if (s.deadFor > 60 && s.aliveFor > 0) {
        s.aliveFor = 0;
        s.matchesThisFire = 0;
      }
    }
    this.wasAlive = alive;

    const comfort = st.room >= 19 && st.room <= 25;
    st.points += dt * ((alive ? 0.012 : 0) + (comfort ? 0.025 : 0) + (this.level.id === 'steady' || this.level.id === 'lively' ? 0.01 : 0));

    if (s.aliveFor > 3600) this.unlock('hour');
    if (s.aliveFor > 8 * 3600) this.unlock('night');
    if (s.aliveFor > 24 * 3600) this.unlock('keeper');
    if (st.room > 21) this.unlock('cozy');
    if (this.level.id === 'roaring') this.unlock('roar');
    if (this.level.id === 'choked') this.unlock('smoky');
    if (this.level.id === 'steady' || this.level.id === 'lively' || this.level.id === 'roaring') {
      if (s.matchesThisFire === 1 && s.aliveFor < 1800) this.unlock('onematch');
    }
    if (FUEL_ORDER.every((t) => s.burned[t])) this.unlock('collector');
    if (st.weather.id === 'cold' && st.room >= 18) {
      st.coldSnapComfort += dt;
      if (st.coldSnapComfort > 600) this.unlock('cold');
    }

    // Leña húmeda del inventario que se seca junto al fuego.
    const wetKeys = Object.keys(st.inventory).filter((k) => k.endsWith(':wet') && st.inventory[k] > 0);
    if (wetKeys.length && this.sim.power > 0.5) {
      st.dryProgress += dt * Math.min(2, this.sim.power / 2);
      if (st.dryProgress > 900) {
        st.dryProgress = 0;
        const k = wetKeys[0];
        st.inventory[k]--;
        const dry = k.split(':')[0];
        st.inventory[dry] = (st.inventory[dry] || 0) + 1;
        this.notify(t('dried', { name: fuelShort(dry).toLowerCase() }), '☀️');
      }
    }

    // Tiempo meteorológico.
    const w = st.weather;
    if (w.id && st.gameTime > w.until) {
      if (w.id === 'cold') st.coldSnapComfort = 0;
      w.id = null;
      this.notify(t('weather.calm'), '🌤️');
    }
    if (!w.id && st.gameTime > w.nextAt) {
      const ids = ['cold', 'rain', 'wind', 'gift', 'cold', 'rain'];
      const id = ids[Math.floor(Math.random() * ids.length)];
      const W = WEATHER[id];
      if (id === 'gift') {
        st.inventory.holm = (st.inventory.holm || 0) + 2;
      } else {
        w.id = id;
        w.until = st.gameTime + W.dur;
      }
      this.notify(t(`weather.${id}.msg`), W.icon);
      w.nextAt = st.gameTime + W.dur + (15 + Math.random() * 25) * 60;
    }
  }

  weatherInfo() {
    const id = this.state.weather.id;
    return id ? WEATHER[id] : null;
  }

  unlock(id) {
    if (this.state.achievements[id]) return;
    this.state.achievements[id] = Date.now();
    this.state.points += 10;
    this.audio.chime();
    this.notify(t('ach.unlock', { name: t(`ach.${id}.name`) }), '🏆');
  }

  // ---------- Visuales de las piezas ----------

  updateVisuals(dt, time) {
    for (const e of this.entries.values()) {
      const it = e.it;
      const F = FUELS[it.type];
      e.visFlame += (it.flame - e.visFlame) * Math.min(1, dt * 2.5);
      const [rs, ls] = this.shrinkFactors(it);
      if (Math.abs(rs - e.rs) > 0.05 || Math.abs(ls - e.ls) > 0.05) {
        e.rs = rs;
        e.ls = ls;
        resizeBody(e.body, it.type, rs, ls, it.vol + it.char, e.vis.wood);
      }
      const base = e.vis.baseScale;
      if (F.shape === 'log' || F.shape === 'stick') e.vis.mesh.scale.set(base.x * rs, base.y * ls, base.z * rs);
      else e.vis.mesh.scale.copy(base).multiplyScalar(rs);

      const burnt = 1 - it.vol / it.vol0;
      // La superficie se tuesta y ennegrece en cuanto está caliente, mucho antes de consumirse.
      const scRate = (it.state === 'flaming' ? 0.5 + it.flame * 0.4 : 0) + Math.max(0, it.T - 150) / 300;
      if (scRate > 0) e.surfChar = Math.min(1, (e.surfChar || 0) + dt * this.state.speed * scRate / 45);
      const sc = e.surfChar || 0;
      let charV;
      if (F.shape === 'ball') charV = Math.min(1, burnt * 1.4 + (it.state === 'flaming' ? 0.1 : 0));
      else charV = Math.min(1, Math.max(burnt * 1.5, sc * 0.62) + (it.T > 200 ? Math.min(0.2, (it.T - 200) / 1200) : 0));
      let glow = it.glow;
      if (F.shape === 'ball' && it.state === 'flaming') glow = Math.max(glow, 0.9);
      if (it.state === 'flaming') glow = Math.max(glow * 0.7, Math.max(burnt, sc * 0.6) * 0.55 * Math.min(1, it.flame + 0.3));
      const wet = it.moisture > WET_LIMIT ? 1 : Math.max(0, (it.moisture - 0.15) / 0.07);
      setBurnVisual(e.vis, charV, glow * (1 + this.env.bellows * 0.6), wet);
    }
  }

  // ---------- Acciones ----------

  useMatch() {
    if (this.state.matches <= 0) return false;
    this.state.matches--;
    this.state.stats.matchesThisFire++;
    this.state.stats.matchesTotal = (this.state.stats.matchesTotal || 0) + 1;
    return true;
  }

  takeFromInventory(key) {
    const inv = this.state.inventory;
    if (!inv[key]) return false;
    inv[key]--;
    return true;
  }

  poke(x, y, z) {
    this.env.poke = 1;
    this.sparks.burst(x, y, z, 14 + Math.floor(this.sim.bedGlow * 30), 0.7);
    if (this.sim.bedGlow > 0.1) this.audio.crackle(1);
  }

  // Chorro del cubo sobre (x, z); dose son los litros vertidos en este paso.
  pour(x, z, dose) {
    const hit = douseAt(this.sim, x, z, 0.075, dose);
    for (const { it, f, hot } of hit) {
      const e = this.entries.get(it.id);
      if (!e) continue;
      if (it.moisture > WET_LIMIT) e.wasWet = true;
      if (hot && Math.random() < f * dose * 60) {
        const p = e.body.position;
        this.smoke.emit(p.x + (Math.random() - 0.5) * 0.06, p.y + 0.02, p.z + (Math.random() - 0.5) * 0.06, 0.85, 1.6, 0.3);
      }
    }
    const bedHot = this.sim.bedGlow > 0.05;
    if (bedHot && Math.random() < dose * 25) this.smoke.emit(x, BED.y + 0.02, z, 0.85, 1.4, 0.3);
    return hit.some((h) => h.hot) || bedHot;
  }

  buy(key, price, qty = 1) {
    if (this.state.points < price) return false;
    this.state.points -= price;
    if (key === 'matches') this.state.matches += qty;
    else this.state.inventory[key] = (this.state.inventory[key] || 0) + qty;
    return true;
  }

  gardenStatus() {
    return Math.max(0, this.state.gardenReadyAt - this.state.gameTime);
  }

  gatherGarden() {
    if (this.gardenStatus() > 0) return null;
    const raining = this.state.weather.id === 'rain';
    const loot = {};
    const pool = ['pinecone', 'pinecone', 'kindling', 'kindling', 'pine_thin', 'pine_thin', 'pine', 'birch', 'oak'];
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      const wet = WETTABLE.includes(t) && (raining || Math.random() < 0.3);
      const k = wet ? `${t}:wet` : t;
      loot[k] = (loot[k] || 0) + 1;
      this.state.inventory[k] = (this.state.inventory[k] || 0) + 1;
    }
    if (Math.random() < 0.4) {
      loot.paper = 2;
      this.state.inventory.paper = (this.state.inventory.paper || 0) + 2;
    }
    this.state.gardenReadyAt = this.state.gameTime + GARDEN_WAIT;
    return loot;
  }

  remainingMinutes() {
    let t = 0;
    for (const it of this.sim.items) {
      if (!it.everLit && it.state === 'cold') continue;
      const F = FUELS[it.type];
      t = Math.max(t, (it.vol / it.vol0) * F.flameTime + (it.char / (it.m0 - it.vol0)) * F.emberTime * 0.6);
    }
    return t / 60;
  }

  // ---------- Guardado ----------

  serialize() {
    return {
      v: 1,
      savedAt: Date.now(),
      state: this.state,
      sim: { bed: this.sim.bed, bedHeat: this.sim.bedHeat, bedGlow: this.sim.bedGlow, ash: this.sim.ash, o2: this.sim.o2 },
      items: [...this.entries.values()].map((e) => ({
        type: e.it.type, key: e.key, id: e.it.id, seed: e.seed, wasWet: e.wasWet,
        m0: e.it.m0, vol: e.it.vol, char: e.it.char, moisture: e.it.moisture, T: e.it.T,
        state: e.it.state, everLit: e.it.everLit, flame: e.it.flame, glow: e.it.glow, surfChar: e.surfChar || 0,
        p: [e.body.position.x, e.body.position.y, e.body.position.z],
        q: [e.body.quaternion.x, e.body.quaternion.y, e.body.quaternion.z, e.body.quaternion.w],
      })),
    };
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize()));
    } catch (err) {
      console.warn('No se pudo guardar', err);
    }
  }

  load() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    } catch {
      data = null;
    }
    if (!data || data.v !== 1) return null;
    this.state = Object.assign(defaultState(), data.state);
    this.state.stats = Object.assign(defaultState().stats, data.state.stats);
    this.migrateGarden(data.savedAt);
    Object.assign(this.sim, data.sim);
    for (const s of data.items) {
      ensureNextId(s.id);
      const e = this.addFuel(s.key || s.type, new THREE.Vector3(...s.p), new THREE.Quaternion(...s.q), {
        seed: s.seed,
        item: { id: s.id, m0: s.m0, vol: s.vol, char: s.char, moisture: s.moisture, T: s.T, state: s.state, everLit: s.everLit },
      });
      e.it.flame = s.flame || 0;
      e.it.glow = s.glow || 0;
      e.wasWet = s.wasWet;
      e.surfChar = s.surfChar ?? (s.everLit ? 0.8 : 0);
      e.visFlame = e.it.flame;
      e.body.sleep();
    }
    return data.savedAt;
  }

  reset() {
    for (const id of [...this.entries.keys()]) this.removeEntry(id);
    this.state = defaultState();
    this.sim = createSim();
    localStorage.removeItem(SAVE_KEY);
  }

  // Partidas antiguas guardaban la hora real en milisegundos. El jardín espera
  // 8 minutos del mismo reloj que el fuego, así que acelera con el ritmo del tiempo.
  migrateGarden(savedAt) {
    const st = this.state;
    if (st.gardenReadyAt > 1e11) {
      const left = Math.max(0, (st.gardenReadyAt - (savedAt || Date.now())) / 1000);
      st.gardenReadyAt = st.gameTime + left;
    }
  }

  // Simula el tiempo transcurrido sin la pestaña abierta.
  catchUp(seconds) {
    if (seconds < 2) return null;
    const maxS = Math.min(seconds, 7 * 24 * 3600);
    const before = { points: this.state.points, alive: this.isAlive(), items: this.entries.size };
    for (const e of this.entries.values()) this.updateSeg(e);
    computeCoupling(this.sim);
    const env = { ...this.env, bellows: 0, poke: 0, match: null };
    let t = 0;
    let wentOutAt = null;
    while (t < maxS && !this.state.dead) {
      const busy = this.sim.items.some((i) => i.state !== 'cold') || this.sim.bedGlow > 0.002;
      const dt = !busy ? 30 : maxS > 3 * 3600 ? 4 : 1;
      env.Tamb = this.state.room;
      env.supply = 1 + (this.state.weather.id === 'wind' ? 0.35 : 0);
      stepSim(this.sim, dt, env);
      this.handleEvents(false);
      if (!this.sim.coupling) computeCoupling(this.sim);
      this.tickEconomy(dt);
      if (this.state.dead) break;
      if (before.alive && wentOutAt === null && !this.isAlive()) wentOutAt = t;
      t += dt;
    }
    this.level = fireLevel(this.sim);
    return {
      seconds,
      pointsGained: this.state.points - before.points,
      wasAlive: before.alive,
      aliveNow: this.isAlive(),
      wentOutAgo: wentOutAt !== null ? seconds - wentOutAt : null,
      consumed: before.items - this.entries.size,
    };
  }
}
