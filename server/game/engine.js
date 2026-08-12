'use strict';

// Core rules engine for 飞机棋 (Flying Chess / Aeroplane Chess).
// Server-authoritative, no rendering concerns here — only abstract state.
//
// Each plane's progress is tracked as a single integer `n`:
//   n === 0            -> parked in hangar
//   1 <= n <= 51       -> on the shared 52-cell outer ring
//   52 <= n <= 57      -> on this color's private 6-cell home stretch
//   n === 58           -> landed home (finished)
//
// A color's ring position for a given n is (launchIndex + n - 1) mod 52.
// Since only 51 of the 52 ring steps are used per color, each color turns
// off into its own home stretch just before looping back to its own
// launch square.

const COLORS = ['red', 'green', 'blue', 'yellow'];
const LAUNCH_INDEX = { red: 0, green: 13, blue: 26, yellow: 39 };
const SAFE_SQUARES = new Set(Object.values(LAUNCH_INDEX));
const PLANES_PER_PLAYER = 4;
const RING_SIZE = 52;

function ringIndex(color, n) {
  return (LAUNCH_INDEX[color] + n - 1 + RING_SIZE) % RING_SIZE;
}

function newPlane() {
  return { n: 0 };
}

function createGame(seats) {
  // seats: array of 4 { id, name, isAI } in red/green/blue/yellow order
  const players = seats.map((seat, i) => ({
    id: seat.id,
    name: seat.name,
    color: COLORS[i],
    isAI: !!seat.isAI,
    connected: seat.isAI ? true : true,
    planes: [newPlane(), newPlane(), newPlane(), newPlane()],
    finished: false,
  }));

  return {
    players,
    currentPlayer: 0,
    dice: null,
    diceRolled: false,
    legalMoves: [],
    consecutiveSixes: 0,
    phase: 'playing', // 'playing' | 'finished'
    winner: null,
    log: [],
  };
}

function pushLog(game, text) {
  game.log.push(text);
  if (game.log.length > 200) game.log.shift();
}

function getLegalMoves(player, dice) {
  const legal = [];
  player.planes.forEach((plane, i) => {
    if (plane.n === 0) {
      if (dice === 6) legal.push(i);
    } else if (plane.n < 58) {
      if (plane.n + dice <= 58) legal.push(i);
    }
  });
  return legal;
}

function rollDice(game) {
  const player = game.players[game.currentPlayer];
  const dice = 1 + Math.floor(Math.random() * 6);
  game.dice = dice;
  game.diceRolled = true;
  game.legalMoves = getLegalMoves(player, dice);
  pushLog(game, `${player.name} rolled a ${dice}.`);

  if (game.legalMoves.length === 0) {
    pushLog(game, `${player.name} has no legal move.`);
    const grantExtra = dice === 6 && game.consecutiveSixes < 2;
    if (dice === 6) game.consecutiveSixes++; else game.consecutiveSixes = 0;
    if (!grantExtra) {
      advanceTurn(game);
    } else {
      game.diceRolled = false;
      game.dice = null;
    }
  }
  return game;
}

function applyMove(game, planeIdx) {
  const player = game.players[game.currentPlayer];
  if (!game.diceRolled) throw new Error('Dice not rolled yet');
  if (!game.legalMoves.includes(planeIdx)) throw new Error('Illegal move');

  const dice = game.dice;
  const plane = player.planes[planeIdx];
  let captured = false;
  let justFinishedPlane = false;

  if (plane.n === 0) {
    plane.n = 1;
  } else {
    plane.n += dice;
  }

  if (plane.n === 58) {
    justFinishedPlane = true;
    pushLog(game, `${player.name}'s plane #${planeIdx + 1} landed home!`);
  } else if (plane.n <= 51) {
    const idx = ringIndex(player.color, plane.n);
    if (!SAFE_SQUARES.has(idx)) {
      for (const other of game.players) {
        if (other === player) continue;
        for (const op of other.planes) {
          if (op.n >= 1 && op.n <= 51 && ringIndex(other.color, op.n) === idx) {
            op.n = 0;
            captured = true;
          }
        }
      }
      if (captured) pushLog(game, `${player.name} sent an opponent plane back to the hangar!`);
    }
  }

  const allHome = player.planes.every((p) => p.n === 58);
  if (allHome && !player.finished) {
    player.finished = true;
    game.phase = 'finished';
    game.winner = player.id;
    pushLog(game, `${player.name} got all planes home and wins!`);
  }

  game.diceRolled = false;
  game.dice = null;
  game.legalMoves = [];

  if (game.phase === 'finished') {
    return { captured, justFinishedPlane };
  }

  const bonusTurn = dice === 6 || captured || justFinishedPlane;
  if (dice === 6) {
    game.consecutiveSixes++;
  } else {
    game.consecutiveSixes = 0;
  }

  if (bonusTurn && game.consecutiveSixes < 3) {
    // same player goes again
  } else {
    game.consecutiveSixes = 0;
    advanceTurn(game);
  }

  return { captured, justFinishedPlane };
}

function advanceTurn(game) {
  game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
  game.dice = null;
  game.diceRolled = false;
  game.legalMoves = [];
}

// --- Simple AI ---
// Priority: capture > land a plane home exactly > launch from hangar if
// none currently out > advance the most-progressed plane.
function chooseAIMove(game) {
  const player = game.players[game.currentPlayer];
  const dice = game.dice;
  const legal = game.legalMoves;
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];

  const scored = legal.map((i) => {
    const plane = player.planes[i];
    let score = 0;
    const resultN = plane.n === 0 ? 1 : plane.n + dice;

    if (resultN === 58) score += 100; // finishing a plane is great

    if (resultN >= 1 && resultN <= 51) {
      const idx = ringIndex(player.color, resultN);
      if (!SAFE_SQUARES.has(idx)) {
        for (const other of game.players) {
          if (other === player) continue;
          for (const op of other.planes) {
            if (op.n >= 1 && op.n <= 51 && ringIndex(other.color, op.n) === idx) {
              score += 50; // capture opportunity
            }
          }
        }
      }
    }

    if (plane.n === 0 && dice === 6) score += 20; // prefer getting planes out
    score += (resultN > 51 ? 51 : resultN) * 0.2; // slight bias to furthest-along plane

    return { i, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].i;
}

module.exports = {
  COLORS,
  LAUNCH_INDEX,
  SAFE_SQUARES,
  PLANES_PER_PLAYER,
  RING_SIZE,
  ringIndex,
  createGame,
  getLegalMoves,
  rollDice,
  applyMove,
  advanceTurn,
  chooseAIMove,
};
