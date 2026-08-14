// Piece-token rendering for the flying-chess board. The board artwork
// itself is a static SVG background; this class only places/updates
// absolutely-positioned plane tokens on top of it, using percentage
// coordinates from board.js.

class BoardRenderer {
  constructor(layerEl) {
    this.layer = layerEl;
    this.onPlaneClick = null;
  }

  resize() {
    // Layout is percentage/aspect-ratio driven via CSS; nothing to do.
  }

  draw(gameView, localPlayerIndex) {
    const B = window.AirplaneBoard;
    this.layer.innerHTML = '';
    if (!B.data || !gameView || !gameView.players) return;

    const occupied = new Map();
    gameView.players.forEach((player, pIdx) => {
      player.planes.forEach((plane, planeIdx) => {
        const pt = B.pointForPlane(player.color, plane.n, planeIdx);
        const key = `${Math.round(pt.x * 4)},${Math.round(pt.y * 4)}`;
        const list = occupied.get(key) || [];
        list.push({ pIdx, planeIdx, pt, color: player.color, n: plane.n });
        occupied.set(key, list);
      });
    });

    const isLocalTurn = gameView.currentPlayer === localPlayerIndex &&
      gameView.diceRolled && !gameView.awaitingGasChoice;

    occupied.forEach((list) => {
      const n = list.length;
      list.forEach((item, i) => {
        let ox = 0, oy = 0;
        if (n > 1) {
          const angle = (i / n) * Math.PI * 2;
          ox = Math.cos(angle) * 1.5;
          oy = Math.sin(angle) * 1.5;
        }
        const x = item.pt.x + ox;
        const y = item.pt.y + oy;
        const isCurrent = gameView.currentPlayer === item.pIdx;
        const finished = item.n === B.FINISHED_N;
        const movable = !finished && isLocalTurn && item.pIdx === localPlayerIndex &&
          gameView.legalMoves.includes(item.planeIdx);

        const el = document.createElement('div');
        el.className = 'plane-token' + (movable ? ' movable' : '') + (isCurrent ? ' current' : '') + (finished ? ' finished' : '');
        el.style.left = x + '%';
        el.style.top = y + '%';
        el.style.background = B.COLOR_HEX[item.color];
        el.textContent = '✈️';
        if (movable) {
          el.addEventListener('click', () => {
            if (this.onPlaneClick) this.onPlaneClick(item.pIdx, item.planeIdx);
          });
        }
        this.layer.appendChild(el);
      });
    });
  }
}

window.BoardRenderer = BoardRenderer;
