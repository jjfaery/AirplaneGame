'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, humanTarget } = {}, cb) => {
    try {
      const room = rooms.createRoom(socket, String(name || '').slice(0, 20), Number(humanTarget) || 1);
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
