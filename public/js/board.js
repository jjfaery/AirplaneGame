// Board geometry for 飞机棋 (Flying Chess).
// A square 52-cell "runway circuit" (the shared ring) with 4 corner
// hangars (airports) and 4 diagonal "flight paths" (colored home
// stretches, 6 cells each) converging on a central control tower.
//
// This mirrors the server's abstract model 1:1:
//   n === 0        -> hangar
//   1 <= n <= 51    -> ring[(launchIndex + n - 1) % 52]
//   52 <= n <= 57   -> homeStretch[color][n - 52]
//   n === 58        -> center / finished

const COLORS = ['red', 'green', 'blue', 'yellow'];
const LAUNCH_INDEX = { red: 0, green: 13, blue: 26, yellow: 39 };
const COLOR_HEX = {
  red: '#e5484d',
  green: '#30a46c',
  blue: '#3b82f6',
  yellow: '#f5b400',
};

const GRID = 22; // total board units (0..21)
const INSET = 4; // ring starts at unit 4
const SIDE = 14; // 14 cells per side of the ring square
const CENTER = { r: (GRID - 1) / 2, c: (GRID - 1) / 2 };

function buildRing() {
  const cells = [];
  const top = INSET;
  const left = INSET;
  const right = INSET + SIDE - 1; // 17
  const bottom = INSET + SIDE - 1; // 17

  for (let c = left; c <= right; c++) cells.push({ r: top, c }); // top side, 14
  for (let r = top + 1; r <= bottom; r++) cells.push({ r, c: right }); // right side, 13
  for (let c = right - 1; c >= left; c--) cells.push({ r: bottom, c }); // bottom side, 13
  for (let r = bottom - 1; r >= top + 1; r--) cells.push({ r, c: left }); // left side, 12

  return cells; // length 52
}

const RING = buildRing();

const CORNER_POINT = {
  red: RING[LAUNCH_INDEX.red],
  green: RING[LAUNCH_INDEX.green],
  blue: RING[LAUNCH_INDEX.blue],
  yellow: RING[LAUNCH_INDEX.yellow],
};

function buildHomeStretch(color) {
  const corner = CORNER_POINT[color];
  const dr = CENTER.r - corner.r;
  const dc = CENTER.c - corner.c;
  const len = Math.hypot(dr, dc);
  const ux = dr / len;
  const uy = dc / len;
  const cells = [];
  // start a little inside the ring corner, step toward the center in 6 hops
  const startDist = 2.6;
  const endDist = len - 1.4;
  for (let i = 0; i < 6; i++) {
    const t = startDist + ((endDist - startDist) * i) / 5;
    cells.push({ r: corner.r + ux * t, c: corner.c + uy * t });
  }
  return cells;
}

const HOME_STRETCH = {};
COLORS.forEach((color) => { HOME_STRETCH[color] = buildHomeStretch(color); });

const HANGAR_BOUNDS = {
  red: { r0: 0, c0: 0, r1: INSET - 1, c1: INSET - 1 },
  green: { r0: 0, c0: GRID - INSET, r1: INSET - 1, c1: GRID - 1 },
  blue: { r0: GRID - INSET, c0: GRID - INSET, r1: GRID - 1, c1: GRID - 1 },
  yellow: { r0: GRID - INSET, c0: 0, r1: GRID - 1, c1: INSET - 1 },
};

function hangarSlotPoint(color, slot) {
  const b = HANGAR_BOUNDS[color];
  const cx = (b.r0 + b.r1) / 2;
  const cy = (b.c0 + b.c1) / 2;
  const dx = [-0.75, 0.75, -0.75, 0.75][slot];
  const dy = [-0.75, -0.75, 0.75, 0.75][slot];
  return { r: cx + dx, c: cy + dy };
}

// Resolve a plane's n-value (0..58) for a color into a board-unit point.
function pointForPlane(color, n, slot) {
  if (n === 0) return hangarSlotPoint(color, slot);
  if (n === 58) {
    const dx = [-0.4, 0.4, -0.4, 0.4][slot];
    const dy = [-0.4, -0.4, 0.4, 0.4][slot];
    return { r: CENTER.r + dx, c: CENTER.c + dy };
  }
  if (n >= 52) return HOME_STRETCH[color][n - 52];
  const idx = (LAUNCH_INDEX[color] + n - 1 + 52) % 52;
  return RING[idx];
}

window.AirplaneBoard = {
  COLORS,
  LAUNCH_INDEX,
  COLOR_HEX,
  GRID,
  RING,
  HOME_STRETCH,
  HANGAR_BOUNDS,
  CENTER,
  pointForPlane,
};
