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
  let prevLog = [];
  let logInitialized = false;

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }

  // ---------- SOUND ----------
  const muteBtn = document.getElementById('btn-mute');
  function syncMuteButton() {
    muteBtn.textContent = window.AirplaneSound.isMuted() ? '🔇' : '🔊';
  }
  syncMuteButton();
  muteBtn.addEventListener('click', () => {
    window.AirplaneSound.setMuted(!window.AirplaneSound.isMuted());
    syncMuteButton();
  });

  // ---------- CLICKABLE LOGO ----------
  const brandLink = document.getElementById('brand-link');
  brandLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentRoomCode) {
      leaveRoom();
    }
    showView('home');
  });

  // ---------- BUG REPORT ----------
  const bugReportBtn = document.getElementById('btn-bug-report');
  const bugReportModal = document.getElementById('bug-report-modal');
  const closeBugModalBtn = document.getElementById('btn-close-bug-modal');
  const bugReportForm = document.getElementById('bug-report-form');
  const bugDescriptionInput = document.getElementById('bug-description');
  const bugSuccessMessage = document.getElementById('bug-success-message');

  bugReportBtn.addEventListener('click', () => {
    bugReportModal.classList.remove('hidden');
    bugDescriptionInput.focus();
  });

  closeBugModalBtn.addEventListener('click', () => {
    bugReportModal.classList.add('hidden');
    bugReportForm.reset();
    bugSuccessMessage.classList.add('hidden');
  });

  bugReportForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const description = bugDescriptionInput.value.trim();
    if (!description) return;

    const bugData = {
      description,
      roomCode: currentRoomCode,
      gameState: latestGameView ? 'in-game' : 'lobby',
      timestamp: new Date().toISOString(),
    };

    fetch('/api/bug-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bugData),
    }).then((res) => {
      if (res.ok) {
        bugSuccessMessage.classList.remove('hidden');
        bugReportForm.reset();
        setTimeout(() => {
          bugReportModal.classList.add('hidden');
          bugSuccessMessage.classList.add('hidden');
        }, 2000);
      }
    }).catch((err) => {
      console.error('Bug report failed:', err);
      alert('Failed to submit bug report. Please try again.');
    });
  });

  // Close modal on outside click
  bugReportModal.addEventListener('click', (e) => {
    if (e.target === bugReportModal) {
      bugReportModal.classList.add('hidden');
      bugReportForm.reset();
      bugSuccessMessage.classList.add('hidden');
    }
  });

  // ---------- BACK-TO-TOP BUTTON ----------
  const backToTopBtn = document.getElementById('btn-back-to-top');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 100) {
      backToTopBtn.classList.remove('hidden');
    } else {
      backToTopBtn.classList.add('hidden');
    }
  });

  backToTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Diff the server's log window against what we've already seen and play
  // a sound for each newly-appended line (covers every player's actions,
  // not just the local one).
  function newLogLines(oldLog, newLog) {
    const maxK = Math.min(oldLog.length, newLog.length);
    let k = 0;
    for (let cand = maxK; cand >= 0; cand--) {
      let match = true;
      for (let i = 0; i < cand; i++) {
        if (oldLog[oldLog.length - cand + i] !== newLog[i]) { match = false; break; }
      }
      if (match) { k = cand; break; }
    }
    return newLog.slice(k);
  }

  function playSoundsForLog(v) {
    if (!logInitialized) {
      prevLog = v.log.slice();
      logInitialized = true;
      return;
    }
    newLogLines(prevLog, v.log).forEach((line) => {
      if (line.includes('took the gas-station shortcut')) window.AirplaneSound.gasShortcut();
      else if (line.includes('sent an opponent plane back to the hangar')) window.AirplaneSound.capture();
      else if (line.includes('landed on their own color and jumped ahead')) window.AirplaneSound.jump();
      else if (line.includes('is ready for takeoff')) window.AirplaneSound.launch();
      else if (line.includes('wins!')) window.AirplaneSound.win();
      else if (line.includes('landed home')) window.AirplaneSound.home();
    });
    prevLog = v.log.slice();
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

  let selectedColor = window.AirplaneBoard.COLORS[0];

  function renderHomeColorSwatches() {
    const wrap = document.getElementById('home-color-swatches');
    wrap.innerHTML = '';
    window.AirplaneBoard.COLORS.forEach((color) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch' + (selectedColor === color ? ' selected' : '');
      btn.style.background = window.AirplaneBoard.COLOR_HEX[color];
      btn.title = color;
      btn.addEventListener('click', () => {
        selectedColor = color;
        renderHomeColorSwatches();
      });
      wrap.appendChild(btn);
    });
  }
  renderHomeColorSwatches();

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      homeError.textContent = '';
      const humanTarget = Number(btn.dataset.target);
      socket.emit('room:create', { name: getName(), humanTarget, color: selectedColor }, (res) => {
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

    renderColorSwatches(v);
  }

  function renderColorSwatches(v) {
    const wrap = document.getElementById('color-swatches');
    wrap.innerHTML = '';
    const mySeat = v.seats.find((s) => s.type === 'human' && s.socketId === socket.id);
    window.AirplaneBoard.COLORS.forEach((color) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch' + (mySeat && mySeat.color === color ? ' selected' : '');
      btn.style.background = COLOR_HEX[color];
      btn.title = color;
      btn.disabled = !mySeat;
      btn.addEventListener('click', () => {
        socket.emit('room:chooseColor', { code: currentRoomCode, color }, () => {});
      });
      wrap.appendChild(btn);
    });
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
    prevLog = [];
    logInitialized = false;
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
    window.AirplaneSound.move();
    socket.emit('game:move', { code: currentRoomCode, planeIndex }, () => {});
  };

  const DICE_PIPS = {
    1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
  };

  // Build the 9-pip layout inside each of the cube's 6 faces once.
  document.querySelectorAll('#dice-cube .face').forEach((faceEl) => {
    const value = Number(faceEl.dataset.face);
    const active = new Set(DICE_PIPS[value]);
    for (let pos = 1; pos <= 9; pos++) {
      const pip = document.createElement('span');
      pip.className = 'pip' + (active.has(pos) ? ' active' : '');
      pip.dataset.pos = pos;
      faceEl.appendChild(pip);
    }
  });

  // Rotation (in degrees) that brings each face to point at the viewer.
  const FACE_ROTATION = {
    1: { x: 0, y: 0 }, 2: { x: -90, y: 0 }, 3: { x: 0, y: -90 },
    4: { x: 0, y: 90 }, 5: { x: 90, y: 0 }, 6: { x: 0, y: 180 },
  };
  const cubeEl = document.getElementById('dice-cube');
  const cubeRot = { x: 0, y: 0 };
  let lastDiceValue = null;

  function nextRotation(current, target, extraSpins) {
    const base = current + extraSpins * 360;
    const diff = ((target - base) % 360 + 360) % 360;
    return base + diff;
  }

  function rollCubeTo(value) {
    const target = FACE_ROTATION[value];
    const spins = 2 + Math.floor(Math.random() * 2); // 2-3 extra full turns per axis
    cubeRot.x = nextRotation(cubeRot.x, target.x, spins);
    cubeRot.y = nextRotation(cubeRot.y, target.y, spins);
    cubeEl.style.transform = `rotateX(${cubeRot.x}deg) rotateY(${cubeRot.y}deg)`;
  }

  document.getElementById('btn-roll').addEventListener('click', () => {
    document.getElementById('btn-roll').disabled = true;
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

  function renderGame() {
    const v = latestGameView;
    if (!v) return;

    if (v.dice && v.dice !== lastDiceValue) {
      lastDiceValue = v.dice;
      rollCubeTo(v.dice);
      window.AirplaneSound.roll();
    }

    playSoundsForLog(v);

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
      const home = p.planes.filter((pl) => pl.n === window.AirplaneBoard.FINISHED_N).length;
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
