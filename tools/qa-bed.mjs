// Prueba del lecho de brasas y ceniza: node run.mjs http://localhost:5173/ tools/qa-bed.mjs <carpeta>
export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => window.__chimenea, null, { timeout: 30000 });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__chimenea, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const shots = [
    ['bed-hot', { bed: 0.6, ash: 0.1, bedHeat: 0.9 }],
    ['bed-warm', { bed: 0.25, ash: 0.12, bedHeat: 0.35 }],
    ['bed-cold', { bed: 0.05, ash: 0.15, bedHeat: 0.0 }],
  ];
  const info = [];
  for (const [name, s] of shots) {
    await page.evaluate((s) => {
      const { game, ui, rig } = window.__chimenea;
      ui.closeModal();
      Object.assign(game.sim, s);
      rig.goal.yaw = 0.15; rig.goal.pitch = 0.7; rig.goal.dist = 0.8;
    }, s);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `tools/shot-${name}.png` });
    info.push(await page.evaluate(() => {
      const { game } = window.__chimenea;
      return { bed: game.sim.bed, ash: game.sim.ash, glow: game.sim.bedGlow };
    }));
  }
  return info;
}
