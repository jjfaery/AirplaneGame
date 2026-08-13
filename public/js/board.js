// Board geometry for 飞机棋 (Flying Chess), backed by the real board
// artwork's coordinates (public/assets/board-data.json), expressed as
// percentages (0-100) of the square SVG viewBox. Pieces are positioned
// with CSS on top of the board image rather than drawn procedurally.
//
// Mirrors the server's abstract model 1:1:
//   n === 0        -> hangar slot
//   n === -1       -> ready pad (waiting for the second 6)
//   1 <= n <= 51    -> ring[(launchIndex + n - 1) % 52]
//   52 <= n <= 57   -> homeStretch[color][n - 52]
//   n === 58        -> finished (home)

(function () {
  const COLORS = ['orange', 'green', 'red', 'blue'];
  const LAUNCH_INDEX = { orange: 0, green: 13, red: 26, blue: 39 };
  const COLOR_HEX = {
    orange: '#F6AE2D', // Honey Bronze
    green: '#5FAD56',  // Moss Green
    red: '#A4031F',    // Ruby Red
    blue: '#07A0C3',   // Blue Green
  };

  let DATA = null;

  const FINISHED_OFFSET = [
    { x: -2.2, y: -2.2 },
    { x: 2.2, y: -2.2 },
    { x: -2.2, y: 2.2 },
    { x: 2.2, y: 2.2 },
  ];

  function pointForPlane(color, n, slot) {
    if (!DATA) return { x: 50, y: 50 };
    if (n === 0) return DATA.hangar[color][slot];
    if (n === -1) return DATA.ready[color];
    if (n === 58) {
      const c = { x: 50, y: 50 };
      const off = FINISHED_OFFSET[slot] || { x: 0, y: 0 };
      return { x: c.x + off.x, y: c.y + off.y };
    }
    if (n >= 52) return DATA.home[color][n - 52];
    const idx = (LAUNCH_INDEX[color] + n - 1 + 52) % 52;
    return DATA.ring[idx];
  }

  const ready = fetch('/assets/board-data.json')
    .then((r) => r.json())
    .then((data) => { DATA = data; });

  window.AirplaneBoard = {
    COLORS,
    LAUNCH_INDEX,
    COLOR_HEX,
    ready,
    pointForPlane,
    get data() { return DATA; },
  };
})();
