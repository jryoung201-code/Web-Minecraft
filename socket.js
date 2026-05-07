/**
 * Minecraft EasyProxi — Socket.IO + WebRTC Signaling
 */

// ─── In-memory state ──────────────────────────────────────────────────────────
const connectedClients = new Map();   // socketId → { userId, sessionId, room }
const rooms = new Map();              // sessionId → { host, peers }
const queueList = [];                 // { socketId, joinedAt, config }
let totalConnected = 0;

// ─── Queue processor ─────────────────────────────────────────────────────────
function processQueue(io) {
  if (queueList.length === 0) return;

  const MAX_CONCURRENT = 50; // mock capacity
  if (totalConnected >= MAX_CONCURRENT) return;

  const next = queueList.shift();
  if (!next) return;

  const socket = io.sockets.sockets.get(next.socketId);
  if (!socket) return; // client disconnected while in queue

  socket.emit('queue:ready', {
    sessionId: next.sessionId,
    node: pickBestNode(),
    message: 'Server ready! Connecting...',
  });
}

function pickBestNode() {
  const nodes = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-sea-1'];
  return nodes[Math.floor(Math.random() * nodes.length)];
}

// ─── Stats broadcaster ────────────────────────────────────────────────────────
function startStatsBroadcast(io) {
  setInterval(() => {
    const totalPlayers = 1800 + Math.floor(Math.random() * 300);
    io.emit('platform:stats', {
      totalPlayers,
      onlineNodes: 7,
      totalNodes: 8,
      timestamp: Date.now(),
    });
  }, 5000);
}

// ─── Per-session stream stats simulator ──────────────────────────────────────
function startStreamStats(socket) {
  const interval = setInterval(() => {
    if (!socket.connected) { clearInterval(interval); return; }
    socket.emit('stream:stats', {
      fps: 55 + Math.floor(Math.random() * 10),
      ping: 18 + Math.floor(Math.random() * 20),
      bandwidth: +(12 + Math.random() * 8).toFixed(1),
      packetLoss: +(Math.random() * 0.5).toFixed(2),
      jitter: +(Math.random() * 3).toFixed(1),
      resolution: '1920x1080',
      codec: 'H.264',
    });
  }, 1000);
  socket.streamStatsInterval = interval;
}

// ─── Queue position broadcaster ───────────────────────────────────────────────
function broadcastQueuePositions(io) {
  queueList.forEach((entry, index) => {
    const socket = io.sockets.sockets.get(entry.socketId);
    if (socket) {
      socket.emit('queue:position', {
        position: index + 1,
        total: queueList.length,
        eta: (index + 1) * 28,
      });
    }
  });
}

// ─── Main socket init ─────────────────────────────────────────────────────────
function initSocket(io) {

  io.on('connection', (socket) => {
    totalConnected++;
    console.log(`[Socket] Client connected: ${socket.id} (total: ${totalConnected})`);

    // Send welcome
    socket.emit('welcome', {
      socketId: socket.id,
      serverTime: new Date().toISOString(),
      message: 'Connected to Minecraft EasyProxi',
    });

    // ── Auth ────────────────────────────────────────────────────────────────
    socket.on('auth', ({ token, userId }) => {
      connectedClients.set(socket.id, { userId, token, sessionId: null });
      socket.emit('auth:ok', { userId, message: 'Authenticated' });
      console.log(`[Auth] ${socket.id} authenticated as ${userId}`);
    });

    // ── Queue join ──────────────────────────────────────────────────────────
    socket.on('queue:join', ({ config }) => {
      const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const position = queueList.length + 1;

      queueList.push({
        socketId: socket.id,
        sessionId,
        joinedAt: Date.now(),
        config: config || {},
      });

      socket.emit('queue:joined', {
        position,
        sessionId,
        eta: position * 28,
        total: queueList.length,
      });

      console.log(`[Queue] ${socket.id} joined at position ${position}`);
      broadcastQueuePositions(io);

      // Simulate fast queue drain for demo
      setTimeout(() => {
        const idx = queueList.findIndex(q => q.socketId === socket.id);
        if (idx !== -1) {
          queueList.splice(idx, 1);
          socket.emit('queue:ready', {
            sessionId,
            node: pickBestNode(),
            message: 'Your session is ready!',
          });
          broadcastQueuePositions(io);
        }
      }, position * 2500);
    });

    // ── Queue leave ─────────────────────────────────────────────────────────
    socket.on('queue:leave', () => {
      const idx = queueList.findIndex(q => q.socketId === socket.id);
      if (idx !== -1) {
        queueList.splice(idx, 1);
        broadcastQueuePositions(io);
        socket.emit('queue:left', { message: 'Left the queue' });
      }
    });

    // ── Session start ───────────────────────────────────────────────────────
    socket.on('session:start', ({ sessionId, config }) => {
      const client = connectedClients.get(socket.id) || {};
      client.sessionId = sessionId;
      connectedClients.set(socket.id, client);

      socket.join(`session:${sessionId}`);

      // Simulate connection steps
      const steps = [
        { step: 1, message: 'Finding available node...', delay: 300 },
        { step: 2, message: 'Allocating cloud GPU...', delay: 900 },
        { step: 3, message: `Starting Minecraft ${config?.version || '1.21.1'}...`, delay: 2000 },
        { step: 4, message: 'Establishing WebRTC stream...', delay: 3500 },
        { step: 5, message: 'Loading world...', delay: 5000 },
      ];

      steps.forEach(({ step, message, delay }) => {
        setTimeout(() => {
          socket.emit('session:step', { step, message, total: 5 });
        }, delay);
      });

      setTimeout(() => {
        socket.emit('session:ready', {
          sessionId,
          node: pickBestNode(),
          region: config?.region || 'us-east-1',
          version: config?.version || '1.21.1',
          modpack: config?.modpack || 'vanilla',
          resolution: config?.resolution || '1080p',
          startedAt: new Date().toISOString(),
        });
        startStreamStats(socket);
      }, 6000);

      console.log(`[Session] ${socket.id} started session ${sessionId}`);
    });

    // ── Session end ─────────────────────────────────────────────────────────
    socket.on('session:end', ({ sessionId }) => {
      if (socket.streamStatsInterval) {
        clearInterval(socket.streamStatsInterval);
      }
      socket.leave(`session:${sessionId}`);
      socket.emit('session:ended', { sessionId, message: 'Session ended successfully' });
      console.log(`[Session] ${socket.id} ended session ${sessionId}`);
    });

    // ── WebRTC Signaling ────────────────────────────────────────────────────
    socket.on('webrtc:offer', ({ targetId, sdp, sessionId }) => {
      console.log(`[WebRTC] Offer from ${socket.id} to ${targetId}`);
      io.to(targetId).emit('webrtc:offer', {
        fromId: socket.id,
        sdp,
        sessionId,
      });
    });

    socket.on('webrtc:answer', ({ targetId, sdp, sessionId }) => {
      console.log(`[WebRTC] Answer from ${socket.id} to ${targetId}`);
      io.to(targetId).emit('webrtc:answer', {
        fromId: socket.id,
        sdp,
        sessionId,
      });
    });

    socket.on('webrtc:ice-candidate', ({ targetId, candidate, sessionId }) => {
      io.to(targetId).emit('webrtc:ice-candidate', {
        fromId: socket.id,
        candidate,
        sessionId,
      });
    });

    socket.on('webrtc:peer-ready', ({ sessionId }) => {
      socket.to(`session:${sessionId}`).emit('webrtc:peer-joined', {
        peerId: socket.id,
      });
    });

    // ── Input forwarding (keyboard/mouse to game server) ────────────────────
    socket.on('input:key', ({ key, type, sessionId }) => {
      // Forward to game server node (in real impl, send to game container)
      socket.to(`session:${sessionId}`).emit('input:key', { key, type });
    });

    socket.on('input:mouse', ({ x, y, button, type, sessionId }) => {
      socket.to(`session:${sessionId}`).emit('input:mouse', { x, y, button, type });
    });

    socket.on('input:mousemove', ({ dx, dy, sessionId }) => {
      socket.to(`session:${sessionId}`).emit('input:mousemove', { dx, dy });
    });

    // ── Chat / notifications ────────────────────────────────────────────────
    socket.on('chat:message', ({ message, sessionId }) => {
      const client = connectedClients.get(socket.id);
      io.to(`session:${sessionId}`).emit('chat:message', {
        from: client?.userId || 'Anonymous',
        message,
        timestamp: Date.now(),
      });
    });

    // ── Ping/pong latency measurement ───────────────────────────────────────
    socket.on('client:ping', ({ timestamp }) => {
      socket.emit('client:pong', { timestamp, serverTime: Date.now() });
    });

    // ── Settings sync ────────────────────────────────────────────────────────
    socket.on('settings:save', ({ settings }) => {
      const client = connectedClients.get(socket.id) || {};
      client.settings = settings;
      connectedClients.set(socket.id, client);
      socket.emit('settings:saved', { ok: true });
    });

    socket.on('settings:get', () => {
      const client = connectedClients.get(socket.id) || {};
      socket.emit('settings:data', { settings: client.settings || {} });
    });

    // ── Reconnect ───────────────────────────────────────────────────────────
    socket.on('session:reconnect', ({ sessionId }) => {
      console.log(`[Session] ${socket.id} reconnecting to ${sessionId}`);
      socket.join(`session:${sessionId}`);
      socket.emit('session:reconnected', {
        sessionId,
        message: 'Reconnected to session',
      });
      setTimeout(() => startStreamStats(socket), 1000);
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      totalConnected = Math.max(0, totalConnected - 1);
      console.log(`[Socket] Client disconnected: ${socket.id} (reason: ${reason})`);

      // Clean up stream stats
      if (socket.streamStatsInterval) {
        clearInterval(socket.streamStatsInterval);
      }

      // Remove from queue
      const qIdx = queueList.findIndex(q => q.socketId === socket.id);
      if (qIdx !== -1) {
        queueList.splice(qIdx, 1);
        broadcastQueuePositions(io);
      }

      connectedClients.delete(socket.id);
    });

    // ── Error handling ──────────────────────────────────────────────────────
    socket.on('error', (err) => {
      console.error(`[Socket Error] ${socket.id}:`, err.message);
    });
  });

  // ─── Global event: broadcast platform stats ───────────────────────────────
  startStatsBroadcast(io);

  // ─── Queue processor loop ─────────────────────────────────────────────────
  setInterval(() => processQueue(io), 3000);

  console.log('[Socket.IO] WebRTC signaling + queue system initialized');
}

module.exports = { initSocket };
