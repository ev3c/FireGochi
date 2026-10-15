import * as THREE from '../vendor/three/three.module.js';
import { FUELS } from './sim/fuels.js';
import { createFuelMesh, disposeFuelMesh, warmFuelAssets } from './fuel/meshes.js';
import { BOX } from './scene/layout.js';
import { CANNON } from './physics.js';
import { splitWoodTextures, SPLIT_TILE } from './scene/textures.js';
import { t, fuelName } from './i18n.js';

const MATCH_LIFE = 14;
// Fuelle (metros, ángulos en radianes por tabla).
const BELLOWS = { scale: 0.55, gap: 0.004, depth: 0.012, bevel: 0.003, ring: 72, rows: 8, open: 0.15, closed: 0.035, nozzle: 0.2 };
// Cubo de agua (metros). seconds: lo que tarda en vaciarse; refill: cubos por segundo al soltar.
const BUCKET = { h: 0.15, r0: 0.062, r1: 0.085, wall: 0.0025, lift: 0.2, idle: 0.12, pour: 1.95, seconds: 3.5, refill: 0.3, drops: 600 };

export class Interaction {
  constructor({ camera, rig, dom, game, envMeshes, audio, ui, scene }) {
    this.camera = camera;
    this.rig = rig;
    this.dom = dom;
    this.game = game;
    this.envMeshes = envMeshes;
    this.audio = audio;
    this.ui = ui;
    this.scene = scene;
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(0, 0);
    this.pointerPx = { x: 0, y: 0 };
    this.hasPointer = false;
    this.tool = 'hand';
    this.placeKey = null;
    this.ghost = null;
    this.placeToken = 0;
    this.yaw = 0;
    warmFuelAssets();
    this.spin = Math.random() * Math.PI * 2;
    this.match = null;
    this.bellows = 0;
    this.bellowsHeld = false;
    this.spaceHeld = false;
    this.grab = null;
    this.lastPokeAt = 0;

    this.matchMesh = this.buildMatch();
    this.pokerMesh = this.buildPoker();
    this.bellowsMesh = this.buildBellows();
    this.pump = 0;
    this.bucketMesh = this.buildBucket();
    this.drops = this.buildDrops();
    this.waterHeld = false;
    this.bucketWater = 1;
    this.bucketTilt = BUCKET.idle;
    this.pourFlow = 0;
    this.bucketAim = null;

    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    dom.addEventListener('pointerleave', () => { if (!this.rig.drag) { this.hasPointer = false; this.ui.hideTip(); } });
    dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('dblclick', () => { if (this.tool === 'hand') this.rig.reset(); });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  buildMatch() {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.05, 0.0035), new THREE.MeshStandardMaterial({ color: 0xd8b080, roughness: 0.8 }));
    stick.position.y = 0.025;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), new THREE.MeshStandardMaterial({ color: 0x9a1a10, roughness: 0.6, emissive: 0xff5010, emissiveIntensity: 0 }));
    head.scale.set(1, 1.3, 1);
    g.add(stick, head);
    g.userData.head = head;
    g.userData.stick = stick;
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  buildPoker() {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.4 });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 8), iron);
    rod.position.y = 0.35;
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6), iron);
    hook.rotation.z = Math.PI / 2.5;
    hook.position.set(0.018, 0.012, 0);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), new THREE.MeshStandardMaterial({ color: 0x6a4a1a, metalness: 0.7, roughness: 0.35 }));
    handle.position.y = 0.73;
    g.add(rod, hook, handle);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  buildBellows() {
    const g = new THREE.Group();
    g.name = 'bellows';
    g.scale.setScalar(BELLOWS.scale);

    const grain = splitWoodTextures('oak');
    const wood = new THREE.MeshStandardMaterial({
      map: grain.map, normalMap: grain.normal, normalScale: new THREE.Vector2(0.35, 0.35),
      color: 0xb47a50, roughness: 0.42, metalness: 0.02,
    });
    const leather = new THREE.MeshStandardMaterial({ color: 0x6a3420, roughness: 0.72, side: THREE.DoubleSide });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14e, metalness: 0.9, roughness: 0.3 });
    const turned = new THREE.MeshStandardMaterial({ color: 0x3e2414, roughness: 0.5 });

    // Tablas con forma de pera: cuello estrecho junto a la boquilla y panza redonda.
    const outline = new THREE.Shape();
    outline.moveTo(0.024, 0);
    outline.bezierCurveTo(0.05, 0.05, 0.125, 0.11, 0.125, 0.23);
    outline.bezierCurveTo(0.125, 0.32, 0.07, 0.365, 0, 0.365);
    outline.bezierCurveTo(-0.07, 0.365, -0.125, 0.32, -0.125, 0.23);
    outline.bezierCurveTo(-0.125, 0.11, -0.05, 0.05, -0.024, 0);
    outline.closePath();

    const { gap, depth, bevel } = BELLOWS;
    const boardGeo = new THREE.ExtrudeGeometry(outline, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 28,
    });
    const uv = boardGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / SPLIT_TILE.u + 0.3, uv.getY(i) / SPLIT_TILE.v);
    const geoA = boardGeo.clone().translate(0, 0, gap + bevel);
    const geoB = boardGeo.clone().translate(0, 0, -(gap + bevel + depth));

    // Asas: prolongación de la tabla con un agujero para los dedos.
    const handle = new THREE.Shape();
    handle.moveTo(-0.024, 0.32);
    handle.lineTo(-0.024, 0.45);
    handle.absarc(0, 0.45, 0.024, Math.PI, 0, true);
    handle.lineTo(0.024, 0.32);
    handle.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0.448, 0.011, 0, Math.PI * 2, false);
    handle.holes.push(hole);
    const hDepth = depth * 0.55;
    const handleGeo = new THREE.ExtrudeGeometry(handle, {
      depth: hDepth, bevelEnabled: true, bevelThickness: bevel * 0.8, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 18,
    });
    const huv = handleGeo.attributes.uv;
    for (let i = 0; i < huv.count; i++) huv.setXY(i, huv.getX(i) / SPLIT_TILE.u + 0.3, huv.getY(i) / SPLIT_TILE.v);
    const hOff = gap + bevel + (depth - hDepth) / 2;

    const boardA = new THREE.Group();
    const boardB = new THREE.Group();
    boardA.add(new THREE.Mesh(geoA, wood), new THREE.Mesh(handleGeo.clone().translate(0, 0, hOff), wood));
    boardB.add(new THREE.Mesh(geoB, wood), new THREE.Mesh(handleGeo.clone().translate(0, 0, -(hOff + hDepth)), wood));

    // Medallón de latón en la tabla de arriba.
    const outer = gap + bevel * 2 + depth;
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.003, 32).rotateX(Math.PI / 2), brass);
    boss.position.set(0, 0.215, outer + 0.0012);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.0022, 6, 40), brass);
    rim.position.set(0, 0.215, outer + 0.0008);
    boardA.add(boss, rim);

    // Perímetro donde se clava el cuero, con su normal hacia fuera.
    const pts = outline.getSpacedPoints(BELLOWS.ring);
    pts.pop();
    const n = pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / n;
    const ring = pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      let nx = b.y - a.y, ny = -(b.x - a.x);
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      if (nx * p.x + ny * (p.y - cy) < 0) { nx = -nx; ny = -ny; }
      return { x: p.x, y: p.y, nx, ny };
    });

    // Tachuelas de latón sobre el borde del cuero.
    const edgeZ = gap + bevel + depth / 2;
    const tackGeo = new THREE.SphereGeometry(0.0034, 8, 6);
    tackGeo.scale(1, 1, 0.6);
    const tacks = ring.filter((_, i) => i % 2 === 0 && ring[i].y > 0.03);
    for (const [board, z] of [[boardA, edgeZ], [boardB, -edgeZ]]) {
      const inst = new THREE.InstancedMesh(tackGeo, brass, tacks.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      tacks.forEach((p, i) => {
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(p.nx, p.ny, 0));
        m.compose(new THREE.Vector3(p.x + p.nx * (bevel + 0.0012), p.y + p.ny * (bevel + 0.0012), z), q, new THREE.Vector3(1, 1, 1));
        inst.setMatrixAt(i, m);
      });
      board.add(inst);
    }

    // Fuelle de cuero: une el canto de las dos tablas y se pliega hacia fuera al cerrarse.
    const rows = BELLOWS.rows;
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * (rows + 1) * 3), 3));
    const idx = [];
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j, b = i2 * (rows + 1) + j;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    lGeo.setIndex(idx);
    const leatherMesh = new THREE.Mesh(lGeo, leather);
    leatherMesh.frustumCulled = false;

    // Cuello torneado y boquilla de latón.
    const neck = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.001, -0.06), new THREE.Vector2(0.018, -0.06), new THREE.Vector2(0.021, -0.052),
      new THREE.Vector2(0.024, -0.03), new THREE.Vector2(0.028, -0.008), new THREE.Vector2(0.029, 0.03),
      new THREE.Vector2(0.001, 0.03),
    ], 24), turned);
    const nozzle = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.004, -0.2), new THREE.Vector2(0.0075, -0.2), new THREE.Vector2(0.0085, -0.19),
      new THREE.Vector2(0.0095, -0.14), new THREE.Vector2(0.012, -0.1), new THREE.Vector2(0.0145, -0.075),
      new THREE.Vector2(0.019, -0.066), new THREE.Vector2(0.0195, -0.058), new THREE.Vector2(0.004, -0.058),
    ], 24), brass);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.0205, 0.003, 8, 28).rotateX(Math.PI / 2), brass);
    collar.position.y = -0.054;

    g.add(boardA, boardB, leatherMesh, neck, nozzle, collar);
    Object.assign(g.userData, { boardA, boardB, leatherMesh, ring, edgeZ });
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.visible = false;
    this.scene.add(g);
    this.shapeBellows(g, BELLOWS.open);
    return g;
  }

  buildBucket() {
    const { h, r0, r1, wall } = BUCKET;
    const g = new THREE.Group();
    g.name = 'bucket';
    const tilt = new THREE.Group();
    g.add(tilt);

    const zinc = new THREE.MeshStandardMaterial({ color: 0xa9b2b8, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide });
    const wire = new THREE.MeshStandardMaterial({ color: 0x5d6266, metalness: 0.9, roughness: 0.45 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.001, 0), new THREE.Vector2(r0, 0), new THREE.Vector2(r1, h),
      new THREE.Vector2(r1 - wall, h), new THREE.Vector2(r0 - wall, wall), new THREE.Vector2(0.001, wall),
    ], 40), zinc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r1, 0.004, 8, 48).rotateX(Math.PI / 2), zinc);
    rim.position.y = h;
    const radiusAt = (y) => r0 + (r1 - r0) * (y / h);
    const ribs = [0.035, 0.105].map((y) => {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(radiusAt(y) + 0.0012, 0.0024, 6, 48).rotateX(Math.PI / 2), zinc);
      rib.position.y = y;
      return rib;
    });
    tilt.add(body, rim, ...ribs);

    // Asa de alambre con agarradero de madera, sujeta a dos orejetas en los costados.
    const earY = h - 0.022;
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.016), zinc);
      ear.position.set(sx * (radiusAt(earY) + 0.002), earY, 0);
      tilt.add(ear);
    }
    const arcR = radiusAt(earY) + 0.005;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(arcR, 0.0026, 6, 36, Math.PI), wire);
    handle.position.y = earY;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.05, 12).rotateZ(Math.PI / 2), wood);
    grip.position.y = earY + arcR;
    tilt.add(handle, grip);

    // Superficie del agua: se mantiene horizontal aunque el cubo se incline.
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 36), new THREE.MeshStandardMaterial({
      color: 0x3f7fb4, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.88,
    }));
    tilt.add(water);

    g.userData = { tilt, water, radiusAt };
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    water.castShadow = false;
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  buildDrops() {
    const n = BUCKET.drops;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3).fill(-10);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xa8d0f0, size: 0.014, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    return { pts, vel: new Float32Array(n * 3), life: new Float32Array(n), bounced: new Uint8Array(n), next: 0, acc: 0 };
  }

  poseBucket(dt) {
    const mesh = this.bucketMesh;
    const show = this.tool === 'water';
    mesh.visible = show;
    this.pourFlow = 0;
    if (show) {
      let aim = this.bucketAim || new THREE.Vector3(0, 0.12, 0);
      if (this.hasPointer) {
        const hit = this.pick(true, true);
        if (hit) aim = hit.point.clone();
      }
      aim.y = Math.max(aim.y, 0.03);
      if (!this.bucketAim) this.bucketAim = aim.clone();
      this.bucketAim.lerp(aim, Math.min(1, dt * 12));

      const { h, r1 } = BUCKET;
      const pouring = this.waterHeld && this.bucketWater > 0.01;
      const goal = pouring ? BUCKET.pour : BUCKET.idle;
      this.bucketTilt += (goal - this.bucketTilt) * Math.min(1, dt * (pouring ? 3.2 : 5));
      const th = this.bucketTilt;

      // Se sostiene a un lado del punto y vierte hacia él.
      const toCam = this.camera.position.clone().sub(this.bucketAim);
      toCam.y = 0;
      toCam.normalize();
      const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
      const d = right.clone().negate().addScaledVector(toCam, -0.35).normalize();
      const qYaw = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      const lip = new THREE.Vector3(0, h * Math.cos(th) - r1 * Math.sin(th), h * Math.sin(th) + r1 * Math.cos(th)).applyQuaternion(qYaw);
      const lipWorld = this.bucketAim.clone().add(new THREE.Vector3(0, BUCKET.lift, 0));
      mesh.quaternion.copy(qYaw);
      mesh.position.copy(lipWorld).sub(lip);
      const { tilt, water, radiusAt } = mesh.userData;
      tilt.rotation.x = th;

      const flow = this.bucketWater > 0 ? THREE.MathUtils.clamp((th - 0.95) / 0.7, 0, 1) : 0;
      this.pourFlow = flow;
      if (flow > 0) this.bucketWater = Math.max(0, this.bucketWater - (flow * dt) / BUCKET.seconds);
      else if (!this.waterHeld) this.bucketWater = Math.min(1, this.bucketWater + dt * BUCKET.refill);

      // Nivel del agua: disco horizontal dentro del cubo que se encoge al inclinarlo.
      const level = 0.006 + this.bucketWater * h * 0.78;
      water.visible = this.bucketWater > 0.02 && th < 1.25;
      water.position.set(0, level, 0);
      water.scale.setScalar((radiusAt(level) - 0.003) * Math.max(0.35, Math.cos(th)));
      const tiltWorld = mesh.quaternion.clone().multiply(tilt.quaternion);
      water.quaternion.copy(tiltWorld.invert()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));

      if (flow > 0) {
        const dose = flow * dt;
        const hot = this.game.pour(this.bucketAim.x, this.bucketAim.z, dose);
        this.audio.setPour(flow, hot ? flow : 0);
        this.spawnDrops(lipWorld, d, flow, dt);
      }
    }
    if (!this.pourFlow) this.audio.setPour(0, 0);
    this.stepDrops(dt);
  }

  spawnDrops(from, d, flow, dt) {
    const D = this.drops;
    const pos = D.pts.geometry.attributes.position.array;
    D.acc += flow * dt * 700;
    while (D.acc >= 1) {
      D.acc -= 1;
      const i = D.next;
      D.next = (D.next + 1) % BUCKET.drops;
      const j = i * 3;
      pos[j] = from.x + (Math.random() - 0.5) * 0.012;
      pos[j + 1] = from.y + (Math.random() - 0.5) * 0.006;
      pos[j + 2] = from.z + (Math.random() - 0.5) * 0.012;
      D.vel[j] = d.x * 0.22 + (Math.random() - 0.5) * 0.06;
      D.vel[j + 1] = -0.15 - Math.random() * 0.1;
      D.vel[j + 2] = d.z * 0.22 + (Math.random() - 0.5) * 0.06;
      D.life[i] = 1.2;
      D.bounced[i] = 0;
    }
  }

  stepDrops(dt) {
    const D = this.drops;
    const pos = D.pts.geometry.attributes.position.array;
    const floor = this.bucketAim ? this.bucketAim.y : 0;
    let any = false;
    for (let i = 0; i < BUCKET.drops; i++) {
      if (D.life[i] <= 0) continue;
      any = true;
      const j = i * 3;
      D.life[i] -= dt;
      D.vel[j + 1] -= 9.8 * dt;
      pos[j] += D.vel[j] * dt;
      pos[j + 1] += D.vel[j + 1] * dt;
      pos[j + 2] += D.vel[j + 2] * dt;
      if (pos[j + 1] <= floor) {
        if (D.bounced[i]) {
          D.life[i] = 0;
        } else {
          // Salpica al chocar con la leña.
          D.bounced[i] = 1;
          pos[j + 1] = floor + 0.002;
          D.vel[j] = (Math.random() - 0.5) * 0.7;
          D.vel[j + 1] = 0.3 + Math.random() * 0.5;
          D.vel[j + 2] = (Math.random() - 0.5) * 0.7;
          D.life[i] = Math.min(D.life[i], 0.25);
        }
      }
      if (D.life[i] <= 0) pos[j + 1] = -10;
    }
    if (any || D.pts.visible) D.pts.geometry.attributes.position.needsUpdate = true;
  }

  shapeBellows(g, a) {
    const { boardA, boardB, leatherMesh, ring, edgeZ } = g.userData;
    boardA.rotation.x = a;
    boardB.rotation.x = -a;
    const rows = BELLOWS.rows;
    const c = Math.cos(a), s = Math.sin(a);
    const aMax = BELLOWS.open + 0.02;
    const pos = leatherMesh.geometry.attributes.position;
    let k = 0;
    for (const p of ring) {
      const y = p.y * c - edgeZ * s;
      const z = p.y * s + edgeZ * c;
      const half = Math.max(z, 0.0005);
      const len = p.y * Math.sin(aMax) + edgeZ * Math.cos(aMax);
      const sag = Math.sqrt(Math.max(0, len * len - half * half)) * 0.55 + 0.0015;
      for (let j = 0; j <= rows; j++) {
        const t = j / rows;
        const fold = Math.sin(Math.PI * t) * sag * (0.85 + 0.15 * Math.cos(Math.PI * 4 * t));
        pos.setXYZ(k++, p.x + p.nx * fold, y + p.ny * fold, z * (1 - 2 * t));
      }
    }
    pos.needsUpdate = true;
    leatherMesh.geometry.computeVertexNormals();
  }

  setTool(tool, key = null) {
    if (this.match && tool !== 'match') this.blowOutMatch(false);
    this.tool = tool;
    this.placeKey = key;
    this.ui.setActiveTool(tool, key);
    this.placeToken += 1;
    if (this.ghost) {
      this.scene.remove(this.ghost.mesh);
      disposeFuelMesh(this.ghost);
      this.ghost = null;
    }
    if (tool === 'place') {
      const token = this.placeToken;
      const [type, wet] = key.split(':');
      const yaw = (Math.random() - 0.5) * 0.4;
      requestAnimationFrame(() => {
        if (token !== this.placeToken) return;
        this.ghost = createFuelMesh(type, Math.floor(Math.random() * 1e6), wet ? 1 : 0);
        const mats = Array.isArray(this.ghost.mesh.material) ? this.ghost.mesh.material : [this.ghost.mesh.material];
        for (const m of mats) { m.transparent = true; m.opacity = 0.7; }
        this.ghost.mesh.castShadow = false;
        this.ghost.mesh.visible = false;
        this.scene.add(this.ghost.mesh);
        this.yaw = yaw;
      });
    }
    this.pokerMesh.visible = tool === 'poker';
    this.dom.style.cursor = tool === 'hand' ? 'default' : tool === 'place' ? 'grabbing' : 'crosshair';
  }

  updatePointer(e) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerPx = { x: e.clientX, y: e.clientY };
    this.hasPointer = true;
  }

  fuelMeshes() {
    return [...this.game.entries.values()].map((e) => e.vis.mesh);
  }

  pick(includeFuel = true, includeEnv = true) {
    this.ray.setFromCamera(this.pointer, this.camera);
    const targets = [];
    if (includeFuel) targets.push(...this.fuelMeshes());
    if (includeEnv) targets.push(...this.envMeshes);
    const hits = this.ray.intersectObjects(targets, true);
    for (const h of hits) {
      if (h.object === this.ghost?.mesh) continue;
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      let o = h.object;
      while (o && o.userData.entryId === undefined && o.parent) o = o.parent;
      return { point: h.point, normal: n, entryId: o?.userData.entryId };
    }
    return null;
  }

  clampInside(p, margin = 0.03) {
    p.x = THREE.MathUtils.clamp(p.x, BOX.xMin + margin, BOX.xMax - margin);
    p.z = THREE.MathUtils.clamp(p.z, BOX.zBack + margin, BOX.zFront - margin);
    p.y = THREE.MathUtils.clamp(p.y, margin, BOX.height - 0.1);
    return p;
  }

  placeQuat(type) {
    const F = FUELS[type];
    const q = new THREE.Quaternion();
    if (F.shape === 'log' || F.shape === 'stick') {
      // Tumbado a lo largo, con un giro propio para que las cuñas no caigan siempre igual.
      q.setFromEuler(new THREE.Euler(0, this.yaw, Math.PI / 2, 'YXZ'));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spin));
    } else if (F.shape === 'cone') {
      q.setFromEuler(new THREE.Euler(Math.PI / 2 + (Math.random() - 0.5), this.yaw, 0));
    } else {
      q.setFromEuler(new THREE.Euler(this.yaw * 3, this.yaw * 2, this.yaw));
    }
    return q;
  }

  ghostPose() {
    const hit = this.pick(true, true);
    if (!hit) return null;
    const type = this.placeKey.split(':')[0];
    const F = FUELS[type];
    const r = F.shape === 'stick' ? 0.03 : F.radius;
    const p = hit.point.clone().addScaledVector(hit.normal, r + 0.015);
    if (hit.normal.y < 0.5) p.y += r * 0.5;
    const half = F.length ? F.length / 2 : 0;
    const ext = Math.abs(Math.cos(this.yaw)) * half;
    p.x = THREE.MathUtils.clamp(p.x, BOX.xMin + ext + r + 0.02, BOX.xMax - ext - r - 0.02);
    p.z = THREE.MathUtils.clamp(p.z, BOX.zBack + r + 0.03 + Math.abs(Math.sin(this.yaw)) * half, BOX.zFront - r - 0.06);
    p.y = THREE.MathUtils.clamp(p.y, r + 0.005, 0.85);
    return { p, q: this.placeQuat(type) };
  }

  onMove(e) {
    this.updatePointer(e);
    if (this.rig.drag) this.rig.move(e.clientX, e.clientY);
  }

  onDown(e) {
    this.updatePointer(e);
    this.audio.start();
    this.dom.setPointerCapture?.(e.pointerId);
    // Girar la vista: botón derecho o central con cualquier herramienta, o izquierdo con la mano.
    if (e.button === 2 || e.button === 1 || (e.button === 0 && this.tool === 'hand')) {
      e.preventDefault();
      this.rig.begin(e.clientX, e.clientY, e.button);
      return;
    }
    if (e.button !== 0) return;
    switch (this.tool) {
      case 'place': this.dropPiece(); break;
      case 'match':
        if (this.match) this.blowOutMatch(true);
        else this.strikeMatch();
        break;
      case 'poker': this.startPoke(); break;
      case 'bellows': this.bellowsHeld = true; break;
      case 'water': this.waterHeld = true; break;
      default: break;
    }
  }

  onUp() {
    this.bellowsHeld = false;
    this.waterHeld = false;
    if (this.grab) this.endPoke();
    const d = this.rig.end();
    // Un clic derecho sin arrastrar suelta la herramienta.
    if (d && d.button === 2 && !d.moved) this.setTool('hand');
  }

  onWheel(e) {
    e.preventDefault();
    if (this.tool === 'place' && !e.ctrlKey) this.yaw += Math.sign(e.deltaY) * 0.2;
    else this.rig.zoom(e.deltaY);
  }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.spaceHeld = down;
      if (down) this.audio.start();
      return;
    }
    if (!down) return;
    if (e.key === 'Escape') this.setTool('hand');
    else if (e.key === 'r' || e.key === 'R') this.yaw += 0.35;
    else if (e.key === 'c' || e.key === 'C') this.rig.reset();
    else if (e.key === '1') this.setTool('hand');
    else if (e.key === '2') this.setTool('match');
    else if (e.key === '3') this.setTool('poker');
    else if (e.key === '4') this.setTool('bellows');
    else if (e.key === '5') this.setTool('water');
  }

  dropPiece() {
    const key = this.placeKey;
    const pose = this.ghostPose();
    if (!pose) return;
    if (!this.game.takeFromInventory(key)) {
      this.ui.toast(t('toast.noPieces'), '🪵');
      this.setTool('hand');
      return;
    }
    const type = key.split(':')[0];
    const F = FUELS[type];
    if (F.shape === 'stick') {
      const n = F.count || 4;
      const perp = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 0.035;
        const p = pose.p.clone().addScaledVector(perp, off);
        p.y += 0.01 + i * 0.012;
        const yaw = this.yaw + (Math.random() - 0.5) * 0.35;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2 + (Math.random() - 0.5) * 0.2, 'YXZ'));
        this.game.addFuel(key, this.clampInside(p, 0.04), q);
      }
    } else {
      this.game.addFuel(key, pose.p, pose.q);
    }
    if (F.shape === 'ball') this.audio.paperRustle();
    this.spin = Math.random() * Math.PI * 2;
    if (this.game.sim.flameTotal > 0.5) {
      const p = pose.p;
      this.game.sparks.burst(p.x, p.y - 0.05, p.z, 12, 0.8);
    }
    if (!this.game.state.inventory[key]) this.setTool('hand');
    else this.ghost.mesh.rotation.set(0, 0, 0);
    this.ui.refreshInventory();
  }

  strikeMatch() {
    if (!this.game.useMatch()) {
      this.ui.toast(t('toast.noMatches'), '🔥');
      return;
    }
    this.audio.strike();
    this.match = { life: 1, x: 0, y: 0.1, z: 0, age: 0 };
    this.matchMesh.visible = true;
    this.ui.refreshInventory();
  }

  blowOutMatch(dropped) {
    if (!this.match) return;
    if (dropped) this.game.sparks.burst(this.match.x, this.match.y, this.match.z, 4, 0.4);
    this.match = null;
    this.matchMesh.visible = false;
  }

  startPoke() {
    const hit = this.pick(true, true);
    if (!hit) return;
    if (hit.entryId !== undefined) {
      const e = this.game.entries.get(hit.entryId);
      if (!e) return;
      const body = e.body;
      body.type = CANNON.Body.KINEMATIC;
      body.velocity.setZero();
      body.angularVelocity.setZero();
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      camDir.y = 0;
      camDir.normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.negate(), hit.point);
      const offset = new THREE.Vector3(body.position.x, body.position.y, body.position.z).sub(hit.point);
      this.grab = { e, plane, offset, tip: hit.point.clone() };
      this.game.poke(hit.point.x, hit.point.y, hit.point.z);
    } else {
      this.game.poke(hit.point.x, Math.max(0.02, hit.point.y), hit.point.z);
      this.pokeTip = hit.point.clone();
    }
  }

  // Dirección de una herramienta sostenida desde la cámara (derecha, arriba, hacia la cámara).
  handDir(tip, r, u, f) {
    const toCam = this.camera.position.clone().sub(tip);
    toCam.y = 0;
    toCam.normalize();
    const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
    return right.multiplyScalar(r).addScaledVector(toCam, f).add(new THREE.Vector3(0, u, 0)).normalize();
  }

  endPoke() {
    const b = this.grab.e.body;
    b.type = CANNON.Body.DYNAMIC;
    b.velocity.scale(0.3, b.velocity);
    b.updateMassProperties();
    b.wakeUp();
    this.grab = null;
  }

  poseBellows(dt) {
    const mesh = this.bellowsMesh;
    const show = this.tool === 'bellows';
    mesh.visible = show;
    if (!show) return;

    let tip = new THREE.Vector3(0.02, 0.28, 0.02);
    if (this.hasPointer) {
      const hit = this.pick(true, true);
      if (hit) {
        tip = hit.point.clone().addScaledVector(hit.normal, 0.06);
        tip.y = Math.max(tip.y, 0.14);
      }
    }
    const blowing = this.bellowsHeld || this.spaceHeld;
    if (blowing) this.pump += dt * 1.4;
    else this.pump = 0;
    const goal = blowing ? 0.5 - 0.5 * Math.cos(this.pump * Math.PI * 2) : 0;
    this.squeeze = (this.squeeze || 0) + (goal - (this.squeeze || 0)) * Math.min(1, dt * 14);
    const wave = this.squeeze;
    const dir = this.handDir(tip, 0.78, 0.22, 0.58);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const toCam = this.camera.position.clone().sub(tip).normalize();
    const desiredZ = toCam.clone().add(new THREE.Vector3(0, 0.35, 0));
    desiredZ.addScaledVector(dir, -desiredZ.dot(dir));
    if (desiredZ.lengthSq() > 1e-6) {
      desiredZ.normalize();
      const currentZ = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const cross = new THREE.Vector3().crossVectors(currentZ, desiredZ);
      const roll = Math.atan2(dir.dot(cross), currentZ.dot(desiredZ));
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, roll));
    }
    mesh.quaternion.copy(q);
    mesh.position.copy(tip).addScaledVector(dir, BELLOWS.nozzle * BELLOWS.scale - 0.02 * wave);
    this.shapeBellows(mesh, BELLOWS.open - wave * (BELLOWS.open - BELLOWS.closed));
  }

  update(dt, time) {
    const g = this.game;

    // Fuelle.
    const target = this.bellowsHeld || this.spaceHeld ? 1 : 0;
    this.bellows += (target - this.bellows) * Math.min(1, dt * (target ? 3 : 5));

    // Fantasma de la pieza que se va a soltar.
    if (this.tool === 'place' && this.ghost) {
      const pose = this.hasPointer ? this.ghostPose() : null;
      this.ghost.mesh.visible = !!pose;
      if (pose) {
        this.ghost.mesh.position.copy(pose.p);
        this.ghost.mesh.quaternion.copy(pose.q);
      }
    }

    // Cerilla encendida.
    let matchInfo = null;
    if (this.match) {
      const m = this.match;
      m.age += dt;
      m.life = Math.max(0, 1 - m.age / MATCH_LIFE);
      const hit = this.hasPointer ? this.pick(true, true) : null;
      if (hit) {
        const p = hit.point.clone().addScaledVector(hit.normal, 0.012);
        this.clampInside(p, 0.01);
        m.x += (p.x - m.x) * Math.min(1, dt * 18);
        m.y += (p.y - m.y) * Math.min(1, dt * 18);
        m.z += (p.z - m.z) * Math.min(1, dt * 18);
      }
      const head = this.matchMesh.userData.head;
      head.material.emissiveIntensity = 0.5 + m.life;
      head.material.color.setRGB(0.6 * m.life + 0.05, 0.1 * m.life + 0.03, 0.05);
      const dir = this.handDir(new THREE.Vector3(m.x, m.y, m.z), 0.35, -0.75, 0.55);
      this.matchMesh.position.set(m.x, m.y, m.z).addScaledVector(dir, 0.004);
      this.matchMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.matchMesh.userData.stick.material.color.setRGB(0.85 - 0.6 * (1 - m.life), 0.69 - 0.55 * (1 - m.life), 0.5 - 0.4 * (1 - m.life));
      matchInfo = { x: m.x, y: m.y + 0.01, z: m.z, life: m.life };
      if (m.life <= 0) {
        this.blowOutMatch(false);
        this.ui.toast(t('toast.matchOut'), '🔥');
      } else if (this.bellows > 0.6) {
        this.blowOutMatch(false);
        this.ui.toast(t('toast.matchBlow'), '💨');
      }
    }

    // Atizador.
    if (this.tool === 'poker') {
      let tip = null;
      if (this.grab) {
        this.ray.setFromCamera(this.pointer, this.camera);
        const p = new THREE.Vector3();
        if (this.ray.ray.intersectPlane(this.grab.plane, p)) {
          const target2 = p.clone().add(this.grab.offset);
          this.clampInside(target2, 0.06);
          target2.y = Math.max(target2.y, 0.04);
          const b = this.grab.e.body;
          b.velocity.set((target2.x - b.position.x) * 10, (target2.y - b.position.y) * 10, (target2.z - b.position.z) * 10);
          b.angularVelocity.set(0, 0, 0);
          tip = p;
          if (time - this.lastPokeAt > 0.4 && b.velocity.length() > 0.3) {
            this.lastPokeAt = time;
            g.poke(b.position.x, b.position.y, b.position.z);
          }
        }
      } else if (this.hasPointer) {
        const hit = this.pick(true, true);
        if (hit) tip = hit.point.clone().addScaledVector(hit.normal, 0.01);
      }
      this.pokerMesh.visible = !!tip;
      if (tip) {
        const dir = this.handDir(tip, 0.45, 0.35, 0.82);
        this.pokerMesh.position.copy(tip);
        this.pokerMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      }
    }

    // Fuelle: la boca apunta al fuego y las tablas se cierran al soplar.
    this.poseBellows(dt);

    // Cubo de agua: al mantener pulsado se inclina y vierte sobre el punto señalado.
    this.poseBucket(dt);

    // Información al pasar por encima.
    if (this.rig.drag?.moved) {
      this.ui.hideTip();
    } else if (this.hasPointer && (this.tool === 'hand' || this.tool === 'poker') && !this.grab) {
      const hit = this.pick(true, false);
      const e = hit && hit.entryId !== undefined ? g.entries.get(hit.entryId) : null;
      if (e) this.ui.showTip(this.pointerPx, this.describe(e));
      else this.ui.hideTip();
    } else if (this.grab) {
      this.ui.showTip(this.pointerPx, this.describe(this.grab.e));
    } else this.ui.hideTip();

    return { bellows: this.bellows, match: matchInfo };
  }

  describe(e) {
    const it = e.it;
    const left = Math.max(0, Math.round(((it.vol + it.char) / it.m0) * 100));
    const wet = Math.round(it.moisture * 100);
    let st = t(`piece.${it.state}`);
    if (it.state === 'ember' && it.glow < 0.05) st = t('piece.coldEmber');
    if (it.state === 'cold' && it.moisture > 0.22 && it.T > 80) st = t('piece.drying');
    return `<b>${fuelName(it.type)}</b><br>${st} · ${Math.round(it.T)} °C<br>${t('piece.moisture', { wet })} · ${t('piece.left', { left })}`;
  }
}
