import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildFireplace } from './scene/fireplace.js';
import { createPhysics } from './physics.js';
import { FlameSystem } from './fire/flames.js';
import { Sparks, Smoke } from './fire/particles.js';
import { EmberBed } from './fire/emberBed.js';
import { FireView } from './fire/fireView.js';
import { sharedTime } from './fuel/meshes.js';
import { FireAudio } from './audio.js';
import { Game } from './game.js';
import { Interaction } from './interaction.js';
import { UI } from './ui.js';
import { CameraRig } from './cameraRig.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020101);
scene.fog = new THREE.FogExp2(0x050302, 0.12);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.02, 30);
const rig = new CameraRig(camera);

const fp = buildFireplace(scene);
const phys = createPhysics();
const flames = new FlameSystem(scene);
const sparks = new Sparks(scene);
const smoke = new Smoke(scene);
const bed = new EmberBed(scene);
const audio = new FireAudio();
const ui = new UI();
const game = new Game({ scene, phys, audio, sparks, smoke, notify: (t, i) => ui.toast(t, i) });
const view = new FireView({ flames, sparks, smoke, bed, lights: fp.lights, iron: fp.iron });

const envMeshes = [];
fp.group.traverse((o) => { if (o.isMesh) envMeshes.push(o); });
const ix = new Interaction({ camera, rig, dom: canvas, game, envMeshes, audio, ui, scene });

// Posprocesado: bloom para el resplandor y una viñeta cálida.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.45, 0.85);
composer.addPass(bloom);
const vignette = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uHaze: { value: 0 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uHaze; uniform float uTime; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5, 0.48));
      c.rgb *= smoothstep(0.95, 0.3, d);
      c.rgb = mix(c.rgb, vec3(0.16, 0.14, 0.12) + c.rgb * 0.5, uHaze);
      c.rgb += (h(vUv * 800.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = c;
    }`,
});
composer.addPass(vignette);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Carga de la partida y simulación del tiempo ausente.
const savedAt = game.load();
ui.bind(game, ix);
audio.enabled = game.state.sound;
if (savedAt) {
  const away = (Date.now() - savedAt) / 1000;
  const r = game.catchUp(away);
  if (r && away > 60) ui.showOffline(r);
  ui.refreshInventory();
} else {
  ui.openHelp();
}

let lastSave = 0;
let lastUi = 0;
let lastFrame = performance.now();
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  // Si la pestaña estuvo en segundo plano, simula el hueco de golpe.
  if (dt > 2) {
    const r = game.catchUp(dt);
    if (r && dt > 60) ui.showOffline(r);
    ui.refreshInventory();
    dt = 1 / 60;
  }
  dt = Math.min(dt, 0.05);
  const time = clock.getElapsedTime();
  sharedTime.value = time;

  const input = ix.update(dt, time);
  game.update(dt, time, input);
  const vis = view.update(dt, time, game, input.match);

  // Humo que se escapa a la sala cuando el fuego se ahoga.
  const leak = game.sim.o2 < 0.65 ? (0.65 - game.sim.o2) * Math.min(4, game.sim.smokeTotal) * 0.25 : 0;
  game.roomSmoke += (leak - game.roomSmoke) * Math.min(1, dt / (leak > game.roomSmoke ? 8 : 25));
  vignette.uniforms.uHaze.value = Math.min(0.5, game.roomSmoke);
  vignette.uniforms.uTime.value = time;

  audio.update(dt, {
    flame: vis.flameTotal,
    power: vis.power,
    steam: game.sim.steamTotal,
    bellows: game.env.bellows,
    pouring: ix.pourFlow > 0.02,
    crackleRate: vis.flameTotal * 2.2 + game.sim.bedGlow * 1.5,
    wind: game.state.weather.id === 'wind' ? 1 : game.state.weather.id === 'cold' ? 0.5 : 0.15,
    rain: game.state.weather.id === 'rain' ? 1 : 0,
  });

  rig.update(dt, camera.aspect);

  composer.render();

  if (now - lastUi > 250) {
    lastUi = now;
    ui.refresh();
  }
  if (now - lastSave > 5000) {
    lastSave = now;
    game.save();
  }
}

window.addEventListener('beforeunload', (e) => {
  game.save();
  e.preventDefault();
  e.returnValue = '';
});
document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });

// Accesos para depurar desde la consola.
window.__chimenea = { game, ix, ui, scene, camera, rig };

frame();
