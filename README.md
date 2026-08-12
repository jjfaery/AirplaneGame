# ✈️ 飞机棋 — Flying Chess

An online multiplayer Flying Chess (Ludo-style airplane game) with computer
players, built with Node.js, Express, and Socket.IO.

## Features

- **Flexible player counts**: every game seats 4 colors (red/green/blue/yellow);
  choose how many are humans vs. computer players — solo vs. 3 computers,
  2 players vs. 2 computers, 3 players vs. 1 computer, or 4 human players.
- **Rooms with shareable invite links**: creating a multiplayer room gives you
  a link (`/?room=CODE`) you can send to friends to join.
- **Start without waiting**: the host can start the game at any time — any
  seats nobody has joined yet are automatically filled with computer players.
- **Server-authoritative rules engine**: dice rolls, launching, captures,
  bonus turns on 6s/captures, and exact-landing home rules are all validated
  server-side.
- **Computer players**: automatically roll and move, prioritizing captures
  and finishing planes.
- **Disconnect resilience**: if a human disconnects mid-game, the game keeps
  going — their seat is auto-played like a computer player until they return.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:3000.

## Project layout

- `server/game/engine.js` — pure game-rules engine (no networking).
- `server/rooms.js` — room/lobby management, seat assignment, AI turn
  orchestration.
- `server/index.js` — Express + Socket.IO server.
- `public/js/board.js` — board geometry (the 52-cell ring, home stretches,
  hangars) shared conceptually with the server's abstract position model.
- `public/js/renderer.js` — canvas rendering of the board and planes.
- `public/js/app.js` — client app: view routing, socket wiring, UI state.

Room state lives in server memory and resets if the server restarts.
