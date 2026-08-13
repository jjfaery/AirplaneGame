'use strict';

// Core rules engine for 飞机棋 (Flying Chess / Aeroplane Chess).
// Server-authoritative, no rendering concerns here — only abstract state.
//
// Each plane's progress is tracked as a single integer `n`:
//   n === 0            -> parked in hangar
//   n === -1           -> on the "ready" pad, just outside the shared track
//   1 <= n <= 51       -> on the shared 52-cell outer ring
//   52 <= n <= 57      -> on this color's private 6-cell home stretch
//   n === 58           -> landed home (finished)
//
// Launching takes two 6s: hangar -> ready (first 6), ready -> ring entry
// (second 6). A color's ring position for a given n is
// (launchIndex + n - 1) mod 52.
//
// Every 4th ring cell belongs to a given color (a cell's owner is
// determined purely by n mod 4, which is the same for every color since
// each one's own n=1 is, by construction, one of its own cells). Landing
// on your own color auto-advances 4 more cells. The cell at relative n=5
// is additionally a gas-station trigger: instead of auto-advancing,
// the player chooses between the shortcut (fly to relative n=17,
// capturing anything on the relative n=3 flyover cell and the n=17
// landing cell, then auto-advance 4 more) or declining (just the normal
// +4, landing on relative n=9).

const COLORS = ['orange', 'green', 'red', 'blue'];
const LAUNCH_INDEX = { orange: 0, green: 13, red: 26, blue: 39 };
const SAFE_SQUARES = new Set(Object.values(LAUNCH_INDEX));
const PLANES_PER_PLAYER = 4;
const RING_SIZE = 52;

const OWN_COLOR_STEP = 4;
const GAS_TRIGGER_N = 5;
const GAS_FLYOVER_N = 3;
const GAS_DESTINATION_N = 17;

function ringIndex(color, n) {
  return (LAUNCH_INDEX[color] + n - 1 + RING_SIZE) % RING_SIZE;
}

function isOwnColorN(n) {
  return n >= 1 && n <= 51 && n % 4 === 1;
}

function newPlane() {
  return { n: 0 };
}

function createGame(seats) {
  const players = seats.map((seat, i) => ({
    id: seat.id,
    name: seat.name,
    color: COLORS[i],
    isAI: !!seat.isAI,
    connected: true,
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
    awaitingGasChoice: null, // { planeIdx, declineN } when a decision is pending
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
    } else if (plane.n === -1) {
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

// Capture any opposing plane sitting on the given absolute ring index
// (0..51), unless it's a safe/launch square. Returns true if anything
// was captured.
function captureAt(game, player, ringIdx) {
  if (SAFE_SQUARES.has(ringIdx)) return false;
  let captured = false;
  for (const other of game.players) {
    if (other === player) continue;
    for (const op of other.planes) {
      if (op.n >= 1 && op.n <= 51 && ringIndex(other.color, op.n) === ringIdx) {
        op.n = 0;
        captured = true;
      }
    }
  }
  return captured;
}

// Resolve landing on `n` for a plane already known to be entering ring
// space (1..51). Applies the mandatory own-color +4 once, then checks
// whether the result is the gas-station trigger. Returns either a final
// n (move fully resolved) or a pending-choice descriptor.
function resolveRingLanding(n) {
  let pos = n;
  if (isOwnColorN(pos) && pos !== GAS_TRIGGER_N) {
    pos += OWN_COLOR_STEP;
  }
  if (pos === GAS_TRIGGER_N) {
    return { pending: true, declineN: pos + OWN_COLOR_STEP };
  }
  return { pending: false, finalN: pos };
}

function finalizeLanding(game, player, plane, finalN) {
  let captured = false;
  let justFinishedPlane = false;

  plane.n = finalN;

  if (plane.n === 58) {
    justFinishedPlane = true;
    pushLog(game, `${player.name}'s plane landed home!`);
  } else if (plane.n >= 1 && plane.n <= 51) {
    const idx = ringIndex(player.color, plane.n);
    captured = captureAt(game, player, idx);
    if (captured) pushLog(game, `${player.name} sent an opponent plane back to the hangar!`);
  }

  const allHome = player.planes.every((p) => p.n === 58);
  if (allHome && !player.finished) {
    player.finished = true;
    game.phase = 'finished';
    game.winner = player.id;
    pushLog(game, `${player.name} got all planes home and wins!`);
  }

  return { captured, justFinishedPlane };
}

function applyMove(game, planeIdx) {
  const player = game.players[game.currentPlayer];
  if (!game.diceRolled) throw new Error('Dice not rolled yet');
  if (game.awaitingGasChoice) throw new Error('A gas-station choice is pending');
  if (!game.legalMoves.includes(planeIdx)) throw new Error('Illegal move');

  const dice = game.dice;
  const plane = player.planes[planeIdx];

  let targetN;
  if (plane.n === 0) {
    targetN = -1; // hangar -> ready pad
  } else if (plane.n === -1) {
    targetN = 1; // ready pad -> ring entry
  } else {
    targetN = plane.n + dice;
  }

  if (targetN === -1) {
    plane.n = -1;
    pushLog(game, `${player.name}'s plane is ready for takeoff.`);
    return finishTurn(game, dice, false, false);
  }

  if (targetN < 1 || targetN > 51) {
    // entering/advancing within home stretch or landing exactly home;
    // no own-color/gas-station rules apply off the shared ring
    const result = finalizeLanding(game, player, plane, targetN);
    return finishTurn(game, dice, result.captured, result.justFinishedPlane);
  }

  const resolved = resolveRingLanding(targetN);
  if (resolved.pending) {
    plane.n = GAS_TRIGGER_N; // provisionally sits at the trigger cell while deciding
    game.awaitingGasChoice = { planeIdx, declineN: resolved.declineN };
    pushLog(game, `${player.name} reached a gas station — choose to fly the shortcut or continue normally.`);
    return { pending: true };
  }

  const result = finalizeLanding(game, player, plane, resolved.finalN);
  return finishTurn(game, dice, result.captured, result.justFinishedPlane);
}

// Player decision at a gas station. useShortcut=true flies to the
// shortcut destination (capturing along the way) then auto-advances;
// false just takes the normal +4.
function resolveGasChoice(game, planeIdx, useShortcut) {
  const pending = game.awaitingGasChoice;
  if (!pending) throw new Error('No gas-station choice pending');
  if (pending.planeIdx !== planeIdx) throw new Error('Wrong plane for this choice');

  const player = game.players[game.currentPlayer];
  const plane = player.planes[planeIdx];
  const dice = game.dice;
  let captured = false;

  if (useShortcut) {
    const flyoverIdx = ringIndex(player.color, GAS_FLYOVER_N);
    const destIdx = ringIndex(player.color, GAS_DESTINATION_N);
    if (captureAt(game, player, flyoverIdx)) captured = true;
    if (captureAt(game, player, destIdx)) captured = true;
    if (captured) pushLog(game, `${player.name}'s shortcut sent an opponent plane back to the hangar!`);
    plane.n = GAS_DESTINATION_N + OWN_COLOR_STEP;
    pushLog(game, `${player.name} took the gas-station shortcut!`);
  } else {
    plane.n = pending.declineN;
  }

  game.awaitingGasChoice = null;

  const idx = ringIndex(player.color, plane.n);
  if (plane.n <= 51 && captureAt(game, player, idx)) captured = true;

  const allHome = player.planes.every((p) => p.n === 58);
  let justFinishedPlane = false;
  if (plane.n === 58) justFinishedPlane = true;
  if (allHome && !player.finished) {
    player.finished = true;
    game.phase = 'finished';
    game.winner = player.id;
    pushLog(game, `${player.name} got all planes home and wins!`);
  }

  return finishTurn(game, dice, captured, justFinishedPlane);
}

function finishTurn(game, dice, captured, justFinishedPlane) {
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
  game.awaitingGasChoice = null;
}

// --- Simple AI ---
function chooseAIMove(game) {
  const player = game.players[game.currentPlayer];
  const dice = game.dice;
  const legal = game.legalMoves;
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];

  const scored = legal.map((i) => {
    const plane = player.planes[i];
    let score = 0;
    const resultN = plane.n === 0 ? -1 : plane.n === -1 ? 1 : plane.n + dice;

    if (resultN === 58) score += 100;

    if (resultN >= 1 && resultN <= 51) {
      const idx = ringIndex(player.color, resultN);
      if (!SAFE_SQUARES.has(idx)) {
        for (const other of game.players) {
          if (other === player) continue;
          for (const op of other.planes) {
            if (op.n >= 1 && op.n <= 51 && ringIndex(other.color, op.n) === idx) {
              score += 50;
            }
          }
        }
      }
    }

    if (plane.n === 0 && dice === 6) score += 20;
    score += (resultN > 51 ? 51 : Math.max(resultN, 0)) * 0.2;

    return { i, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].i;
}

// AI always takes the shortcut when offered one — it's strictly more
// distance for the same +4 finish, and a bonus chance to capture.
function chooseAIGasDecision() {
  return true;
}

module.exports = {
  COLORS,
  LAUNCH_INDEX,
  SAFE_SQUARES,
  PLANES_PER_PLAYER,
  RING_SIZE,
  GAS_TRIGGER_N,
  GAS_FLYOVER_N,
  GAS_DESTINATION_N,
  ringIndex,
  createGame,
  getLegalMoves,
  rollDice,
  applyMove,
  resolveGasChoice,
  advanceTurn,
  chooseAIMove,
  chooseAIGasDecision,
};
