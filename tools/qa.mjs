// Prueba visual: node run.mjs http://localhost:5173/ tools/qa.mjs <carpeta>
export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => window.__chimenea, null, { timeout: 30000 });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__chimenea, null, { timeout: 30000 });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const { game, ui } = window.__chimenea;
    ui.closeModal();
    const X = { x: 0, y: 0, z: 0.7071, w: 0.7071 };
    const yawX = (a) => ({ x: -Math.sin(a / 2) * 0.7071, y: Math.sin(a / 2) * 0.7071, z: Math.cos(a / 2) * 0.7071, w: Math.cos(a / 2) * 0.7071 });
    game.addFuel('paper', { x: -0.04, y: 0.05, z: -0.12 }, { x: 0, y: 0, z: 0, w: 1 });
    game.addFuel('paper', { x: 0.08, y: 0.05, z: -0.1 }, { x: 0, y: 0, z: 0, w: 1 });
    for (let i = 0; i < 4; i++) game.addFuel('kindling', { x: 0, y: 0.13 + i * 0.012, z: -0.2 + i * 0.04 }, yawX((i - 1.5) * 0.15));
    game.addFuel('pinecone', { x: 0.2, y: 0.15, z: -0.1 }, { x: 0, y: 0, z: 0, w: 1 });
    game.addFuel('pine_thin', { x: 0, y: 0.2, z: -0.2 }, X);
    game.addFuel('pine_thin', { x: 0, y: 0.2, z: -0.04 }, X);
    game.addFuel('pine', { x: -0.02, y: 0.3, z: -0.18 }, yawX(0.1));
    game.addFuel('oak', { x: 0.02, y: 0.3, z: -0.03 }, yawX(-0.12));
    game.addFuel('birch', { x: 0, y: 0.42, z: -0.12 }, yawX(0.2));
    game.addFuel('holm', { x: 0.45, y: 0.1, z: 0.0 }, { x: 0, y: 0.38, z: 0, w: 0.92 });
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const { rig } = window.__chimenea; rig.goal.dist = 0.75; rig.goal.pitch = 0.35; rig.goal.yaw = 0.25; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tools/shot-wood.png' });

  await page.evaluate(() => {
    const { ix, rig } = window.__chimenea;
    rig.reset();
    ix.match = { life: 1, x: -0.04, y: 0.05, z: -0.06, age: 0 };
    ix.matchMesh.visible = true;
  });
  await page.waitForTimeout(40000);
  await page.screenshot({ path: 'tools/shot-fire.png' });
  await page.evaluate(() => { const { rig } = window.__chimenea; rig.goal.yaw = 0.75; rig.goal.pitch = 0.5; rig.goal.dist = 1.1; });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tools/shot-orbit.png' });
  await page.evaluate(() => { const { rig } = window.__chimenea; rig.goal.yaw = -0.3; rig.goal.pitch = 0.3; rig.goal.dist = 0.72; });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tools/shot-close.png' });
  await page.evaluate(() => { const { game, rig } = window.__chimenea; game.state.speed = 10; rig.reset(); });
  await page.waitForTimeout(30000);
  await page.evaluate(() => { const { game } = window.__chimenea; game.state.speed = 1; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tools/shot-late.png' });
  await page.evaluate(() => { const { rig } = window.__chimenea; rig.goal.yaw = 0.3; rig.goal.pitch = 0.4; rig.goal.dist = 0.8; });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tools/shot-late-close.png' });
  await page.evaluate(() => { const { game } = window.__chimenea; game.state.speed = 10; });
  await page.waitForTimeout(150000);
  await page.evaluate(() => { const { game, rig } = window.__chimenea; game.state.speed = 1; rig.goal.yaw = 0.2; rig.goal.pitch = 0.75; rig.goal.dist = 0.85; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tools/shot-bed.png' });
  await page.evaluate(() => { const { rig } = window.__chimenea; rig.reset(); });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tools/shot-bed-front.png' });
  return page.evaluate(() => {
    const { game } = window.__chimenea;
    return {
      level: game.level,
      power: game.sim.power,
      flame: game.sim.flameTotal,
      bed: game.sim.bed, ash: game.sim.ash, bedGlow: game.sim.bedGlow,
      items: [...game.entries.values()].map((e) => `${e.it.type}/${e.vis.wood?.kind || '-'}:${e.it.state}:${Math.round(e.it.T)}:${e.body.position.y.toFixed(2)}:sc${(e.surfChar || 0).toFixed(2)}:u${e.vis.uniforms[0].uChar.value.toFixed(2)}`),
    };
  });
}
