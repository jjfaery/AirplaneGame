'use strict';

const engine = require('./game/engine');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const COLOR_LABEL = { orange: '橙色', green: '绿色', red: '红色', blue: '蓝色' };

function genCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> room
    this.socketRoom = new Map(); // socketId -> code
  }

  createRoom(socket, name, humanTarget) {
    humanTarget = Math.min(4, Math.max(1, humanTarget | 0));
    let code;
    do { code = genCode(); } while (this.rooms.has(code));

    const seats = [
      { type: 'human', socketId: socket.id, name: name || 'Host', connected: true },
    ];
    for (let i = 1; i < 4; i++) {
      if (i < humanTarget) seats.push({ type: 'open' });
      else seats.push({ type: 'ai', name: `电脑${i}` });
    }

    const room = {
      code,
      hostSocketId: socket.id,
      humanTarget,
      seats,
      phase: 'lobby',
      game: null,
      aiTimer: null,
    };
    this.rooms.set(code, room);
    this._join(socket, code);
    return room;
  }

  joinRoom(socket, code, name) {
    code = (code || '').toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.phase !== 'lobby') return { error: 'ALREADY_STARTED' };

    const openSeat = room.seats.find((s) => s.type === 'open');
    if (!openSeat) return { error: 'ROOM_FULL' };

    openSeat.type = 'human';
    openSeat.socketId = socket.id;
    openSeat.name = name || 'Player';
    openSeat.connected = true;

    this._join(socket, code);
    return { room };
  }

  _join(socket, code) {
    socket.join(code);
    this.socketRoom.set(socket.id, code);
  }

  startGame(socket, code) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.hostSocketId !== socket.id) return { error: 'NOT_HOST' };
    if (room.phase !== 'lobby') return { error: 'ALREADY_STARTED' };

    room.seats.forEach((seat, i) => {
      if (seat.type === 'open') {
        room.seats[i] = { type: 'ai', name: `电脑${i}` };
      }
    });

    const seatConfigs = room.seats.map((seat) => ({
      id: seat.type === 'human' ? seat.socketId : `ai-${Math.random().toString(36).slice(2)}`,
      name: seat.name,
      isAI: seat.type === 'ai',
    }));

    room.phase = 'playing';
    room.game = engine.createGame(seatConfigs);
    this._scheduleAI(room);
    return { room };
  }

  roll(socket, code) {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'playing') return { error: 'NOT_PLAYING' };
    const game = room.game;
    const player = game.players[game.currentPlayer];
    if (player.id !== socket.id) return { error: 'NOT_YOUR_TURN' };
    if (game.diceRolled) return { error: 'ALREADY_ROLLED' };
    engine.rollDice(game);
    this._scheduleAI(room);
    return { room };
  }

  move(socket, code, planeIndex) {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'playing') return { error: 'NOT_PLAYING' };
    const game = room.game;
    const player = game.players[game.currentPlayer];
    if (player.id !== socket.id) return { error: 'NOT_YOUR_TURN' };
    try {
      engine.applyMove(game, planeIndex);
    } catch (e) {
      return { error: e.message };
    }
    this._scheduleAI(room);
    return { room };
  }

  gasChoice(socket, code, planeIndex, useShortcut) {
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'playing') return { error: 'NOT_PLAYING' };
    const game = room.game;
    const player = game.players[game.currentPlayer];
    if (player.id !== socket.id) return { error: 'NOT_YOUR_TURN' };
    try {
      engine.resolveGasChoice(game, planeIndex, !!useShortcut);
    } catch (e) {
      return { error: e.message };
    }
    this._scheduleAI(room);
    return { room };
  }

  _scheduleAI(room) {
    if (room.phase !== 'playing') return;
    const game = room.game;
    if (game.phase === 'finished') return;

    const player = game.players[game.currentPlayer];
    const autoPlay = player.isAI || player.connected === false;
    if (!autoPlay) return;
    if (room.aiTimer) return;

    room.aiTimer = setTimeout(() => {
      room.aiTimer = null;
      if (room.phase !== 'playing' || game.phase === 'finished') return;
      const p = game.players[game.currentPlayer];
      if (!(p.isAI || p.connected === false)) return;

      if (game.awaitingGasChoice) {
        const useShortcut = engine.chooseAIGasDecision();
        engine.resolveGasChoice(game, game.awaitingGasChoice.planeIdx, useShortcut);
        this.broadcastGame(room);
        if (game.phase !== 'finished') this._scheduleAI(room);
        return;
      }

      if (!game.diceRolled) {
        engine.rollDice(game);
        this.broadcastGame(room);
        if (game.phase === 'finished') return;
        this._scheduleAI(room);
        return;
      }

      const choice = engine.chooseAIMove(game);
      if (choice !== null && choice !== undefined) {
        engine.applyMove(game, choice);
      } else {
        engine.advanceTurn(game);
      }
      this.broadcastGame(room);
      if (game.phase !== 'finished') this._scheduleAI(room);
    }, 700 + Math.random() * 500);
  }

  leave(socket) {
    const code = this.socketRoom.get(socket.id);
    if (!code) return;
    const room = this.rooms.get(code);
    this.socketRoom.delete(socket.id);
    if (!room) return;

    const seat = room.seats.find((s) => s.type === 'human' && s.socketId === socket.id);
    if (!seat) return;

    if (room.phase === 'lobby') {
      const idx = room.seats.indexOf(seat);
      room.seats[idx] = { type: 'open' };
      if (room.hostSocketId === socket.id) {
        const nextHuman = room.seats.find((s) => s.type === 'human');
        if (nextHuman) {
          room.hostSocketId = nextHuman.socketId;
        } else {
          this.rooms.delete(code);
          return;
        }
      }
      this.broadcastRoom(room);
    } else if (room.phase === 'playing') {
      seat.connected = false;
      const gp = room.game.players.find((p) => p.id === socket.id);
      if (gp) gp.connected = false;
      this.broadcastGame(room);
      this._scheduleAI(room);
    }
  }

  broadcastRoom(room) {
    this.io.to(room.code).emit('room:update', this.roomView(room));
  }

  broadcastGame(room) {
    this.io.to(room.code).emit('game:update', this.gameView(room));
  }

  roomView(room) {
    return {
      code: room.code,
      hostSocketId: room.hostSocketId,
      humanTarget: room.humanTarget,
      phase: room.phase,
      seats: room.seats.map((s, i) => ({
        color: engine.COLORS[i],
        colorLabel: COLOR_LABEL[engine.COLORS[i]],
        type: s.type,
        name: s.name || null,
        connected: s.connected !== false,
        socketId: s.type === 'human' ? s.socketId : null,
      })),
    };
  }

  gameView(room) {
    const game = room.game;
    return {
      code: room.code,
      phase: room.phase,
      currentPlayer: game.currentPlayer,
      dice: game.dice,
      diceRolled: game.diceRolled,
      legalMoves: game.legalMoves,
      awaitingGasChoice: game.awaitingGasChoice,
      winner: game.winner,
      gamePhase: game.phase,
      log: game.log.slice(-30),
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        colorLabel: COLOR_LABEL[p.color],
        isAI: p.isAI,
        connected: p.connected !== false,
        finished: p.finished,
        planes: p.planes.map((pl) => ({ n: pl.n })),
      })),
    };
  }
}

module.exports = { RoomManager, COLOR_LABEL };
