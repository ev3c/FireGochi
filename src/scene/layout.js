// Medidas del hogar (metros). Compartidas por la escena, la física y la interacción.
export const BOX = {
  xMin: -0.66, xMax: 0.66,
  zBack: -0.42, zFront: 0.16,
  height: 1.02,
};

export const GRATE = {
  bars: 7,
  xMin: -0.33, xMax: 0.33,
  zMin: -0.33, zMax: 0.06,
  barR: 0.011,
  top: 0.105,
  frontPostH: 0.075,
  backPostH: 0.17,
};

export const BED = { y: 0.005, w: 0.95, d: 0.48, z: -0.13 };

export function grateBarXs() {
  const xs = [];
  for (let i = 0; i < GRATE.bars; i++) xs.push(GRATE.xMin + (GRATE.xMax - GRATE.xMin) * (i / (GRATE.bars - 1)));
  return xs;
}
