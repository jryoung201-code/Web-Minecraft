/**
 * Minecraft EasyProxi — Socket.IO Server
 * Handles WebRTC signaling, queue management, and
 * real-time Minecraft server log streaming.
 */

let launcher;
try {
  launcher = require('../streaming/minecraft-launcher');
} catch (e) {
  launcher = null;
}

// ─── State ────────────────────────────────────────────────────────────────────
const connectedClients = new Map();  // socketId → { userId, sessionId }
const queueList        = [];
let   totalConnected   = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pickBestNode() {
  const nodes = ['us-east-1','us-west-2','eu-west-1','eu-central-1','ap-sea-1'];
  return nodes[Math.floor(Math.random() * nodes.length)];
}

function broadcastQueuePositions(io) {
  queueList.forEach((entry, idx) => {
    const sock = io.sockets.sockets.get(entry.socketId);
    if (sock) sock.emit('queue:position', { position:idx+1, total:queueList.length, eta:(idx+1)*28 });
  });
}

function startStatsBroadcast(io) {
  setInterval(() => {
    io.emit('platform:stats', {
      totalPlayers: 1800 + Math.floor(Math.random() * 300),
      onlineNodes:  7,
      totalNodes:   8,
      timestamp:    Date.now(),
      activeServers: launcher ? launcher.getActiveServers().length : 0,
    });
  }, 5000);
}

// Per-session simulated FPS/ping stream (used when no real video stream yet)
function startSimulatedStats(socket) {
  const iv = setInterval(() => {
    if (!socket.connected) { clearInterval(iv); return; }
    socket.emit('stream:stats', {
      fps:        55 + Math.floor(Math.random() * 10),
      ping:       18 + Math.floor(Math.random() * 22),
      bandwidth:  +(11 + Math.random() * 9).toFixed(1),
      packetLoss: +(Math.random() * 0.3).toFixed(2),
      jitter:     +(Math.random() * 2).toFixed(1),
      resolution: '1920x1080',
      codec:      'H.264',
    });
  }, 1000);
  socket.simulatedStatsInterval = iv;
}

// ─── Real Minecraft launch via Socket.IO ─────────────────────────────────────
// Starts Minecraft and pipes every log line back to the client socket in real-time
async function launchMinecraftForSocket(socket, sessionId, config) {
  if (!launcher) {
    // Mock mode — simulate steps
    simulateLaunchSteps(socket, sessionId, config);
    return;
  }

  const { version='1.20.4', modpack='vanilla', gamemode='survival', renderDistance=10, ram='2G', seed='' } = config;

  socket.emit('session:step', { step:1, message:`Allocating cloud GPU node...`, total:6 });

  try {
    await launcher.startMinecraftServer(sessionId, { version, modpack, gamemode, renderDistance, ram, seed }, {
      onLog: (text, cls) => {
        // Stream every MC log line to the browser in real-time
        socket.emit('mc:log', { text, cls, ts: Date.now() });

        // Detect step milestones from real MC output
        if (text.includes('Loading properties'))     socket.emit('session:step', { step:2, message:`Downloading server-${version}.jar...`,  total:6 });
        if (text.includes('Generating keypair'))     socket.emit('session:step', { step:3, message:`Launching JVM (Java 21, ${ram} heap)...`, total:6 });
        if (text.includes('Preparing level'))        socket.emit('session:step', { step:4, message:`Generating world (${gamemode})...`,       total:6 });
        if (text.includes('Preparing spawn area'))   socket.emit('session:step', { step:5, message:`Establishing WebRTC peer connection...`, total:6 });
        if (text.includes('Done') && text.includes('For help')) {
          socket.emit('session:step', { step:6, message:`Streaming to your browser...`, total:6 });
        }
      },
      onReady: (info) => {
        socket.emit('session:ready', {
          sessionId,
          node:       pickBestNode(),
          version,
          modpack,
          gamemode,
          resolution: config.resolution || '1080p',
          port:       info.port,
          pid:        info.pid,
          startedAt:  new Date().toISOString(),
        });
        startSimulatedStats(socket); // replace with real WebRTC stats when stream is live
      },
      onError: (err) => {
        socket.emit('session:error', { sessionId, error: err });
        socket.emit('mc:log', { text:`[EasyProxi ERROR] ${err}`, cls:'error', ts:Date.now() });
      },
      onExit: ({ code }) => {
        socket.emit('session:ended', { sessionId, exitCode: code });
      },
    });
  } catch (err) {
    socket.emit('session:error', { sessionId, error: err.message });
  }
}

// Mock launch simulation (when launcher is unavailable)
function simulateLaunchSteps(socket, sessionId, config) {
  const { version='1.20.4', modpack='vanilla', gamemode='survival' } = config;

  const steps = [
    { step:1, message:'Allocating cloud GPU node (us-east-1)...',      delay:300  },
    { step:2, message:`Fetching minecraft_server.${version}.jar...`,    delay:1100 },
    { step:3, message:'Launching JVM (Java 21, 2G heap)...',            delay:2500 },
    { step:4, message:`Generating world (${gamemode})...`,               delay:3700 },
    { step:5, message:'Establishing WebRTC peer connection...',          delay:5300 },
    { step:6, message:'Streaming to your browser...',                    delay:6600 },
  ];

  const mockLogs = [
    { text:`[Server thread/INFO]: Starting minecraft server version ${version}`, cls:'info', delay:400  },
    { text:`[Server thread/INFO]: Loading properties`,                            cls:'info', delay:700  },
    { text:`[Server thread/INFO]: Default game type: ${gamemode.toUpperCase()}`, cls:'info', delay:1000 },
    { text:`[Server thread/INFO]: Generating keypair`,                            cls:'info', delay:1300 },
    { text:`[Server thread/INFO]: Starting Minecraft server on *:25565`,          cls:'info', delay:1700 },
    ...(modpack !== 'vanilla' ? [
      { text:`[FML]: Loading mods for ${modpack}...`,                             cls:'info', delay:2100 },
    ] : []),
    { text:`[Server thread/INFO]: Preparing level "world"`,                       cls:'info', delay:2800 },
    { text:`[Server thread/INFO]: Preparing spawn area: 0%`,                      cls:'info', delay:3200 },
    { text:`[Server thread/INFO]: Preparing spawn area: 47%`,                     cls:'info', delay:4000 },
    { text:`[Server thread/INFO]: Preparing spawn area: 89%`,                     cls:'info', delay:4700 },
    { text:`[Server thread/INFO]: Done (4.847s)! For help, type "help"`,          cls:'done', delay:5300 },
    { text:`[EasyProxi]: WebRTC bridge connected — streaming at 1080p@60fps`,     cls:'done', delay:5800 },
  ];

  steps.forEach(({ step, message, delay }) => {
    setTimeout(() => socket.emit('session:step', { step, message, total:6 }), delay);
  });

  mockLogs.forEach(({ text, cls, delay }) => {
    setTimeout(() => socket.emit('mc:log', { text, cls, ts:Date.now() }), delay);
  });

  setTimeout(() => {
    socket.emit('session:ready', {
      sessionId,
      node:      pickBestNode(),
      version,
      modpack,
      gamemode,
      resolution: config.resolution || '1080p',
      startedAt:  new Date().toISOString(),
      mock:       true,
    });
    startSimulatedStats(socket);
  }, 7200);
}

// ─── Main Socket.IO init ──────────────────────────────────────────────────────
function initSocket(io) {

  io.on('connection', (socket) => {
    totalConnected++;
    console.log(`[Socket] Connected: ${socket.id} (total: ${totalConnected})`);

    socket.emit('welcome', { socketId:socket.id, serverTime:new Date().toISOString(), launcherReady:!!launcher });

    // ── Auth ─────────────────────────────────────────────────────────────────
    socket.on('auth', ({ token, userId }) => {
      connectedClients.set(socket.id, { userId, token, sessionId:null });
      socket.emit('auth:ok', { userId });
    });

    // ── Queue join ────────────────────────────────────────────────────────────
    socket.on('queue:join', ({ config }) => {
      const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
      const position  = queueList.length + 1;
      queueList.push({ socketId:socket.id, sessionId, joinedAt:Date.now(), config });

      socket.emit('queue:joined', { position, sessionId, eta:position*28, total:queueList.length });
      broadcastQueuePositions(io);

      // Drain queue after wait (simulate)
      setTimeout(() => {
        const idx = queueList.findIndex(q => q.socketId === socket.id);
        if (idx !== -1) {
          queueList.splice(idx, 1);
          socket.emit('queue:ready', { sessionId, node:pickBestNode() });
          broadcastQueuePositions(io);
        }
      }, position * 2500);
    });

    socket.on('queue:leave', () => {
      const idx = queueList.findIndex(q => q.socketId === socket.id);
      if (idx !== -1) { queueList.splice(idx, 1); broadcastQueuePositions(io); }
      socket.emit('queue:left', {});
    });

    // ── Session start — triggers real Minecraft launch ────────────────────────
    socket.on('session:start', ({ sessionId, config }) => {
      const client = connectedClients.get(socket.id) || {};
      client.sessionId = sessionId;
      connectedClients.set(socket.id, client);
      socket.join(`session:${sessionId}`);

      console.log(`[Session] Starting Minecraft ${config?.version||'1.20.4'} for session ${sessionId}`);
      launchMinecraftForSocket(socket, sessionId, config || {});
    });

    // ── Session end ───────────────────────────────────────────────────────────
    socket.on('session:end', async ({ sessionId }) => {
      if (socket.simulatedStatsInterval) clearInterval(socket.simulatedStatsInterval);
      if (launcher) {
        try { await launcher.stopMinecraftServer(sessionId); } catch(e) {}
        try { launcher.cleanupWorldDir(sessionId); } catch(e) {}
      }
      socket.leave(`session:${sessionId}`);
      socket.emit('session:ended', { sessionId });
    });

    // ── Session reconnect ─────────────────────────────────────────────────────
    socket.on('session:reconnect', ({ sessionId }) => {
      socket.join(`session:${sessionId}`);
      socket.emit('session:reconnected', { sessionId });
      startSimulatedStats(socket);
    });

    // ── In-game command (from browser overlay) ────────────────────────────────
    socket.on('mc:command', async ({ sessionId, command }) => {
      if (launcher) {
        const result = await launcher.sendCommand(sessionId, command);
        socket.emit('mc:command:result', result);
      }
    });

    // ── WebRTC Signaling ──────────────────────────────────────────────────────
    socket.on('webrtc:offer', ({ targetId, sdp, sessionId }) => {
      io.to(targetId).emit('webrtc:offer', { fromId:socket.id, sdp, sessionId });
    });
    socket.on('webrtc:answer', ({ targetId, sdp, sessionId }) => {
      io.to(targetId).emit('webrtc:answer', { fromId:socket.id, sdp, sessionId });
    });
    socket.on('webrtc:ice-candidate', ({ targetId, candidate, sessionId }) => {
      io.to(targetId).emit('webrtc:ice-candidate', { fromId:socket.id, candidate, sessionId });
    });

    // ── Input forwarding ──────────────────────────────────────────────────────
    socket.on('input:key',       ({ key, type, sessionId })       => { socket.to(`session:${sessionId}`).emit('input:key',       { key, type }); });
    socket.on('input:mousemove', ({ dx, dy, sessionId })          => { socket.to(`session:${sessionId}`).emit('input:mousemove', { dx, dy }); });
    socket.on('input:mouse',     ({ x, y, button, type, sessionId }) => { socket.to(`session:${sessionId}`).emit('input:mouse',  { x, y, button, type }); });

    // ── Latency measurement ───────────────────────────────────────────────────
    socket.on('client:ping', ({ timestamp }) => {
      socket.emit('client:pong', { timestamp, serverTime:Date.now() });
    });

    // ── Settings sync ─────────────────────────────────────────────────────────
    socket.on('settings:save', ({ settings }) => {
      const client = connectedClients.get(socket.id) || {};
      client.settings = settings;
      connectedClients.set(socket.id, client);
      socket.emit('settings:saved', { ok:true });
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      totalConnected = Math.max(0, totalConnected - 1);
      console.log(`[Socket] Disconnected: ${socket.id} (${reason})`);

      if (socket.simulatedStatsInterval) clearInterval(socket.simulatedStatsInterval);

      // Remove from queue
      const qi = queueList.findIndex(q => q.socketId === socket.id);
      if (qi !== -1) { queueList.splice(qi, 1); broadcastQueuePositions(io); }

      // Stop any running Minecraft server for this client
      const client = connectedClients.get(socket.id);
      if (client?.sessionId && launcher) {
        try { await launcher.stopMinecraftServer(client.sessionId); } catch(e){}
        try { launcher.cleanupWorldDir(client.sessionId); } catch(e){}
      }

      connectedClients.delete(socket.id);
    });

    socket.on('error', err => console.error(`[Socket Error] ${socket.id}:`, err.message));
  });

  startStatsBroadcast(io);
  setInterval(() => {
    // Process queue drain
    if (queueList.length === 0) return;
    const next = queueList.shift();
    if (!next) return;
    const sock = io.sockets.sockets.get(next.socketId);
    if (sock) sock.emit('queue:ready', { sessionId:next.sessionId, node:pickBestNode() });
    broadcastQueuePositions(io);
  }, 4000);

  console.log('[Socket.IO] Minecraft launcher + WebRTC signaling initialized');
}

module.exports = { initSocket };
