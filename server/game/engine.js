'use strict';

// Core rules engine for 飞机棋 (Flying Chess / Aeroplane Chess).
// Server-authoritative, no rendering concerns here — only abstract state.
//
// Each plane's progress is tracked as a single integer `n`:
//   n === 0                    -> parked in hangar
//   n === -1                   -> on the "ready" pad, just outside the shared track
//   1 <= n < RING_SPAN+HOME_SPAN -> on the shared ring, then this color's 6-cell home
//                                  stretch (the last of those 6 cells IS n === FINISHED_N)
//   n === FINISHED_N           -> landed home (finished); token returns to its hangar
//                                  slot, dimmed, and takes no further part in the game
//
// Overshooting within the home stretch bounces back the remaining distance
// (classic Ludo-style rule) rather than blocking the move — e.g. sitting on
// the 5th home cell and rolling a 3 goes 5->6->5->4, landing on 4.
//
// Leaving the hangar takes a 6 (hangar -> ready pad). From the ready pad,
// any roll launches onto the ring, landing `dice` cells past the color's
// entry point (n === dice). A color's absolute ring position for a given
// n is (launchIndex + n - 1) mod 52 — verified directly against the real
// board artwork (each color's ready pad connects to a specific absolute
// ring cell; LAUNCH_INDEX below is that cell, 0-indexed).
//
// The ring's 52 cells are painted in a fixed repeating cycle — orange,
// green, red, blue, one color per cell — confirmed by direct pixel
// sampling of the board art. A player's own-color cells are therefore
// every 4th relative n starting at n=2 (n=2,6,10,...,50): their entry
// cell (n=1) is deliberately NOT their own color (it's the previous
// color in the cycle), matching the real board. Landing on an own-color
// cell auto-advances 4 more. n=50 is always a color's own-color cell
// AND the branch into their home stretch, so a mandatory +4 there
// carries the plane straight into the home lane.
//
// The gas-station trigger sits at relative n=18 for every color
// (verified against the user's original absolute-cell description):
// instead of auto-advancing, the player chooses between the shortcut
// (fly to relative n=30, capturing anything on the relative n=16
// flyover cell and the n=30 landing cell, then auto-advance 4 more)
// or declining (just the normal +4, landing on relative n=22).

const COLORS = ['orange', 'green', 'red', 'blue'];
const LAUNCH_INDEX = { green: 0, red: 13, blue: 26, orange: 39 };
const SAFE_SQUARES = new Set(Object.values(LAUNCH_INDEX));
const PLANES_PER_PLAYER = 4;
const RING_SIZE = 52;

const RING_SPAN = 50; // relative n range on the shared ring: 1..RING_SPAN
const HOME_SPAN = 6; // relative n range in the home stretch: RING_SPAN+1..RING_SPAN+HOME_SPAN
const FINISHED_N = RING_SPAN + HOME_SPAN; // 56 — the 6th home cell IS the finish

const OWN_COLOR_STEP = 4;
const GAS_TRIGGER_N = 18;
const GAS_FLYOVER_N = 16;
const GAS_DESTINATION_N = 30;

function ringIndex(color, n) {
  return (LAUNCH_INDEX[color] + n - 1 + RING_SIZE) % RING_SIZE;
}

function isOwnColorN(n) {
  return n >= 1 && n <= RING_SPAN && n % 4 === 2;
}

function newPlane() {
  return { n: 0 };
}

function createGame(seats) {
  const players = seats.map((seat, i) => ({
    id: seat.id,
    name: seat.name,
    color: seat.color || COLORS[i],
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
      legal.push(i); // any roll launches from the ready pad
    } else if (plane.n < FINISHED_N) {
      legal.push(i); // any roll is legal — overshoot bounces back within the home stretch
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
      if (op.n >= 1 && op.n <= RING_SPAN && ringIndex(other.color, op.n) === ringIdx) {
        op.n = 0;
        captured = true;
      }
    }
  }
  return captured;
}

// Resolve landing on `n` for a plane already known to be entering ring
// space (1..RING_SPAN). Applies the mandatory own-color +4 once (which
// may carry the plane past RING_SPAN into the home stretch), then checks
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

  if (plane.n === FINISHED_N) {
    justFinishedPlane = true;
    pushLog(game, `${player.name}'s plane landed home!`);
  } else if (plane.n >= 1 && plane.n <= RING_SPAN) {
    const idx = ringIndex(player.color, plane.n);
    captured = captureAt(game, player, idx);
    if (captured) pushLog(game, `${player.name} sent an opponent plane back to the hangar!`);
  }

  const allHome = player.planes.every((p) => p.n === FINISHED_N);
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
    targetN = dice; // ready pad -> ring entry, `dice` cells past the entry point
  } else {
    targetN = plane.n + dice;
  }

  if (targetN === -1) {
    plane.n = -1;
    pushLog(game, `${player.name}'s plane is ready for takeoff.`);
    return finishTurn(game, dice, false, false);
  }

  if (targetN < 1 || targetN > RING_SPAN) {
    // entering/advancing within home stretch or landing exactly home;
    // no own-color/gas-station rules apply off the shared ring
    if (targetN > FINISHED_N) {
      targetN = 2 * FINISHED_N - targetN; // overshoot bounces back within the home stretch
    }
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

  let justFinishedPlane = false;
  if (plane.n === FINISHED_N) {
    justFinishedPlane = true;
  } else if (plane.n >= 1 && plane.n <= RING_SPAN) {
    const idx = ringIndex(player.color, plane.n);
    if (captureAt(game, player, idx)) captured = true;
  }

  const allHome = player.planes.every((p) => p.n === FINISHED_N);
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
    let resultN = plane.n === 0 ? -1 : plane.n === -1 ? dice : plane.n + dice;
    if (resultN > FINISHED_N) resultN = 2 * FINISHED_N - resultN; // overshoot bounce

    if (resultN === FINISHED_N) score += 100;

    if (resultN >= 1 && resultN <= RING_SPAN) {
      const idx = ringIndex(player.color, resultN);
      if (!SAFE_SQUARES.has(idx)) {
        for (const other of game.players) {
          if (other === player) continue;
          for (const op of other.planes) {
            if (op.n >= 1 && op.n <= RING_SPAN && ringIndex(other.color, op.n) === idx) {
              score += 50;
            }
          }
        }
      }
    }

    if (plane.n === 0 && dice === 6) score += 20;
    score += (resultN > RING_SPAN ? RING_SPAN : Math.max(resultN, 0)) * 0.2;

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
  RING_SPAN,
  HOME_SPAN,
  FINISHED_N,
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
