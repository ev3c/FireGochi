import * as THREE from '../vendor/three/three.module.js';

// Cámara orbital alrededor del hogar, con límites para no atravesar la fachada.
const DEFAULT = { yaw: 0, pitch: 0.13, dist: 1.4 };
const LIMITS = { yaw: 0.95, pitchMin: -0.06, pitchMax: 0.9, distMin: 0.7, distMax: 2.4 };
const MIN_Z = 0.34;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0.3, -0.12);
    this.cur = { ...DEFAULT };
    this.goal = { ...DEFAULT };
    this.drag = null;
    this.vel = { yaw: 0, pitch: 0 };
    this.place();
  }

  begin(x, y, button) {
    this.drag = { x, y, sx: x, sy: y, moved: false, button };
    this.vel.yaw = this.vel.pitch = 0;
  }

  move(x, y) {
    const d = this.drag;
    if (!d) return false;
    const dx = x - d.x, dy = y - d.y;
    d.x = x;
    d.y = y;
    if (!d.moved && Math.hypot(x - d.sx, y - d.sy) > 4) d.moved = true;
    if (d.moved) {
      this.goal.yaw -= dx * 0.0055;
      this.goal.pitch += dy * 0.0045;
      this.vel.yaw = -dx * 0.0055;
      this.vel.pitch = dy * 0.0045;
      this.clamp();
    }
    return d.moved;
  }

  end() {
    const d = this.drag;
    this.drag = null;
    return d;
  }

  zoom(deltaY) {
    this.goal.dist *= Math.exp(deltaY * 0.0012);
    this.clamp();
  }

  reset() {
    Object.assign(this.goal, DEFAULT);
  }

  clamp() {
    const g = this.goal;
    g.yaw = THREE.MathUtils.clamp(g.yaw, -LIMITS.yaw, LIMITS.yaw);
    g.pitch = THREE.MathUtils.clamp(g.pitch, LIMITS.pitchMin, LIMITS.pitchMax);
    g.dist = THREE.MathUtils.clamp(g.dist, LIMITS.distMin, LIMITS.distMax);
  }

  place(extraDist = 0) {
    const { yaw, pitch, dist } = this.cur;
    const d = dist + extraDist;
    const p = this.camera.position;
    p.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * d,
      this.target.y + Math.sin(pitch) * d,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * d
    );
    if (p.z < MIN_Z) p.z = MIN_Z;
    this.camera.lookAt(this.target);
  }

  update(dt, aspect) {
    // Inercia suave al soltar.
    if (!this.drag && (Math.abs(this.vel.yaw) > 1e-4 || Math.abs(this.vel.pitch) > 1e-4)) {
      this.goal.yaw += this.vel.yaw * 0.5;
      this.goal.pitch += this.vel.pitch * 0.5;
      this.vel.yaw *= Math.exp(-dt * 6);
      this.vel.pitch *= Math.exp(-dt * 6);
      this.clamp();
    }
    const k = 1 - Math.exp(-dt * 9);
    for (const key of ['yaw', 'pitch', 'dist']) this.cur[key] += (this.goal[key] - this.cur[key]) * k;
    // En pantallas estrechas se aleja para que quepa el hogar.
    this.place(Math.max(0, 1.5 - aspect) * 0.9);
  }
}
