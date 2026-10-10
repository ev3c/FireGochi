import * as THREE from 'three';
import { BED } from '../scene/layout.js';
import { sharedTime } from '../fuel/meshes.js';
import { mulberry32, fbm as fbmJS } from '../util/noise.js';

// Lecho bajo la parrilla: un montón de ceniza que crece con el uso y trozos de carbón encima.

const MOUND_H = 0.034;

const bedHead = `
uniform float uTime; uniform float uGlow; uniform float uAsh; uniform float uCoal;
varying vec2 vBedUv; varying float vH;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; } return s; }
float bedAlpha; vec3 bedEm;
vec3 bedColor() {
  vec2 vUv = vBedUv;
  vec2 p = vUv * vec2(9.0, 4.5);
  vec2 c = (vUv - 0.5) * vec2(2.0, 2.0);
  float d = length(c) + (fbm(p * 0.8) - 0.5) * 0.35;
  // La mancha de ceniza se ensancha según se acumula.
  float spread = 0.45 + uAsh * 0.5;
  float edge = smoothstep(spread, spread - 0.35, d);
  float n = fbm(p * 2.0);
  float ash = clamp(uAsh * 1.4 * (0.45 + n), 0.0, 1.0) * edge;
  vec3 ashCol = mix(vec3(0.2, 0.19, 0.18), vec3(0.42, 0.4, 0.37), smoothstep(0.35, 0.75, fbm(p * 6.0 + 7.0)));
  ashCol *= 0.8 + vH / ${MOUND_H.toFixed(3)} * 0.25;
  vec3 col = mix(vec3(0.05, 0.045, 0.04), ashCol, ash);
  // Carbón menudo mezclado con la ceniza, concentrado bajo el fuego.
  float coalArea = smoothstep(0.25 + uCoal * 0.5, 0.05 + uCoal * 0.2, d);
  float coal = smoothstep(0.6 - uCoal * 0.22, 0.68 - uCoal * 0.22, fbm(p * 4.5 + 3.0)) * coalArea * min(1.0, uCoal * 3.0);
  col = mix(col, vec3(0.025, 0.022, 0.02), coal);
  float pulse = 0.65 + 0.35 * sin(uTime * 0.8 + n * 12.0) * sin(uTime * 0.37 + p.x);
  float hot = smoothstep(0.35, 0.8, fbm(p * 6.0 - uTime * 0.05));
  float g = coal * hot * uGlow * pulse;
  // La ceniza fina que rodea las brasas también enrojece un poco.
  float gAsh = ash * coalArea * uGlow * 0.12 * (0.6 + 0.4 * pulse);
  bedEm = mix(vec3(0.9, 0.12, 0.01), vec3(1.0, 0.5, 0.1), g) * (g * 3.5 + gAsh);
  bedAlpha = edge * clamp(max(ash * 1.3, coal), 0.0, 1.0);
  return col;
}`;

export class EmberBed {
  constructor(scene) {
    // Material iluminado: la ceniza recibe la luz y las sombras del fuego.
    this.bedU = { uTime: sharedTime, uGlow: { value: 0 }, uAsh: { value: 0 }, uCoal: { value: 0 } };
    this.mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false, emissive: 0xffffff });
    this.mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.bedU);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vBedUv; varying float vH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vBedUv = position.xz / vec2(${BED.w.toFixed(3)}, ${BED.d.toFixed(3)}) + 0.5; vH = position.y;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\n' + bedHead)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = bedColor(); diffuseColor.a = bedAlpha;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = bedEm;');
    };
    this.mat.customProgramCacheKey = () => 'emberbed';
    const geo = new THREE.PlaneGeometry(BED.w, BED.d, 72, 36);
    geo.rotateX(-Math.PI / 2);
    this.geo = geo;
    const pos = geo.attributes.position;
    this.baseNoise = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      this.baseNoise[i] = fbmJS(pos.getX(i) * 9 + 5, pos.getZ(i) * 9 + 2, 4, 11);
    }
    this.plane = new THREE.Mesh(geo, this.mat);
    this.plane.receiveShadow = true;
    this.plane.position.set(0, BED.y, BED.z);
    this.plane.renderOrder = 1;
    scene.add(this.plane);

    // Trozos de carbón: los primeros caen bajo el centro del fuego, los siguientes se reparten alrededor.
    const MAX = 170;
    const lgeo = new THREE.IcosahedronGeometry(1, 0);
    this.lumpUniforms = { uGlow: { value: 0 }, uAshCoat: { value: 0 }, uTime: sharedTime };
    const lmat = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.95, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 });
    lmat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.lumpUniforms);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vId; varying vec3 vLp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvId = float(gl_InstanceID); vLp = position;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vId; varying vec3 vLp; uniform float uGlow; uniform float uTime; uniform float uAshCoat;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float rnd = fract(sin(vId * 12.9898) * 43758.5453);
          float rnd2 = fract(sin(vId * 78.233) * 24634.6345);
          float coat = uAshCoat * smoothstep(-0.1, 0.7, vLp.y) * (0.35 + rnd2 * 0.65);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.48, 0.45), clamp(coat, 0.0, 1.0));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float pulse = 0.55 + 0.45 * sin(uTime * (0.5 + rnd) + rnd * 30.0);
          float under = smoothstep(0.6, -0.4, vLp.y);
          float g = uGlow * pulse * (0.1 + rnd * rnd * 1.3) * (0.3 + under * 0.7) * (1.0 - clamp(coat, 0.0, 1.0) * 0.75);
          totalEmissiveRadiance += mix(vec3(0.9, 0.12, 0.01), vec3(1.0, 0.45, 0.08), g * 0.6) * g * 3.0;`);
    };
    lmat.customProgramCacheKey = () => 'lump';
    this.lumps = new THREE.InstancedMesh(lgeo, lmat, MAX);
    const rnd = mulberry32(42);
    this.lumpData = [];
    for (let i = 0; i < MAX; i++) {
      const r = Math.sqrt((i + rnd()) / MAX);
      const a = rnd() * Math.PI * 2;
      this.lumpData.push({
        x: Math.cos(a) * r * BED.w * 0.34,
        z: Math.sin(a) * r * BED.d * 0.36,
        s: 0.007 + rnd() * 0.017,
        sx: 1 + rnd() * 0.6,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)),
      });
    }
    this.lumps.count = 0;
    // Su esfera envolvente se calcularía con cero instancias y quedarían siempre recortados.
    this.lumps.frustumCulled = false;
    this.lumps.receiveShadow = true;
    scene.add(this.lumps);
    this.max = MAX;
    this.lastAsh = -1;
    this.lastCoal = -1;
  }

  // Altura del montón (coordenadas locales del lecho).
  height(x, z, ash, coal, n) {
    const mound = Math.exp(-((x / 0.34) ** 2 + (z / 0.19) ** 2));
    return (MOUND_H * Math.pow(ash, 0.8) * mound + 0.008 * coal * mound) * (0.7 + n * 0.6);
  }

  rebuild(ash, coal, sizeK) {
    const pos = this.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.height(pos.getX(i), pos.getZ(i), ash, coal, this.baseNoise[i]));
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < this.max; i++) {
      const L = this.lumpData[i];
      const s = L.s * sizeK;
      const h = this.height(L.x, L.z, ash, coal, fbmJS(L.x * 9 + 5, L.z * 9 + 2, 4, 11));
      v.set(L.x, BED.y + h + s * 0.4, BED.z + L.z);
      sc.set(s * L.sx, s * 0.7, s);
      m.compose(v, L.q, sc);
      this.lumps.setMatrixAt(i, m);
    }
    this.lumps.instanceMatrix.needsUpdate = true;
  }

  update(sim) {
    const coal = Math.min(1, sim.bed / 0.35);
    const ash = Math.min(1, sim.ash / 0.1);
    if (Math.abs(ash - this.lastAsh) > 0.01 || Math.abs(coal - this.lastCoal) > 0.02) {
      this.lastAsh = ash;
      this.lastCoal = coal;
      this.rebuild(ash, coal, 0.7 + 0.5 * Math.min(1, sim.bed / 0.4));
    }
    this.bedU.uCoal.value = coal;
    this.bedU.uAsh.value = Math.min(1, ash + 0.12);
    this.bedU.uGlow.value = sim.bedGlow * 1.2;
    this.lumpUniforms.uGlow.value = sim.bedGlow * 1.3;
    // Con el lecho frío, la ceniza va cubriendo los carbones por arriba.
    this.lumpUniforms.uAshCoat.value = Math.min(1, ash * 0.55 + Math.max(0, 0.4 - sim.bedGlow) * 1.2);
    this.lumps.count = Math.round(Math.min(1, sim.bed / 0.3 + (sim.ash > 0.005 ? 0.05 : 0)) * this.max);
  }
}
