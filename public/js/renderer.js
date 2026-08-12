// Canvas rendering for the flying-chess board.

class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.unit = 0;
    this.onPlaneClick = null;
    this._hitAreas = [];
    canvas.addEventListener('click', (e) => this._handleClick(e));
    canvas.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        const t = e.changedTouches[0];
        this._handleClick({ clientX: t.clientX, clientY: t.clientY });
      }
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    const size = Math.min(parent.clientWidth, 720);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.unit = size / window.AirplaneBoard.GRID;
    this.size = size;
  }

  px(pt) {
    return { x: pt.c * this.unit, y: pt.r * this.unit };
  }

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const hit of this._hitAreas) {
      const dx = x - hit.x;
      const dy = y - hit.y;
      if (dx * dx + dy * dy <= hit.r * hit.r) {
        if (this.onPlaneClick) this.onPlaneClick(hit.playerIndex, hit.planeIndex);
        return;
      }
    }
  }

  draw(gameView, localPlayerIndex) {
    const B = window.AirplaneBoard;
    const ctx = this.ctx;
    const u = this.unit;
    this._hitAreas = [];

    ctx.clearRect(0, 0, this.size, this.size);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, this.size, this.size);

    // hangars
    B.COLORS.forEach((color) => {
      const b = B.HANGAR_BOUNDS[color];
      const x = b.c0 * u, y = b.r0 * u;
      const w = (b.c1 - b.c0 + 1) * u, h = (b.r1 - b.r0 + 1) * u;
      ctx.fillStyle = hexAlpha(B.COLOR_HEX[color], 0.18);
      roundRect(ctx, x + u * 0.15, y + u * 0.15, w - u * 0.3, h - u * 0.3, u * 0.6);
      ctx.fill();
      ctx.strokeStyle = hexAlpha(B.COLOR_HEX[color], 0.55);
      ctx.lineWidth = Math.max(1, u * 0.06);
      ctx.stroke();

      for (let slot = 0; slot < 4; slot++) {
        const pt = B.pointForPlane(color, 0, slot);
        const p = this.px(pt);
        ctx.beginPath();
        ctx.arc(p.x, p.y, u * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(B.COLOR_HEX[color], 0.15);
        ctx.fill();
        ctx.strokeStyle = hexAlpha(B.COLOR_HEX[color], 0.4);
        ctx.lineWidth = Math.max(1, u * 0.05);
        ctx.stroke();
      }
    });

    // ring cells
    B.RING.forEach((cell, idx) => {
      const p = this.px(cell);
      const isLaunch = Object.values(B.LAUNCH_INDEX).includes(idx);
      let launchColor = null;
      for (const c of B.COLORS) if (B.LAUNCH_INDEX[c] === idx) launchColor = c;

      ctx.beginPath();
      roundRect(ctx, p.x - u * 0.46, p.y - u * 0.46, u * 0.92, u * 0.92, u * 0.18);
      ctx.fillStyle = isLaunch ? hexAlpha(B.COLOR_HEX[launchColor], 0.5) : '#1a2437';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // home stretches
    B.COLORS.forEach((color) => {
      B.HOME_STRETCH[color].forEach((cell) => {
        const p = this.px(cell);
        ctx.beginPath();
        ctx.arc(p.x, p.y, u * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(B.COLOR_HEX[color], 0.55);
        ctx.fill();
      });
    });

    // center hub
    const c = this.px(B.CENTER);
    ctx.beginPath();
    ctx.arc(c.x, c.y, u * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = '#f0f4ff';
    ctx.fill();
    ctx.font = `${Math.round(u * 1.3)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🗼', c.x, c.y + u * 0.05);

    // planes
    if (gameView && gameView.players) {
      const occupied = new Map();
      gameView.players.forEach((player, pIdx) => {
        player.planes.forEach((plane, planeIdx) => {
          const pt = B.pointForPlane(player.color, plane.n, planeIdx);
          const key = `${Math.round(pt.r * 4)},${Math.round(pt.c * 4)}`;
          const list = occupied.get(key) || [];
          list.push({ pIdx, planeIdx, pt, color: player.color, n: plane.n });
          occupied.set(key, list);
        });
      });

      const isLocalTurn = gameView.currentPlayer === localPlayerIndex && gameView.diceRolled;

      occupied.forEach((list) => {
        const n = list.length;
        list.forEach((item, i) => {
          const p = this.px(item.pt);
          let ox = 0, oy = 0;
          if (n > 1) {
            const angle = (i / n) * Math.PI * 2;
            ox = Math.cos(angle) * u * 0.22;
            oy = Math.sin(angle) * u * 0.22;
          }
          const x = p.x + ox, y = p.y + oy;
          const isCurrent = gameView.currentPlayer === item.pIdx;
          const movable = isLocalTurn && item.pIdx === localPlayerIndex &&
            gameView.legalMoves.includes(item.planeIdx);

          if (movable) {
            ctx.beginPath();
            ctx.arc(x, y, u * 0.5, 0, Math.PI * 2);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = Math.max(2, u * 0.09);
            ctx.setLineDash([u * 0.14, u * 0.1]);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          ctx.beginPath();
          ctx.arc(x, y, u * 0.36, 0, Math.PI * 2);
          ctx.fillStyle = window.AirplaneBoard.COLOR_HEX[item.color];
          ctx.fill();
          ctx.strokeStyle = isCurrent ? '#fff' : 'rgba(0,0,0,0.35)';
          ctx.lineWidth = Math.max(1, u * 0.05);
          ctx.stroke();
          ctx.font = `${Math.round(u * 0.45)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✈️', x, y + u * 0.02);

          if (movable) {
            this._hitAreas.push({ x, y, r: u * 0.55, playerIndex: item.pIdx, planeIndex: item.planeIdx });
          }
        });
      });
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

window.BoardRenderer = BoardRenderer;
