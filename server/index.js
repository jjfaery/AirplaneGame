'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Formspree configuration for bug reports
const formspreeFormId = process.env.FORMSPREE_FORM_ID || 'xbgrpqzb';

async function sendBugReportEmail(bugReport) {
  try {
    const response = await fetch(`https://formspree.io/f/${formspreeFormId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: bugReport.description,
        roomCode: bugReport.roomCode || 'N/A',
        timestamp: bugReport.timestamp,
        gameState: bugReport.gameState ? JSON.stringify(bugReport.gameState, null, 2) : 'N/A',
      }),
    });
    if (response.ok) {
      console.log('Bug report sent to email successfully');
    } else {
      console.error('Failed to send bug report:', response.statusText);
    }
  } catch (err) {
    console.error('Failed to send bug report email:', err.message);
  }
}

// Bug report endpoint
app.post('/api/bug-report', async (req, res) => {
  const { description, roomCode, gameState, timestamp } = req.body;
  if (!description) {
    return res.status(400).json({ error: 'Description required' });
  }

  const bugReport = {
    timestamp,
    roomCode,
    gameState,
    description,
  };

  const bugLogPath = path.join(__dirname, '..', 'bug-reports.json');
  try {
    let reports = [];
    try {
      if (fs.existsSync(bugLogPath)) {
        const data = fs.readFileSync(bugLogPath, 'utf8');
        reports = JSON.parse(data);
      }
    } catch (e) {
      reports = [];
    }
    reports.push(bugReport);
    fs.writeFileSync(bugLogPath, JSON.stringify(reports, null, 2), 'utf8');
    console.log(`Bug report saved: ${description.slice(0, 50)}`);

    // Send email asynchronously (don't block response)
    sendBugReportEmail(bugReport);

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save bug report:', err);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, humanTarget, color } = {}, cb) => {
    try {
      const room = rooms.createRoom(socket, String(name || '').slice(0, 20), Number(humanTarget) || 1, color);
      cb && cb({ ok: true, code: room.code, view: rooms.roomView(room) });
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('room:join', ({ code, name } = {}, cb) => {
    const result = rooms.joinRoom(socket, code, String(name || '').slice(0, 20));
    if (result.error) return cb && cb({ ok: false, error: result.error });
    rooms.broadcastRoom(result.room);
    cb && cb({ ok: true, code: result.room.code, view: rooms.roomView(result.room) });
  });

  socket.on('room:chooseColor', ({ code, color } = {}, cb) => {
    const result = rooms.chooseColor(socket, code, color);
    if (result.error) return cb && cb({ ok: false, error: result.error });
    rooms.broadcastRoom(result.room);
    cb && cb({ ok: true });
  });

  socket.on('room:start', ({ code } = {}, cb) => {
    const result = rooms.startGame(socket, code);
    if (result.error) return cb && cb({ ok: false, error: result.error });
    rooms.broadcastGame(result.room);
    cb && cb({ ok: true });
  });

  socket.on('game:roll', ({ code } = {}, cb) => {
    const result = rooms.roll(socket, code);
    if (result.error) return cb && cb({ ok: false, error: result.error });
    rooms.broadcastGame(result.room);
    cb && cb({ ok: true });
  });

  socket.on('game:move', ({ code, planeIndex } = {}, cb) => {
    const result = rooms.move(socket, code, planeIndex);
    if (result.error) return cb && cb({ ok: false, error: result.error });
    rooms.broadcastGame(result.room);
    cb && cb({ ok: true });
  });

  socket.on('game:gasChoice', ({ code, planeIndex, useShortcut } = {}, cb) => {
    const result = rooms.gasChoice(socket, code, planeIndex, useShortcut);
    if (result.error) return cb && cb({ ok: false, error: result.error });
    rooms.broadcastGame(result.room);
    cb && cb({ ok: true });
  });

  socket.on('room:leave', () => {
    rooms.leave(socket);
  });

  socket.on('disconnect', () => {
    rooms.leave(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Airplane Chess server listening on port ${PORT}`);
});
