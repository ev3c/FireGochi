import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FUELS } from '../sim/fuels.js';
import { barkTextures, endGrainTexture, splitWoodTextures, crackTexture, newspaperTexture } from '../scene/textures.js';
import { mulberry32, valueNoise } from '../util/noise.js';
import { buildWood } from './woodGeometry.js';

export const sharedTime = { value: 0 };

// Añade carbonizado (uChar) y brillo de brasa (uGlow) a un material estándar.
function burnable(mat, crackScale = [1, 1], wetUniform) {
  const u = {
    uChar: { value: 0 },
    uGlow: { value: 0 },
    uWet: wetUniform || { value: 0 },
    uCrack: { value: crackTexture() },
    uCrackScale: { value: new THREE.Vector2(...crackScale) },
    uTime: sharedTime,
  };
  mat.userData.burn = u;
  mat.customProgramCacheKey = () => 'burnable';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBurnUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvBurnUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vBurnUv;
        uniform float uChar; uniform float uGlow; uniform float uWet; uniform float uTime;
        uniform sampler2D uCrack; uniform vec2 uCrackScale;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec4 crk = texture2D(uCrack, vBurnUv * uCrackScale);
        float charAmt = clamp(uChar * 1.25 + (crk.g - 0.5) * 0.35 - 0.1, 0.0, 1.0);
        vec3 charCol = vec3(0.028, 0.025, 0.023) * (0.55 + crk.b * 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, charCol, charAmt);
        diffuseColor.rgb *= mix(1.0, 0.55, uWet);
        float ashy = smoothstep(0.75, 1.0, uChar) * (1.0 - crk.r) * 0.35;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.4, 0.38), ashy * (1.0 - uGlow * 0.6));`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.45, uWet * 0.8);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float wave = 0.6 + 0.4 * sin(uTime * 1.3 + vBurnUv.x * 23.0 + crk.g * 6.2831) * sin(uTime * 0.7 + vBurnUv.y * 11.0);
        float cr = crk.r * smoothstep(0.15, 0.6, uChar + 0.2);
        float g = uGlow * (cr * 1.6 + charAmt * 0.12 * crk.b) * wave;
        vec3 hot = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.55, 0.15), clamp(uGlow * cr, 0.0, 1.0));
        totalEmissiveRadiance += hot * g * 2.6;`
      );
  };
  return u;
}

// Troncos, ramas y astillas: geometría extruida con corteza en relieve.
function makeWood(type, F, rnd, wet) {
  const species = F.species || 'pine';
  const wood = buildWood(type, F, rnd);
  const bark = barkTextures(species);
  const split = splitWoodTextures(species);
  const wetU = { value: wet ? 1 : 0 };
  const common = { emissive: 0xffffff, emissiveIntensity: 0 };
  const barkMat = new THREE.MeshStandardMaterial({
    ...common,
    map: bark.map,
    normalMap: bark.normal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: species === 'birch' ? 0.75 : 0.96,
  });
  const splitMat = new THREE.MeshStandardMaterial({ ...common, map: split.map, normalMap: split.normal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.92 });
  const endMat = new THREE.MeshStandardMaterial({ ...common, map: endGrainTexture(species), roughness: 0.9 });
  const uniforms = [
    burnable(barkMat, [1.3, 1.3], wetU),
    burnable(splitMat, [1.6, 1.0], wetU),
    burnable(endMat, [1.2, 1.2], wetU),
  ];
  const mesh = new THREE.Mesh(wood.geometry, [barkMat, splitMat, endMat]);
  return { mesh, uniforms, wetU, wood };
}

function makePaper(F, rnd) {
  const geo = new THREE.IcosahedronGeometry(F.radius, 4);
  const pos = geo.attributes.position;
  const s = Math.floor(rnd() * 1000);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = valueNoise(v.x * 4 + 9, v.y * 4 + v.z * 3, s) * 0.6 + valueNoise(v.x * 11, v.y * 11 + v.z * 7, s + 1) * 0.4;
    const facet = Math.abs(Math.sin(v.x * 9 + s) * Math.cos(v.y * 8) * Math.sin(v.z * 7));
    v.multiplyScalar(F.radius * (0.7 + n * 0.45 + facet * 0.08));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const tex = newspaperTexture(1 + Math.floor(rnd() * 3));
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0, side: THREE.DoubleSide });
  const u = burnable(mat, [2, 2]);
  return { mesh: new THREE.Mesh(geo, mat), uniforms: [u], wetU: { value: 0 } };
}

let coneGeoCache = null;
function pineconeGeometry() {
  if (coneGeoCache) return coneGeoCache;
  const parts = [];
  const N = 110, H = 0.11, R = 0.038;
  const core = new THREE.SphereGeometry(R * 0.55, 10, 8);
  core.scale(1, H / (R * 1.1), 1);
  parts.push(core);
  const color = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const y = (t - 0.5) * H * 0.95;
    const prof = Math.pow(Math.sin(Math.PI * (0.08 + t * 0.9)), 0.7);
    const rad = R * (0.35 + 0.65 * prof);
    const a = i * 2.39996;
    const scale = new THREE.BoxGeometry(0.022 * (0.6 + prof * 0.6), 0.004, 0.02 * (0.5 + prof * 0.7));
    scale.translate(0, 0, rad * 0.55);
    scale.rotateX(-0.55 + t * 0.2);
    scale.rotateY(a);
    scale.translate(0, y, 0);
    parts.push(scale);
  }
  for (const p of parts) {
    const n = p.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const shade = 0.7 + Math.sin(k * 1.7) * 0.15;
      color.setRGB(0.38 * shade, 0.22 * shade, 0.11 * shade);
      if (Math.abs(p.attributes.position.getX(k)) + Math.abs(p.attributes.position.getZ(k)) > R * 0.85) color.multiplyScalar(1.35);
      color.toArray(cols, k * 3);
    }
    p.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  const nonIndexed = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  coneGeoCache = mergeGeometries(nonIndexed, false);
  coneGeoCache.computeVertexNormals();
  // UV esféricas para el mapa de grietas.
  const pos = coneGeoCache.attributes.position;
  const uv = coneGeoCache.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, Math.atan2(pos.getZ(i), pos.getX(i)) / (Math.PI * 2) + 0.5, pos.getY(i) / H + 0.5);
  }
  return coneGeoCache;
}

function makeCone(F, rnd, wet) {
  const wetU = { value: wet ? 1 : 0 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: 0xffffff, emissiveIntensity: 0 });
  const u = burnable(mat, [1.5, 1.5], wetU);
  const mesh = new THREE.Mesh(pineconeGeometry(), mat);
  mesh.scale.setScalar(0.85 + rnd() * 0.3);
  return { mesh, uniforms: [u], wetU };
}

export function createFuelMesh(type, seed, wet) {
  const F = FUELS[type];
  const rnd = mulberry32(seed * 7919 + 13);
  let r;
  if (F.shape === 'log' || F.shape === 'stick') r = makeWood(type, F, rnd, wet);
  else if (F.shape === 'cone') r = makeCone(F, rnd, wet);
  else r = makePaper(F, rnd);
  r.mesh.castShadow = true;
  r.mesh.receiveShadow = true;
  r.baseScale = r.mesh.scale.clone();
  return r;
}

export function setBurnVisual(vis, charAmt, glow, wet) {
  for (const u of vis.uniforms) {
    u.uChar.value = charAmt;
    u.uGlow.value = glow;
  }
  vis.wetU.value = wet;
}

export function disposeFuelMesh(vis) {
  const mats = Array.isArray(vis.mesh.material) ? vis.mesh.material : [vis.mesh.material];
  for (const m of mats) m.dispose();
  if (vis.mesh.geometry !== coneGeoCache) vis.mesh.geometry.dispose();
}
