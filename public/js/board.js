// Board geometry for 飞机棋 (Flying Chess), backed by the real board
// artwork's coordinates (public/assets/board-data.json), expressed as
// percentages (0-100) of the square SVG viewBox. Pieces are positioned
// with CSS on top of the board image rather than drawn procedurally.
//
// Mirrors the server's abstract model 1:1 (see server/game/engine.js for
// how these constants were verified against the real board artwork):
//   n === 0             -> hangar slot
//   n === -1            -> ready pad (waiting to launch)
//   1 <= n <= RING_SPAN  -> ring[(launchIndex + n - 1) % 52]
//   RING_SPAN < n < FINISHED_N -> homeStretch[color][n - RING_SPAN - 1]
//   n === FINISHED_N     -> the 6th (last) home cell; finished, parks at its
//                            hangar slot, dimmed, no longer part of play

(function () {
  const COLORS = ['orange', 'green', 'red', 'blue'];
  const LAUNCH_INDEX = { green: 0, red: 13, blue: 26, orange: 39 };
  const RING_SPAN = 50;
  const FINISHED_N = 56;
  const COLOR_HEX = {
    orange: '#F6AE2D', // Honey Bronze
    green: '#5FAD56',  // Moss Green
    red: '#A4031F',    // Ruby Red
    blue: '#07A0C3',   // Blue Green
  };

  let DATA = null;

  function pointForPlane(color, n, slot) {
    if (!DATA) return { x: 50, y: 50 };
    if (n === 0 || n === FINISHED_N) return DATA.hangar[color][slot];
    if (n === -1) return DATA.ready[color];
    if (n > RING_SPAN) return DATA.home[color][n - RING_SPAN - 1];
    const idx = (LAUNCH_INDEX[color] + n - 1 + 52) % 52;
    return DATA.ring[idx];
  }

  const ready = fetch('/assets/board-data.json')
    .then((r) => r.json())
    .then((data) => { DATA = data; });

  window.AirplaneBoard = {
    COLORS,
    LAUNCH_INDEX,
    RING_SPAN,
    FINISHED_N,
    COLOR_HEX,
    ready,
    pointForPlane,
    get data() { return DATA; },
  };
})();
