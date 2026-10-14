import * as THREE from '../../vendor/three/three.module.js';
import { BOX } from '../scene/layout.js';
import { HASH_GLSL, SHADER_TIME_WRAP } from './flames.js';

// Sistema de partículas en CPU dibujado como THREE.Points.

const sparkVS = `
attribute float aSize;
attribute float aLife;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const sparkFS = `
varying float vLife;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core = pow(1.0 - r, 2.0);
  vec3 c = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.75, 0.35), vLife);
  gl_FragColor = vec4(c * core * (0.4 + vLife * 2.6), core);
}`;

const smokeVS = `
attribute float aSize;
attribute float aLife;
attribute float aShade;
attribute float aSeed;
varying float vLife;
varying float vShade;
varying float vSeed;
void main() {
  vLife = aLife; vShade = aShade; vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (600.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const smokeFS = `
uniform float uTime;
uniform vec3 uLight;
varying float vLife;
varying float vShade;
varying float vSeed;
${HASH_GLSL}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float n = noise(gl_PointCoord * 4.0 + vSeed * 10.0 + vec2(0.0, uTime * 0.3)) * 0.6 + noise(gl_PointCoord * 9.0 - vSeed * 5.0) * 0.4;
  float a = smoothstep(1.0, 0.2, r) * (0.4 + n * 0.8);
  float fade = smoothstep(0.0, 0.15, vLife) * smoothstep(1.0, 0.75, vLife);
  vec3 base = vec3(vShade);
  vec3 c = base * (0.25 + uLight * 0.75);
  gl_FragColor = vec4(c, a * fade * mix(0.1, 0.09, vShade));
}`;

class Pool {
  constructor(max, extra = []) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.lifeAttr = new Float32Array(max);
    this.extra = {};
    for (const e of extra) this.extra[e] = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.lifeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    for (const e of extra) this.geo.setAttribute(e, new THREE.BufferAttribute(this.extra[e], 1).setUsage(THREE.DynamicDrawUsage));
  }
  spawn() {
    if (this.n >= this.max) return -1;
    return this.n++;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[j * 3 + k];
      this.vel[i * 3 + k] = this.vel[j * 3 + k];
    }
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.size[i] = this.size[j];
    this.lifeAttr[i] = this.lifeAttr[j];
    for (const e in this.extra) this.extra[e][i] = this.extra[e][j];
  }
  flush() {
    this.geo.setDrawRange(0, this.n);
    for (const k in this.geo.attributes) this.geo.attributes[k].needsUpdate = true;
  }
}

export class Sparks {
  constructor(scene) {
    this.p = new Pool(1500);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: sparkVS,
      fragmentShader: sparkFS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.p.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    scene.add(this.points);
    this.acc = 0;
  }
  burst(x, y, z, count, power = 1) {
    for (let c = 0; c < count; c++) {
      const i = this.p.spawn();
      if (i < 0) return;
      this.p.pos.set([x + (Math.random() - 0.5) * 0.06, y, z + (Math.random() - 0.5) * 0.04], i * 3);
      const a = Math.random() * Math.PI * 2;
      const s = (0.2 + Math.random() * 0.6) * power;
      this.p.vel.set([Math.cos(a) * s * 0.5, (0.6 + Math.random() * 1.4) * power, Math.sin(a) * s * 0.3], i * 3);
      this.p.maxLife[i] = this.p.life[i] = 0.6 + Math.random() * 1.6;
      this.p.size[i] = 0.006 + Math.random() * 0.012;
    }
  }
  update(dt, time) {
    const p = this.p;
    for (let i = p.n - 1; i >= 0; i--) {
      p.life[i] -= dt;
      const y = p.pos[i * 3 + 1];
      if (p.life[i] <= 0 || y > BOX.height + 0.3) { p.kill(i); continue; }
      const k = i * 3;
      const turb = Math.sin(time * 7 + i * 1.3) * 0.9;
      p.vel[k] += turb * dt;
      p.vel[k + 1] += (0.6 - p.vel[k + 1] * 0.6) * dt;
      p.vel[k + 2] += (-0.25 - p.vel[k + 2]) * 0.6 * dt;
      p.vel[k] *= 1 - 0.8 * dt;
      p.pos[k] += p.vel[k] * dt;
      p.pos[k + 1] += p.vel[k + 1] * dt;
      p.pos[k + 2] += p.vel[k + 2] * dt;
      p.pos[k + 2] = Math.max(BOX.zBack + 0.02, p.pos[k + 2]);
      p.lifeAttr[i] = p.life[i] / p.maxLife[i];
    }
    p.flush();
  }
}

export class Smoke {
  constructor(scene) {
    this.p = new Pool(700, ['aShade', 'aSeed']);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 0.6, 0.3) } },
      vertexShader: smokeVS,
      fragmentShader: smokeFS,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.p.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    scene.add(this.points);
    this.room = 0;
  }
  // shade: 0.12 humo oscuro, 0.85 vapor blanco
  emit(x, y, z, shade, size = 1, leak = 0) {
    const p = this.p;
    const i = p.spawn();
    if (i < 0) return;
    p.pos.set([x + (Math.random() - 0.5) * 0.08, y, z + (Math.random() - 0.5) * 0.05], i * 3);
    p.vel.set([(Math.random() - 0.5) * 0.05, 0.18 + Math.random() * 0.15, leak > Math.random() ? 0.12 : -0.03], i * 3);
    p.maxLife[i] = p.life[i] = 3 + Math.random() * 3;
    p.size[i] = 0.03 * size;
    p.extra.aShade[i] = shade;
    p.extra.aSeed[i] = Math.random();
  }
  update(dt, time, light) {
    const p = this.p;
    this.mat.uniforms.uTime.value = time % SHADER_TIME_WRAP;
    this.mat.uniforms.uLight.value.copy(light);
    for (let i = p.n - 1; i >= 0; i--) {
      p.life[i] -= dt;
      const k = i * 3;
      const y = p.pos[k + 1];
      if (p.life[i] <= 0 || y > BOX.height + 0.5) { p.kill(i); continue; }
      // Tiro de la chimenea: arrastra hacia atrás y arriba al acercarse a la boca.
      const draw = Math.max(0, y - 0.5);
      p.vel[k + 1] += (0.12 + draw * 0.4) * dt;
      p.vel[k + 2] += (p.vel[k + 2] > 0.05 ? 0.02 : -0.08 * draw) * dt;
      p.vel[k] += Math.sin(time * 0.9 + i) * 0.04 * dt;
      p.pos[k] += p.vel[k] * dt;
      p.pos[k + 1] += p.vel[k + 1] * dt;
      p.pos[k + 2] += p.vel[k + 2] * dt;
      p.pos[k + 2] = Math.max(BOX.zBack + 0.03, p.pos[k + 2]);
      p.size[i] += dt * 0.09;
      p.lifeAttr[i] = 1 - p.life[i] / p.maxLife[i];
    }
    p.flush();
  }
}
