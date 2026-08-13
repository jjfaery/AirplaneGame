(function () {
  const socket = io();

  const views = {
    home: document.getElementById('view-home'),
    lobby: document.getElementById('view-lobby'),
    game: document.getElementById('view-game'),
  };

  let currentRoomCode = null;
  let latestRoomView = null;
  let latestGameView = null;
  let renderer = null;

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }

  function setUrlRoom(code) {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
  }

  function getName() {
    const v = document.getElementById('input-name').value.trim();
    return v || 'Player';
  }

  // ---------- HOME ----------
  const homeError = document.getElementById('home-error');

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      homeError.textContent = '';
      const humanTarget = Number(btn.dataset.target);
      socket.emit('room:create', { name: getName(), humanTarget }, (res) => {
        if (!res.ok) { homeError.textContent = 'Could not create room.'; return; }
        currentRoomCode = res.code;
        setUrlRoom(res.code);
        if (humanTarget === 1) {
          socket.emit('room:start', { code: res.code }, () => {});
        } else {
          latestRoomView = res.view;
          renderLobby();
          showView('lobby');
        }
      });
    });
  });

  document.getElementById('btn-join').addEventListener('click', doJoin);
  document.getElementById('input-join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  function doJoin() {
    homeError.textContent = '';
    const code = document.getElementById('input-join-code').value.trim().toUpperCase();
    if (!code) { homeError.textContent = 'Enter a room code.'; return; }
    socket.emit('room:join', { code, name: getName() }, (res) => {
      if (!res.ok) {
        homeError.textContent = joinErrorMessage(res.error);
        return;
      }
      currentRoomCode = res.code;
      setUrlRoom(res.code);
      latestRoomView = res.view;
      renderLobby();
      showView('lobby');
    });
  }

  function joinErrorMessage(code) {
    switch (code) {
      case 'ROOM_NOT_FOUND': return 'Room not found.';
      case 'ROOM_FULL': return 'That room is full.';
      case 'ALREADY_STARTED': return 'That game has already started.';
      default: return 'Could not join room.';
    }
  }

  // prefill room code from URL
  (function initFromUrl() {
    const url = new URL(window.location.href);
    const room = url.searchParams.get('room');
    if (room) document.getElementById('input-join-code').value = room.toUpperCase();
  })();

  // ---------- LOBBY ----------
  const COLOR_HEX = window.AirplaneBoard.COLOR_HEX;

  function renderLobby() {
    if (!latestRoomView) return;
    const v = latestRoomView;
    document.getElementById('lobby-code').textContent = v.code;
    const link = window.location.origin + '/?room=' + v.code;
    document.getElementById('lobby-link').value = link;

    const seatsEl = document.getElementById('lobby-seats');
    seatsEl.innerHTML = '';
    v.seats.forEach((seat) => {
      const row = document.createElement('div');
      row.className = 'seat';
      const dot = document.createElement('div');
      dot.className = 'seat-dot';
      dot.style.background = COLOR_HEX[seat.color];
      const name = document.createElement('div');
      name.className = 'seat-name';
      name.textContent = seat.type === 'open' ? 'Waiting for player…' : seat.name;
      const tag = document.createElement('div');
      tag.className = 'seat-tag';
      tag.textContent = seat.type === 'human' ? (seat.socketId === socket.id ? 'You' : 'Human')
        : seat.type === 'ai' ? 'Computer' : 'Open';
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(tag);
      seatsEl.appendChild(row);
    });

    const isHost = v.hostSocketId === socket.id;
    const openCount = v.seats.filter((s) => s.type === 'open').length;
    document.getElementById('btn-start').classList.toggle('hidden', !isHost);
    document.getElementById('lobby-wait-msg').textContent = isHost
      ? (openCount > 0 ? `${openCount} seat(s) open — start now to fill with computer players.` : 'All seats filled.')
      : 'Waiting for the host to start the game…';
  }

  document.getElementById('btn-copy-link').addEventListener('click', () => {
    const input = document.getElementById('lobby-link');
    input.select();
    navigator.clipboard && navigator.clipboard.writeText(input.value).catch(() => {});
    const btn = document.getElementById('btn-copy-link');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    document.getElementById('lobby-error').textContent = '';
    socket.emit('room:start', { code: currentRoomCode }, (res) => {
      if (!res.ok) document.getElementById('lobby-error').textContent = 'Could not start game.';
    });
  });

  document.getElementById('btn-leave-lobby').addEventListener('click', () => {
    leaveRoom();
    showView('home');
  });

  function leaveRoom() {
    socket.emit('room:leave');
    currentRoomCode = null;
    latestRoomView = null;
    latestGameView = null;
    setUrlRoom(null);
  }

  // ---------- GAME ----------
  const pieceLayer = document.getElementById('piece-layer');
  renderer = new window.BoardRenderer(pieceLayer);
  window.AirplaneBoard.ready.then(() => {
    if (latestGameView) renderer.draw(latestGameView, myPlayerIndex());
  });

  function myPlayerIndex() {
    if (!latestGameView) return -1;
    return latestGameView.players.findIndex((p) => p.id === socket.id);
  }

  renderer.onPlaneClick = (playerIndex, planeIndex) => {
    if (playerIndex !== myPlayerIndex()) return;
    socket.emit('game:move', { code: currentRoomCode, planeIndex }, () => {});
  };

  document.getElementById('btn-roll').addEventListener('click', () => {
    socket.emit('game:roll', { code: currentRoomCode }, () => {});
  });

  document.getElementById('btn-gas-shortcut').addEventListener('click', () => {
    const v = latestGameView;
    if (!v || !v.awaitingGasChoice) return;
    socket.emit('game:gasChoice', {
      code: currentRoomCode,
      planeIndex: v.awaitingGasChoice.planeIdx,
      useShortcut: true,
    }, () => {});
  });

  document.getElementById('btn-gas-normal').addEventListener('click', () => {
    const v = latestGameView;
    if (!v || !v.awaitingGasChoice) return;
    socket.emit('game:gasChoice', {
      code: currentRoomCode,
      planeIndex: v.awaitingGasChoice.planeIdx,
      useShortcut: false,
    }, () => {});
  });

  document.getElementById('btn-play-again').addEventListener('click', () => {
    leaveRoom();
    document.getElementById('winner-banner').classList.add('hidden');
    showView('home');
  });

  const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function renderGame() {
    const v = latestGameView;
    if (!v) return;

    document.getElementById('dice-face').textContent = v.dice ? DICE_FACES[v.dice] : '–';

    const myIdx = myPlayerIndex();
    const isMyTurn = v.currentPlayer === myIdx && v.gamePhase === 'playing';
    const gasPending = !!v.awaitingGasChoice;
    const rollBtn = document.getElementById('btn-roll');
    rollBtn.disabled = !(isMyTurn && !v.diceRolled && !gasPending);

    const current = v.players[v.currentPlayer];
    const turnEl = document.getElementById('turn-indicator');
    if (v.gamePhase === 'finished') {
      turnEl.textContent = '';
    } else if (gasPending) {
      turnEl.textContent = isMyTurn
        ? 'Gas station! Choose below.'
        : `${current.name} is deciding at the gas station…`;
    } else if (isMyTurn) {
      turnEl.textContent = v.diceRolled ? 'Your turn — pick a plane to move' : 'Your turn — roll the dice';
    } else {
      turnEl.textContent = `${current.name}'s turn${current.isAI ? ' (computer)' : ''}…`;
    }

    const gasEl = document.getElementById('gas-choice');
    gasEl.classList.toggle('hidden', !(gasPending && isMyTurn));

    const panel = document.getElementById('players-panel');
    panel.innerHTML = '';
    v.players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'player-row' + (i === v.currentPlayer ? ' active' : '') + (!p.connected ? ' disconnected' : '');
      const dot = document.createElement('div');
      dot.className = 'player-dot';
      dot.style.background = COLOR_HEX[p.color];
      const name = document.createElement('div');
      name.className = 'player-name';
      name.textContent = p.name + (p.isAI ? ' 🤖' : '') + (i === myIdx ? ' (you)' : '') + (!p.connected ? ' (offline)' : '');
      const progress = document.createElement('div');
      progress.className = 'player-progress';
      const home = p.planes.filter((pl) => pl.n === 58).length;
      progress.textContent = `${home}/4 home`;
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(progress);
      panel.appendChild(row);
    });

    const logEl = document.getElementById('game-log');
    const wasAtBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 4;
    logEl.innerHTML = v.log.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
    if (wasAtBottom) logEl.scrollTop = logEl.scrollHeight;

    const banner = document.getElementById('winner-banner');
    if (v.gamePhase === 'finished') {
      const winner = v.players.find((p) => p.id === v.winner);
      document.getElementById('winner-text').textContent = winner
        ? `🏆 ${winner.name} wins!` : 'Game over';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    renderer.resize();
    renderer.draw(v, myIdx);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- SOCKET EVENTS ----------
  socket.on('room:update', (view) => {
    latestRoomView = view;
    if (!views.lobby.classList.contains('hidden')) renderLobby();
  });

  socket.on('game:update', (view) => {
    latestGameView = view;
    currentRoomCode = view.code;
    if (views.game.classList.contains('hidden')) showView('game');
    renderGame();
  });
})();
