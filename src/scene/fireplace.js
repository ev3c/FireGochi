import * as THREE from '../../vendor/three/three.module.js';
import { brickTextures, floorTexture } from './textures.js';
import { BOX, GRATE, grateBarXs } from './layout.js';

// Material de ladrillo con hollín: oscurece la parte alta y central del hogar.
function sootyBrick(kind, sootStrength) {
  const t = brickTextures(kind);
  const mat = new THREE.MeshStandardMaterial({
    map: t.map,
    bumpMap: t.bump,
    bumpScale: 2.2,
    roughness: 0.92,
    metalness: 0,
  });
  mat.userData.tile = [t.tileW, t.tileH];
  if (sootStrength > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSoot = { value: sootStrength };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uSoot;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float plume = (1.0 - smoothstep(0.05, 0.6, abs(vWPos.x))) * smoothstep(0.12, 0.85, vWPos.y);
          float top = smoothstep(0.55, 1.0, vWPos.y);
          float back = smoothstep(-0.1, -0.42, vWPos.z) * 0.4 + 0.6;
          float soot = clamp((plume * 0.85 + top * 0.6) * back, 0.0, 1.0) * uSoot;
          vec2 sp = floor(vWPos.xy * 40.0);
          vec3 p3 = fract(vec3(sp.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          float speck = fract((p3.x + p3.y) * p3.z);
          diffuseColor.rgb *= mix(1.0, 0.62 + speck * 0.06, soot);
          float lowAsh = (1.0 - smoothstep(0.0, 0.08, vWPos.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.3, 0.28), lowAsh * 0.5);`
        );
    };
  }
  return mat;
}

function wall(mat, w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const [tw, th] = mat.userData.tile;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tw), uv.getY(i) * (h / th));
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

export function buildFireplace(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const W = BOX.xMax - BOX.xMin;
  const D = BOX.zFront - BOX.zBack;
  const H = BOX.height;
  const inner = sootyBrick('refractory', 1);

  const back = wall(inner, W, H);
  back.position.set(0, H / 2, BOX.zBack);
  group.add(back);

  const left = wall(inner, D, H);
  left.rotation.y = Math.PI / 2;
  left.position.set(BOX.xMin, H / 2, (BOX.zBack + BOX.zFront) / 2);
  group.add(left);

  const right = wall(inner, D, H);
  right.rotation.y = -Math.PI / 2;
  right.position.set(BOX.xMax, H / 2, (BOX.zBack + BOX.zFront) / 2);
  group.add(right);

  const floor = wall(inner, W, D);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (BOX.zBack + BOX.zFront) / 2);
  group.add(floor);

  // Techo con la boca del tiro.
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 1 });
  const ceilFront = new THREE.Mesh(new THREE.PlaneGeometry(W, D * 0.45), ceilMat);
  ceilFront.rotation.x = Math.PI / 2;
  ceilFront.position.set(0, H, BOX.zFront - D * 0.225);
  group.add(ceilFront);
  const flue = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  flue.rotation.x = Math.PI / 2;
  flue.position.set(0, H + 0.4, (BOX.zBack + BOX.zFront) / 2);
  group.add(flue);

  // Fachada de ladrillo ocre con el hueco del hogar.
  const facadeMat = sootyBrick('facade', 0);
  facadeMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float lip = smoothstep(${(H + 0.25).toFixed(2)}, ${H.toFixed(2)}, vWPos.y) * (1.0 - smoothstep(0.55, 0.85, abs(vWPos.x)));
        diffuseColor.rgb *= mix(1.0, 0.35, lip * step(${(H - 0.01).toFixed(2)}, vWPos.y));`);
  };
  const FW = 3.2, FH = 2.4;
  const shape = new THREE.Shape();
  shape.moveTo(-FW / 2, -0.35);
  shape.lineTo(FW / 2, -0.35);
  shape.lineTo(FW / 2, FH);
  shape.lineTo(-FW / 2, FH);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(BOX.xMin, 0);
  hole.lineTo(BOX.xMin, H);
  hole.lineTo(BOX.xMax, H);
  hole.lineTo(BOX.xMax, 0);
  hole.closePath();
  shape.holes.push(hole);
  const facadeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  const fuv = facadeGeo.attributes.uv;
  const [ftw, fth] = facadeMat.userData.tile;
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) / ftw, fuv.getY(i) / fth);
  const facade = new THREE.Mesh(facadeGeo, facadeMat);
  facade.position.z = BOX.zFront;
  facade.receiveShadow = true;
  group.add(facade);

  // Repisa de madera.
  const woodMat = new THREE.MeshStandardMaterial({ map: floorTexture(), color: 0x7a5236, roughness: 0.7 });
  const mantel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.32), woodMat);
  mantel.position.set(0, H + 0.42, BOX.zFront + 0.12);
  mantel.castShadow = mantel.receiveShadow = true;
  group.add(mantel);

  // Losa del hogar y suelo de la sala.
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.85 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.55), stoneMat);
  slab.position.set(0, -0.04, BOX.zFront + 0.06 + 0.275);
  slab.receiveShadow = true;
  group.add(slab);
  const ftex = floorTexture();
  ftex.repeat.set(3, 3);
  const roomFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.6 })
  );
  roomFloor.rotation.x = -Math.PI / 2;
  roomFloor.position.set(0, -0.35, 3);
  roomFloor.receiveShadow = true;
  group.add(roomFloor);

  // Parrilla de hierro fundido.
  const iron = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.72, metalness: 0.6, emissive: 0x000000 });
  const grate = new THREE.Group();
  const barLen = GRATE.zMax - GRATE.zMin;
  for (const x of grateBarXs()) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(GRATE.barR, GRATE.barR, barLen, 8), iron);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(x, GRATE.top - GRATE.barR, (GRATE.zMin + GRATE.zMax) / 2);
    grate.add(bar);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(GRATE.barR * 0.9, GRATE.barR * 0.9, GRATE.frontPostH, 6), iron);
    post.position.set(x, GRATE.top + GRATE.frontPostH / 2 - 0.01, GRATE.zMax);
    grate.add(post);
    const bpost = new THREE.Mesh(new THREE.CylinderGeometry(GRATE.barR * 0.9, GRATE.barR * 0.9, GRATE.backPostH, 6), iron);
    bpost.position.set(x, GRATE.top + GRATE.backPostH / 2 - 0.01, GRATE.zMin);
    grate.add(bpost);
  }
  const railGeo = new THREE.BoxGeometry(GRATE.xMax - GRATE.xMin + 0.04, 0.02, 0.02);
  for (const [z, y] of [[GRATE.zMin, GRATE.top - 0.012], [GRATE.zMax, GRATE.top - 0.012], [GRATE.zMax, GRATE.top + GRATE.frontPostH - 0.02], [GRATE.zMin, GRATE.top + GRATE.backPostH - 0.02]]) {
    const rail = new THREE.Mesh(railGeo, iron);
    rail.position.set(0, y, z);
    grate.add(rail);
  }
  for (const x of [GRATE.xMin - 0.01, GRATE.xMax + 0.01]) for (const z of [GRATE.zMin + 0.02, GRATE.zMax - 0.02]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, GRATE.top, 0.02), iron);
    leg.position.set(x, GRATE.top / 2, z);
    grate.add(leg);
  }
  grate.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(grate);

  // Luces: fuego principal (con sombras), apoyo, brasas y la noche de la sala.
  const fireLight = new THREE.PointLight(0xff8f45, 0, 0, 2);
  fireLight.position.set(0, 0.3, -0.1);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(1024, 1024);
  fireLight.shadow.bias = -0.004;
  fireLight.shadow.normalBias = 0.02;
  fireLight.shadow.radius = 4;
  fireLight.shadow.camera.near = 0.02;
  fireLight.shadow.camera.far = 6;
  scene.add(fireLight);

  const fillLight = new THREE.PointLight(0xffaa60, 0, 0, 2);
  fillLight.position.set(0.1, 0.45, 0.0);
  scene.add(fillLight);

  const emberLight = new THREE.PointLight(0xff3a0a, 0, 0, 2);
  emberLight.position.set(0, 0.14, -0.1);
  scene.add(emberLight);

  const roomLight = new THREE.PointLight(0xff8c40, 0, 0, 2);
  roomLight.position.set(0, 0.5, 0.55);
  scene.add(roomLight);

  const hemi = new THREE.HemisphereLight(0x3a4560, 0x120a06, 0.12);
  scene.add(hemi);

  // Lámpara tenue de la sala: permite ver la leña con la chimenea apagada.
  const lamp = new THREE.SpotLight(0xffc890, 5, 0, 0.55, 0.9, 2);
  lamp.position.set(0.9, 1.6, 1.9);
  lamp.target.position.set(0, 0.2, -0.15);
  scene.add(lamp, lamp.target);

  return { group, iron, wall: inner, lights: { fireLight, fillLight, emberLight, roomLight, hemi, lamp } };
}
