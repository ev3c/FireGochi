import * as THREE from 'three';
import { FUELS } from '../sim/fuels.js';
import { valueNoise } from '../util/noise.js';
import { BED } from '../scene/layout.js';

// Traduce el estado de la simulación a llamas, luces, humo y chispas.
export class FireView {
  constructor({ flames, sparks, smoke, bed, lights, iron }) {
    this.flames = flames;
    this.sparks = sparks;
    this.smoke = smoke;
    this.bed = bed;
    this.lights = lights;
    this.iron = iron;
    this.centroid = new THREE.Vector3(0, 0.2, -0.1);
    this.smoothPower = 0;
    this.sparkAcc = 0;
    this.smokeLight = new THREE.Color();
  }

  update(dt, time, game, match) {
    const sim = game.sim;
    const bellows = game.env.bellows;
    const fl = this.flames;
    fl.begin();

    let wSum = 0;
    const c = new THREE.Vector3();
    let flameTotal = 0;
    const sources = [];
    // Muchas láminas superpuestas se suman hasta saturar a blanco; se atenúan con el tamaño del fuego.
    const damp = 1 / (1 + (this.prevFlame || 0) * 0.18);

    for (const e of game.entries.values()) {
      const it = e.it;
      const F = FUELS[it.type];
      const f = e.visFlame;
      const s = it.seg;
      if (f > 0.01) {
        const len = Math.hypot(s.bx - s.ax, s.by - s.ay, s.bz - s.az);
        const n = F.shape === 'log' ? Math.max(3, Math.round(len / 0.075)) : F.shape === 'stick' ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const t = n === 1 ? 0.5 : 0.1 + (0.8 * k) / (n - 1);
          const x = s.ax + (s.bx - s.ax) * t;
          const y = s.ay + (s.by - s.ay) * t;
          const z = s.az + (s.bz - s.az) * t;
          // Cada lámina late a su ritmo: unas crecen mientras otras se recogen.
          const flick = 0.55 + 0.75 * valueNoise(time * 1.7 + e.seed * 3.1 + k * 1.9, k * 5.3 + e.seed, 1);
          const mid = 1 - Math.abs(t - 0.5) * 0.9;
          let w, h;
          if (F.shape === 'log') { w = 0.07 + s.r * 1.3; h = (0.05 + 0.4 * f) * F.flameScale * (0.6 + mid * 0.6); }
          else if (F.shape === 'ball') { w = 0.16; h = 0.1 + 0.36 * f; }
          else if (F.shape === 'stick') { w = 0.06; h = 0.04 + 0.2 * f; }
          else { w = 0.08; h = 0.06 + 0.24 * f; }
          h *= flick * (1 + bellows * 0.35);
          const inten = Math.min(1, 0.3 + f * 0.75) * damp;
          const blue = it.state === 'ember' ? 0.9 : 0.4;
          fl.emit(x, y + s.r * 0.6, z, w, h, inten, e.seed * 1.37 + k * 2.71, time, sim.o2, Math.sin(time * 0.6 + e.seed + k) * 0.08, blue);
          sources.push([x, y + s.r + h * 0.6, z, f]);
        }
        const wgt = f * F.flameScale;
        c.x += (s.ax + s.bx) * 0.5 * wgt;
        c.y += (s.ay + s.by) * 0.5 * wgt;
        c.z += (s.az + s.bz) * 0.5 * wgt;
        wSum += wgt;
        flameTotal += wgt;
      }

      // Humo y vapor por pieza.
      const sx = (s.ax + s.bx) * 0.5, sy = (s.ay + s.by) * 0.5 + s.r, sz = (s.az + s.bz) * 0.5;
      const leak = sim.o2 < 0.65 ? (0.65 - sim.o2) * 1.4 : 0;
      if (it.smoke > 0.01 && Math.random() < it.smoke * 10 * dt) this.smoke.emit(sx, sy, sz, 0.1 + Math.random() * 0.06, 1 + it.smoke, leak);
      if (it.steam > 0.01 && it.moisture > 0.18 && Math.random() < it.steam * 12 * dt) this.smoke.emit(sx, sy, sz, 0.8, 0.8, 0);
    }

    this.prevFlame = flameTotal;
    if (wSum > 0) {
      c.multiplyScalar(1 / wSum);
      this.centroid.lerp(c, Math.min(1, dt * 2));
    }

    // Lenguas altas cuando el fuego es grande: es lo que da el aspecto de la imagen.
    const big = Math.min(4, Math.floor(flameTotal * 0.8));
    for (let k = 0; k < big; k++) {
      const off = (k - (big - 1) / 2) * 0.12 + (valueNoise(time * 0.3, k * 4, 8) - 0.5) * 0.06;
      const h = Math.min(0.72, 0.2 + flameTotal * 0.08) * (0.55 + 0.7 * valueNoise(time * 0.8 + k * 7, 3, 7)) * (1 + bellows * 0.3);
      fl.emit(this.centroid.x + off, this.centroid.y + 0.06, this.centroid.z, 0.17 + flameTotal * 0.012, h, Math.min(0.85, flameTotal * 0.18) * damp, 50 + k * 3.3, time, sim.o2, Math.sin(time * 0.4 + k) * 0.1, 0.2);
    }

    // Lamiditas sobre el lecho de brasas cuando está muy vivo.
    if (sim.bedGlow > 0.25) {
      const n = Math.floor(sim.bedGlow * 6);
      for (let k = 0; k < n; k++) {
        const x = (valueNoise(k * 3.3, time * 0.05, 2) - 0.5) * BED.w * 0.6;
        fl.emit(x, BED.y + 0.01, BED.z + (valueNoise(k, 9, 3) - 0.5) * 0.2, 0.06, 0.05 + sim.bedGlow * 0.06 * (1 + bellows), sim.bedGlow * 0.6, 90 + k, time, sim.o2, 0, 0.9);
      }
    }

    // Llama de la cerilla.
    if (match) fl.emit(match.x, match.y - 0.004, match.z, 0.035, 0.06 * match.life + 0.02, 0.9, 7.7, time, 1, 0, 0.8);
    fl.end();

    // Luces con parpadeo.
    const power = sim.power;
    this.smoothPower += (power - this.smoothPower) * Math.min(1, dt * 1.5);
    const P = this.smoothPower;
    const flick = 0.82 + 0.18 * valueNoise(time * 8, 1, 4) + 0.08 * valueNoise(time * 23, 2, 5);
    const L = this.lights;
    // Saturación suave: un fuego grande ilumina más, pero sin quemar la imagen.
    const raw = P * 0.42 + flameTotal * 0.18;
    L.fireLight.intensity = 2.2 * (1 - Math.exp(-raw / 2.2)) * flick * (1 + bellows * 0.3);
    L.fireLight.position.set(this.centroid.x, this.centroid.y + 0.14, this.centroid.z + 0.06);
    L.fillLight.intensity = 1.0 * (1 - Math.exp(-(P * 0.2 + flameTotal * 0.09))) * (0.85 + 0.15 * valueNoise(time * 5, 9, 2));
    L.fillLight.position.set(this.centroid.x + Math.sin(time * 1.7) * 0.05, this.centroid.y + 0.32, this.centroid.z + 0.08);
    L.emberLight.intensity = (sim.bedGlow * 0.2 + this.glowTotal(game) * 0.06) * (1 + bellows * 0.6) * (0.9 + 0.1 * Math.sin(time * 1.3));
    L.roomLight.intensity = P * 0.25 * flick;
    if (match) {
      L.fireLight.intensity += 0.06 * match.life;
      if (P < 0.3) L.fireLight.position.set(match.x, match.y + 0.03, match.z);
    }

    // La parrilla se pone al rojo si hay muchas brasas.
    const ironGlow = Math.min(0.6, sim.bedGlow * 0.3 + P * 0.02);
    this.iron.emissive.setRGB(0.35 * ironGlow * ironGlow, 0.04 * ironGlow * ironGlow, 0);

    // Chispas continuas.
    this.sparkAcc += (flameTotal * 2.5 + sim.bedGlow * 2) * (1 + bellows * 3) * dt;
    while (this.sparkAcc > 1 && sources.length) {
      this.sparkAcc -= 1;
      const s = sources[Math.floor(Math.random() * sources.length)];
      this.sparks.burst(s[0], s[1], s[2], 1, 0.8 + s[3] * 0.4);
    }
    if (!sources.length) {
      if (sim.bedGlow > 0.05 && this.sparkAcc > 1) {
        this.sparkAcc = 0;
        this.sparks.burst((Math.random() - 0.5) * 0.4, BED.y + 0.02, BED.z, 1, 0.5);
      } else if (this.sparkAcc > 1) this.sparkAcc = 0;
    }

    this.sparks.update(dt, time);
    this.smokeLight.setRGB(1, 0.55, 0.25).multiplyScalar(Math.min(1, 0.1 + P * 0.25));
    this.smoke.update(dt, time, this.smokeLight);
    this.bed.update(sim);
    return { flameTotal, power: P };
  }

  glowTotal(game) {
    let g = 0;
    for (const e of game.entries.values()) g += e.it.glow * Math.sqrt(e.it.m0);
    return g;
  }
}
