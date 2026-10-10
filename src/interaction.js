import * as THREE from 'three';
import { FUELS } from './sim/fuels.js';
import { createFuelMesh, disposeFuelMesh } from './fuel/meshes.js';
import { BOX } from './scene/layout.js';
import { CANNON } from './physics.js';

const MATCH_LIFE = 14;
const STATE_LABEL = { cold: 'Sin prender', smolder: 'Humeando', flaming: 'Ardiendo', ember: 'Brasa' };

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
    this.yaw = 0;
    this.spin = Math.random() * Math.PI * 2;
    this.match = null;
    this.bellows = 0;
    this.bellowsHeld = false;
    this.spaceHeld = false;
    this.grab = null;
    this.lastPokeAt = 0;

    this.matchMesh = this.buildMatch();
    this.pokerMesh = this.buildPoker();

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

  setTool(tool, key = null) {
    if (this.match && tool !== 'match') this.blowOutMatch(false);
    this.tool = tool;
    this.placeKey = key;
    if (this.ghost) {
      this.scene.remove(this.ghost.mesh);
      disposeFuelMesh(this.ghost);
      this.ghost = null;
    }
    if (tool === 'place') {
      const [type, wet] = key.split(':');
      this.ghost = createFuelMesh(type, Math.floor(Math.random() * 1e6), wet ? 1 : 0);
      const mats = Array.isArray(this.ghost.mesh.material) ? this.ghost.mesh.material : [this.ghost.mesh.material];
      for (const m of mats) { m.transparent = true; m.opacity = 0.7; }
      this.ghost.mesh.castShadow = false;
      this.ghost.mesh.visible = false;
      this.scene.add(this.ghost.mesh);
      this.yaw = (Math.random() - 0.5) * 0.4;
    }
    this.pokerMesh.visible = tool === 'poker';
    this.dom.style.cursor = tool === 'hand' ? 'default' : tool === 'place' ? 'grabbing' : 'crosshair';
    this.ui.setActiveTool(tool, key);
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
      case 'water': this.ui.confirmWater(() => this.game.splash()); break;
      default: break;
    }
  }

  onUp() {
    this.bellowsHeld = false;
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
      this.ui.toast('No te quedan piezas de ese tipo. Visita la tienda o el jardín.', '🪵');
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
      this.ui.toast('No te quedan cerillas. Compra una caja en la tienda.', '🔥');
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
        this.ui.toast('La cerilla se ha consumido.', '🔥');
      } else if (this.bellows > 0.6) {
        this.blowOutMatch(false);
        this.ui.toast('¡El fuelle ha apagado la cerilla!', '💨');
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
    const F = FUELS[it.type];
    const left = Math.max(0, Math.round(((it.vol + it.char) / it.m0) * 100));
    const wet = Math.round(it.moisture * 100);
    let st = STATE_LABEL[it.state] || it.state;
    if (it.state === 'ember' && it.glow < 0.05) st = 'Carbón frío';
    if (it.state === 'cold' && it.moisture > 0.22 && it.T > 80) st = 'Secándose (vapor)';
    return `<b>${F.name}</b><br>${st} · ${Math.round(it.T)} °C<br>Humedad ${wet}% · Queda ${left}%`;
  }
}
