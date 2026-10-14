import * as CANNON from '../vendor/cannon/cannon-es.js';
import { FUELS } from './sim/fuels.js';
import { BOX, GRATE, grateBarXs } from './scene/layout.js';

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 12;
  const mat = new CANNON.Material('wood');
  world.defaultContactMaterial.friction = 0.7;
  world.defaultContactMaterial.restitution = 0.05;
  world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction: 0.75, restitution: 0.04 }));

  const addStatic = (shape, x, y, z, q) => {
    const b = new CANNON.Body({ mass: 0, material: mat });
    b.addShape(shape);
    b.position.set(x, y, z);
    if (q) b.quaternion.copy(q);
    world.addBody(b);
    return b;
  };

  // Suelo, paredes y una barrera invisible baja en la boca del hogar.
  addStatic(new CANNON.Box(new CANNON.Vec3(1, 0.3, 0.6)), 0, -0.3, -0.1);
  addStatic(new CANNON.Box(new CANNON.Vec3(1, 1, 0.05)), 0, 0.5, BOX.zBack - 0.05);
  addStatic(new CANNON.Box(new CANNON.Vec3(0.05, 1, 0.5)), BOX.xMin - 0.05, 0.5, -0.1);
  addStatic(new CANNON.Box(new CANNON.Vec3(0.05, 1, 0.5)), BOX.xMax + 0.05, 0.5, -0.1);
  addStatic(new CANNON.Box(new CANNON.Vec3(1, 0.06, 0.03)), 0, 0.06, BOX.zFront + 0.02);

  // Parrilla.
  const barHalf = (GRATE.zMax - GRATE.zMin) / 2;
  for (const x of grateBarXs()) {
    addStatic(new CANNON.Box(new CANNON.Vec3(GRATE.barR, GRATE.barR, barHalf)), x, GRATE.top - GRATE.barR, (GRATE.zMin + GRATE.zMax) / 2);
    addStatic(new CANNON.Box(new CANNON.Vec3(GRATE.barR, GRATE.frontPostH / 2, GRATE.barR)), x, GRATE.top + GRATE.frontPostH / 2, GRATE.zMax);
    addStatic(new CANNON.Box(new CANNON.Vec3(GRATE.barR, GRATE.backPostH / 2, GRATE.barR)), x, GRATE.top + GRATE.backPostH / 2, GRATE.zMin);
  }
  const railHalf = (GRATE.xMax - GRATE.xMin) / 2 + 0.02;
  addStatic(new CANNON.Box(new CANNON.Vec3(railHalf, 0.01, 0.01)), 0, GRATE.top + GRATE.frontPostH - 0.02, GRATE.zMax);
  addStatic(new CANNON.Box(new CANNON.Vec3(railHalf, 0.01, 0.01)), 0, GRATE.top + GRATE.backPostH - 0.02, GRATE.zMin);

  return { world, mat };
}

// Prisma convexo a partir de la sección de la leña (eje Y).
function woodShape(wood, rs, ls) {
  const hull = wood.hull;
  const n = hull.length;
  const h = (wood.length * ls) / 2;
  const verts = [];
  for (const [x, z] of hull) verts.push(new CANNON.Vec3(x * rs, -h, z * rs));
  for (const [x, z] of hull) verts.push(new CANNON.Vec3(x * rs, h, z * rs));
  const faces = [[...Array(n).keys()], [...Array(n).keys()].map((i) => n + i)];
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  // Orientar cada cara hacia fuera (el origen está dentro del prisma).
  const nrm = new CANNON.Vec3(), c = new CANNON.Vec3();
  for (const f of faces) {
    // Normal de Newell: robusta aunque haya vértices casi alineados.
    nrm.set(0, 0, 0);
    c.set(0, 0, 0);
    for (let k = 0; k < f.length; k++) {
      const p = verts[f[k]], q = verts[f[(k + 1) % f.length]];
      nrm.x += (p.y - q.y) * (p.z + q.z);
      nrm.y += (p.z - q.z) * (p.x + q.x);
      nrm.z += (p.x - q.x) * (p.y + q.y);
      c.vadd(p, c);
    }
    if (nrm.dot(c) < 0) f.reverse();
  }
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}

// Forma física de una pieza para un factor de escala dado (los troncos menguan al arder).
export function makeShape(type, rs, ls, wood) {
  const F = FUELS[type];
  if (wood) return woodShape(wood, rs, ls);
  if (F.shape === 'cone') return new CANNON.Sphere(F.radius * 0.9 * rs);
  return new CANNON.Sphere(F.radius * 0.85 * rs);
}

export function createBody(phys, type, mass, pos, quat, wood) {
  const F = FUELS[type];
  const body = new CANNON.Body({
    mass: Math.max(0.02, mass),
    material: phys.mat,
    linearDamping: 0.12,
    angularDamping: F.shape === 'log' || F.shape === 'stick' ? 0.35 : 0.7,
    sleepSpeedLimit: 0.05,
    sleepTimeLimit: 0.6,
  });
  body.addShape(makeShape(type, 1, 1, wood));
  body.position.set(pos.x, pos.y, pos.z);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  phys.world.addBody(body);
  return body;
}

export function resizeBody(body, type, rs, ls, mass, wood) {
  while (body.shapes.length) body.removeShape(body.shapes[0]);
  body.addShape(makeShape(type, rs, ls, wood));
  body.mass = Math.max(0.02, mass);
  body.updateMassProperties();
  body.wakeUp();
}

export { CANNON };
