/**
 * Minecraft EasyProxi — Backend Server
 * Node.js + Express + Socket.IO + WebRTC
 */

// Load .env file if present
try { require('dotenv').config(); } catch(e) {}

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const path    = require('path');

const routes         = require('./routes');
const { initSocket } = require('./socket');

const app    = express();
const server = http.createServer(app);

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST'] },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static frontend ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api', routes);
app.use('/api/modrinth', require('./modrinth'));

// ─── Socket.IO ────────────────────────────────────────────────────────────────
initSocket(io);

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Minecraft EasyProxi Backend v1.0       ║
║   http://localhost:${PORT}                   ║
╚══════════════════════════════════════════╝

API routes:
  GET    /api/health
  GET    /api/status
  GET    /api/nodes
  GET    /api/versions
  POST   /api/login
  POST   /api/register
  GET    /api/session
  POST   /api/session/start
  DELETE /api/session/:id
  POST   /api/session/:id/command
  GET    /api/session/:id/log
  GET    /api/queue
  POST   /api/queue/join
  GET    /api/modrinth/search
  GET    /api/modrinth/project/:slug
  POST   /api/modrinth/download
  GET    /api/modrinth/featured
  GET    /api/servers/active
  `);
});

module.exports = { app, server, io };