import * as THREE from 'three';

// Llamas: láminas que giran solo alrededor del eje vertical (siempre de pie,
// se mire desde donde se mire) con un campo de densidad de ruido deformado.
// Se mezclan con alfa premultiplicado para que al solaparse no se quemen a blanco.

const NOISE_GLSL = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}`;

const vertexShader = `
uniform vec2 uSize;
uniform float uLean;
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCam = cameraPosition - center;
  vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(fwd.z, 0.0, -fwd.x);
  // Al mirar desde arriba la lámina se ve de canto: se ensancha un poco para compensar.
  vFacing = clamp(abs(normalize(toCam).y), 0.0, 1.0);
  vec2 p = position.xy * uSize;
  p.x *= 1.0 + vFacing * 0.6;
  vec3 world = center + right * (p.x + uLean * uv.y * uv.y * uSize.y) + vec3(0.0, p.y, 0.0);
  world += fwd * 0.01;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const fragmentShader = `
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uO2;
uniform float uBlue;
uniform float uSmall;
varying vec2 vUv;
varying float vFacing;
${NOISE_GLSL}

vec3 fireRamp(float t) {
  vec3 c = mix(vec3(0.35, 0.02, 0.0), vec3(0.95, 0.2, 0.01), smoothstep(0.0, 0.3, t));
  c = mix(c, vec3(1.0, 0.5, 0.07), smoothstep(0.25, 0.6, t));
  c = mix(c, vec3(1.0, 0.83, 0.45), smoothstep(0.6, 0.92, t));
  return c * (0.5 + t * t * 2.6);
}

void main() {
  vec2 uv = vUv;
  float y = uv.y;
  float t = uTime * (1.0 + fract(uSeed * 7.31) * 0.25);
  float sd = uSeed * 13.7;

  // Deformación del dominio: el aire caliente retuerce la llama al subir.
  vec2 q = vec2(uv.x * 2.0 + sd, y * 1.3 - t * 0.9);
  vec2 w = vec2(fbm(q), fbm(q + vec2(5.2, 1.3) - t * 0.15));
  float sway = (w.x - 0.5) * 0.9 * y * y + sin(t * 0.8 + sd) * 0.05 * y;
  float x = (uv.x - 0.5) * 2.0 + sway;

  // Lenguas estiradas en vertical que suben más rápido que el cuerpo.
  float n = fbm(vec2(x * 1.9 + w.y * 1.2 + sd, y * 1.6 - t * 2.1));
  float n2 = noise(vec2(x * 5.0 + sd, y * 4.0 - t * 3.4));

  float prof = pow(max(1.0 - y, 0.0), 0.7);
  float d = abs(x) / (prof * 0.95 + 0.04);
  float dens = (1.0 - d) * 1.3 + (n - 0.5) * 2.2 + (n2 - 0.5) * 0.45 - y * (1.05 + uSmall * 0.5);
  dens *= smoothstep(0.0, 0.07, y);
  dens = clamp(dens, 0.0, 1.0);
  if (dens < 0.01) discard;

  // Temperatura: máxima en el núcleo bajo, más roja hacia los bordes y la punta.
  float temp = dens * (1.15 - y * 0.75) * mix(0.55, 1.0, clamp(uO2, 0.0, 1.0));
  temp = clamp(temp * (0.75 + uIntensity * 0.35), 0.0, 1.0);
  vec3 col = fireRamp(temp);

  // Raíz azulada y oscura junto a la madera cuando hay buen tiro.
  float root = (1.0 - smoothstep(0.0, 0.12, y)) * smoothstep(0.2, 0.6, dens) * uBlue;
  col = mix(col, vec3(0.08, 0.12, 0.45), root * 0.55);

  float a = smoothstep(0.0, 0.35, dens) * clamp(uIntensity, 0.0, 1.0) * mix(0.8, 0.55, vFacing);
  gl_FragColor = vec4(col * a, a * 0.75);
}`;

export function createFlameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uIntensity: { value: 1 },
      uSize: { value: new THREE.Vector2(0.2, 0.4) },
      uLean: { value: 0 },
      uO2: { value: 1 },
      uBlue: { value: 0.5 },
      uSmall: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    side: THREE.DoubleSide,
  });
}

export class FlameSystem {
  constructor(scene, max = 140) {
    this.pool = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, createFlameMaterial());
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 10;
      scene.add(m);
      this.pool.push(m);
    }
    this.used = 0;
  }

  begin() {
    this.used = 0;
  }

  // x,y,z = base de la llama; w,h = tamaño; intensity 0..1+
  emit(x, y, z, w, h, intensity, seed, time, o2 = 1, lean = 0, blue = 0.5) {
    if (this.used >= this.pool.length || intensity < 0.01) return;
    const m = this.pool[this.used++];
    m.visible = true;
    m.position.set(x, y, z);
    const u = m.material.uniforms;
    u.uTime.value = time;
    u.uSeed.value = seed;
    u.uIntensity.value = Math.min(1.4, intensity);
    u.uSize.value.set(w, h);
    u.uO2.value = o2;
    u.uLean.value = lean;
    u.uBlue.value = blue;
    u.uSmall.value = h < 0.12 ? 1 - h / 0.12 : 0;
  }

  end() {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
