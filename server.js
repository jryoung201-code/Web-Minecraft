/**
 * Minecraft EasyProxi — Backend Server
 * Node.js + Express + Socket.IO + WebRTC Signaling
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const routes = require('./routes');
const { initSocket } = require('./socket');

const app = express();
const server = http.createServer(app);

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend (for monorepo deployments)
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── SOCKET.IO INIT ───────────────────────────────────────────────────────────
initSocket(io);

// ─── CATCH ALL → index.html ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Minecraft EasyProxi Backend v1.0       ║
║   http://localhost:${PORT}                   ║
║   minecraft.easyproxi.online             ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = { app, server, io };
