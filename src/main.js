import * as THREE from '../vendor/three/three.module.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { buildFireplace } from './scene/fireplace.js';
import { createPhysics } from './physics.js';
import { FlameSystem, SHADER_TIME_WRAP } from './fire/flames.js';
import { Sparks, Smoke } from './fire/particles.js';
import { EmberBed } from './fire/emberBed.js';
import { FireView } from './fire/fireView.js';
import { sharedTime } from './fuel/meshes.js';
import { FireAudio } from './audio.js';
import { Game } from './game.js';
import { Interaction } from './interaction.js';
import { UI } from './ui.js';
import { CameraRig } from './cameraRig.js';

// Un aviso por sesión del navegador, solo en el dominio publicado.
function notifyVisit(ui) {
  const host = location.hostname.replace(/^www\./, '');
  if (host !== 'firegochi.com') return;
  try {
    if (sessionStorage.getItem('firegochi-visit')) return;
    sessionStorage.setItem('firegochi-visit', '1');
  } catch { /* modo privado: se intenta igual */ }
  const player = ui.world?.player || {};
  const body = {
    page: location.href,
    referrer: document.referrer,
    lang: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}`,
    os: clientOS(),
    name: player.name || '',
    playerId: player.id || '',
  };
  fetch(new URL('api/visit.php', location.href), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const apple = ios || /Macintosh|Mac OS X/.test(navigator.userAgent);
const dprCap = apple ? 1.25 : 1.75;

function clientOS() {
  const ua = navigator.userAgent;
  const ipad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (ipad || /iPhone|iPad|iPod/.test(ua)) return 'iOS';
  return navigator.userAgentData?.platform
    || (/Android/.test(ua) ? 'Android'
      : /Mac OS X/.test(ua) ? 'macOS'
      : /Windows/.test(ua) ? 'Windows'
      : /Linux/.test(ua) ? 'Linux'
      : 'desconocido');
}

// En Mac, pedir «low-power» hace que Safari y Chrome devuelvan un contexto nulo
// y el canvas quede inservible. No se indica preferencia de GPU.
function replaceCanvas(canvas, gl) {
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ya perdido */ }
  const fresh = canvas.cloneNode(false);
  canvas.replaceWith(fresh);
  return fresh;
}

function requestGL(canvas, attrs) {
  let reason = '';
  const onErr = (e) => { reason = e.statusMessage || reason; };
  canvas.addEventListener('webglcontextcreationerror', onErr);
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', attrs);
  } catch (err) {
    reason = err.message || reason;
  }
  canvas.removeEventListener('webglcontextcreationerror', onErr);
  return { gl, reason };
}

async function createRenderer() {
  const base = {
    alpha: false, depth: true, stencil: false, antialias: false,
    premultipliedAlpha: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false,
  };
  const attempts = [
    { ...base, antialias: !apple },
    { ...base },
    { ...base, powerPreference: 'high-performance' },
  ];
  let canvas = document.getElementById('scene');
  const reasons = [];
  const tryAll = () => {
    for (const attrs of attempts) {
      const { gl, reason } = requestGL(canvas, attrs);
      if (reason) reasons.push(reason);
      if (!gl) {
        canvas = replaceCanvas(canvas);
        continue;
      }
      try {
        return new THREE.WebGLRenderer({ canvas, context: gl, ...attrs });
      } catch (err) {
        reasons.push(err.message || String(err));
        canvas = replaceCanvas(canvas, gl);
      }
    }
    return null;
  };
  let renderer = tryAll();
  if (!renderer) {
    await new Promise((r) => setTimeout(r, 700));
    renderer = tryAll();
  }
  if (renderer) return renderer;
  showWebGLHelp(reasons);
  throw new Error(reasons.filter(Boolean).join(' | ') || 'WebGL');
}

function canGet(type) {
  try {
    return !!document.createElement('canvas').getContext(type);
  } catch {
    return false;
  }
}

function showWebGLHelp(reasons = []) {
  const detail = [...new Set(reasons.map((r) => String(r).trim()).filter(Boolean))].slice(0, 3).join(' | ');
  if (location.hostname.replace(/^www\./, '') === 'firegochi.com') {
    fetch(new URL('api/visit.php', location.href), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: location.href,
        lang: navigator.language,
        screen: `${screen.width}x${screen.height}`,
        os: clientOS(),
        gl: detail || 'sin contexto WebGL',
      }),
      keepalive: true,
    }).catch(() => {});
  }
  const en = localStorage.getItem('firegochi-lang') === 'en';
  const gl2 = canGet('webgl2'), gl1 = canGet('webgl') || canGet('experimental-webgl');
  const steps = en ? [
    '<b>Chrome:</b> Settings → System → turn on <i>“Use graphics acceleration when available”</i> and relaunch Chrome. Then open <code>chrome://gpu</code>: “WebGL2” should say “Hardware accelerated”.',
    '<b>Safari:</b> it needs Safari 15 or later (update macOS). In Safari → Settings → Advanced, tick <i>“Show features for web developers”</i>; then in Develop → Feature Flags make sure <i>WebGL 2.0</i> is on.',
    'Restart the Mac and close other tabs or apps that use 3D.',
  ] : [
    '<b>Chrome:</b> Ajustes → Sistema → activa <i>«Usar aceleración gráfica cuando esté disponible»</i> y reinicia Chrome. Después abre <code>chrome://gpu</code>: «WebGL2» debe decir «Hardware accelerated».',
    '<b>Safari:</b> hace falta Safari 15 o posterior (actualiza macOS). En Safari → Ajustes → Avanzado, marca <i>«Mostrar funciones para desarrolladores web»</i>; luego en Desarrollo → Indicadores de funciones comprueba que <i>WebGL 2.0</i> está activado.',
    'Reinicia el Mac y cierra otras pestañas o apps que usen 3D.',
  ];
  const box = document.createElement('div');
  box.id = 'gl-help';
  box.innerHTML = `<div class="gl-card">
    <h3>${en ? 'Your browser cannot show 3D graphics' : 'Tu navegador no puede mostrar gráficos 3D'}</h3>
    <p>${en ? 'FireGochi needs <b>WebGL 2</b> and the browser refused to create it. Usually it is fixed like this:' : 'FireGochi necesita <b>WebGL 2</b> y el navegador no ha podido crearlo. Normalmente se arregla así:'}</p>
    <ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    <p class="gl-diag">WebGL 2: ${gl2 ? '✔' : '✘'} · WebGL 1: ${gl1 ? '✔' : '✘'}${detail ? `<br>${detail.replace(/</g, '')}` : ''}<br>${navigator.userAgent.replace(/</g, '')}</p>
    <button type="button" class="btn" onclick="location.reload()">${en ? 'Retry' : 'Reintentar'}</button>
  </div>`;
  document.body.appendChild(box);
}

const renderer = await createRenderer();
const canvas = renderer.domElement;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
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
notifyVisit(ui);
const game = new Game({ scene, phys, audio, sparks, smoke, notify: (t, i) => ui.toast(t, i) });
const view = new FireView({ flames, sparks, smoke, bed, lights: fp.lights, iron: fp.iron, wall: fp.wall });

const envMeshes = [];
fp.group.traverse((o) => { if (o.isMesh) envMeshes.push(o); });
const ix = new Interaction({ camera, rig, dom: canvas, game, envMeshes, audio, ui, scene });

// Safari (iPhone y Mac) no puede dibujar en texturas de media precisión: el bloom dejaría la pantalla en negro.
function halfFloatOK(renderer) {
  const gl = renderer.getContext();
  if (!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'))) return false;
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  renderer.setRenderTarget(rt);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  renderer.setRenderTarget(null);
  rt.dispose();
  return ok;
}

const useFloat = halfFloatOK(renderer);
let composer;
if (useFloat) {
  composer = new EffectComposer(renderer);
} else {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.width * pr, size.height * pr, { type: THREE.UnsignedByteType }));
}
composer.addPass(new RenderPass(scene, camera));
if (useFloat) {
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.45, 0.85));
}
const vignette = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uHaze: { value: 0 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uHaze; uniform float uTime; varying vec2 vUv;
    float h(vec2 p){
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5, 0.48));
      c.rgb *= smoothstep(0.95, 0.3, d);
      c.rgb = mix(c.rgb, vec3(0.16, 0.14, 0.12) + c.rgb * 0.5, uHaze);
      c.rgb += (h(vUv * 40.0 + fract(uTime) * 7.0) - 0.5) * 0.012;
      gl_FragColor = c;
    }`,
});
composer.addPass(vignette);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio, dprCap);
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
  sharedTime.value = time % SHADER_TIME_WRAP;

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

// Instalada como app (Android/Google Play o pantalla de inicio) no se pregunta al salir.
const installedApp = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
  || document.referrer.startsWith('android-app://') || navigator.standalone === true;

window.addEventListener('beforeunload', (e) => {
  game.save();
  if (installedApp) return;
  e.preventDefault();
  e.returnValue = '';
});
document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });

// Accesos para depurar desde la consola.
window.__chimenea = { game, ix, ui, scene, camera, rig };

frame();
