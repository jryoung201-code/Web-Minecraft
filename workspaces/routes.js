/**
 * Minecraft EasyProxi — API Routes
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// ─── In-memory session store (replace with Redis/DB in production) ────────────
const sessions = new Map();
const users = new Map();
const queue = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getServerNodes() {
  return [
    { id: 'us-east-1', name: 'US East · NYC', region: 'us-east-1', gpu: 'RTX 4080',
      players: 312 + Math.floor(Math.random() * 40 - 20),
      max: 400, ping: 18 + Math.floor(Math.random() * 6), status: 'online' },
    { id: 'us-west-2', name: 'US West · LA',  region: 'us-west-2', gpu: 'RTX 4080',
      players: 245 + Math.floor(Math.random() * 30 - 15),
      max: 400, ping: 22 + Math.floor(Math.random() * 6), status: 'online' },
    { id: 'eu-west-1', name: 'EU West · AMS', region: 'eu-west-1', gpu: 'RTX 4090',
      players: 388 + Math.floor(Math.random() * 12 - 6),
      max: 400, ping: 31 + Math.floor(Math.random() * 6), status: 'busy' },
    { id: 'eu-central-1', name: 'EU Central · FRA', region: 'eu-central-1', gpu: 'RTX 4080',
      players: 260 + Math.floor(Math.random() * 30 - 15),
      max: 400, ping: 28 + Math.floor(Math.random() * 6), status: 'online' },
    { id: 'ap-sea-1', name: 'AP Singapore',   region: 'ap-sea-1',  gpu: 'A100',
      players: 190 + Math.floor(Math.random() * 20 - 10),
      max: 300, ping: 55 + Math.floor(Math.random() * 8), status: 'online' },
    { id: 'ap-nrt-1', name: 'AP Tokyo',       region: 'ap-nrt-1',  gpu: 'A100',
      players: 140 + Math.floor(Math.random() * 20 - 10),
      max: 300, ping: 62 + Math.floor(Math.random() * 8), status: 'online' },
    { id: 'sa-east-1', name: 'SA São Paulo',  region: 'sa-east-1', gpu: 'RTX 3080',
      players: 80 + Math.floor(Math.random() * 10 - 5),
      max: 200, ping: 74 + Math.floor(Math.random() * 8), status: 'online' },
    { id: 'ap-aus-1', name: 'AU Sydney',      region: 'ap-aus-1',  gpu: 'RTX 3080',
      players: 0, max: 200, ping: 0, status: 'offline' },
  ];
}

// ─── GET /api/status ─────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const nodes = getServerNodes();
  const totalPlayers = nodes.reduce((sum, n) => sum + n.players, 0);
  const onlineNodes = nodes.filter(n => n.status !== 'offline').length;

  res.json({
    ok: true,
    platform: 'Minecraft EasyProxi',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    totalPlayers,
    onlineNodes,
    totalNodes: nodes.length,
    nodes,
    uptime: process.uptime(),
  });
});

// ─── POST /api/login ──────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password required' });
  }

  if (!email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Invalid email' });
  }

  // Mock auth — any valid email/pass combo works
  const userId = `user_${Buffer.from(email).toString('hex').slice(0, 8)}`;
  const token = generateToken();
  const user = {
    id: userId,
    email,
    username: email.split('@')[0],
    plan: 'free',
    createdAt: new Date().toISOString(),
    token,
  };

  users.set(userId, user);

  res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      plan: user.plan,
    },
  });
});

// ─── POST /api/register ───────────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { email, username, password, firstName, lastName } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ ok: false, error: 'All fields required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be 8+ characters' });
  }

  const userId = `user_${Date.now().toString(36)}`;
  const token = generateToken();
  const user = {
    id: userId,
    email,
    username,
    firstName: firstName || '',
    lastName: lastName || '',
    plan: 'free',
    createdAt: new Date().toISOString(),
    token,
  };

  users.set(userId, user);

  res.status(201).json({
    ok: true,
    token,
    user: { id: user.id, email, username, plan: user.plan },
  });
});

// ─── GET /api/session ─────────────────────────────────────────────────────────
router.get('/session', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  // Mock session validation
  const session = sessions.get(token);
  if (session) {
    return res.json({ ok: true, session });
  }

  res.json({ ok: true, session: null });
});

// ─── POST /api/session/start ──────────────────────────────────────────────────
router.post('/session/start', (req, res) => {
  const { version, modpack, region, resolution } = req.body;
  const token = req.headers.authorization?.replace('Bearer ', '');

  const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const session = {
    id: sessionId,
    version: version || '1.21.1',
    modpack: modpack || 'vanilla',
    region: region || 'us-east-1',
    resolution: resolution || '1080p',
    startedAt: new Date().toISOString(),
    status: 'connecting',
    node: 'us-east-1',
    fps: 0,
    ping: 0,
  };

  sessions.set(sessionId, session);

  // Simulate queue check
  const queueLength = Math.floor(Math.random() * 5);
  if (queueLength > 0) {
    queue.push({ sessionId, position: queueLength });
    return res.json({
      ok: true,
      queued: true,
      position: queueLength,
      eta: queueLength * 30,
      sessionId,
    });
  }

  res.json({
    ok: true,
    queued: false,
    session,
    webrtcSignal: {
      type: 'offer',
      sdp: 'mock_sdp_' + sessionId,
    },
  });
});

// ─── DELETE /api/session/:id ──────────────────────────────────────────────────
router.delete('/session/:id', (req, res) => {
  const { id } = req.params;
  sessions.delete(id);
  res.json({ ok: true, message: 'Session ended' });
});

// ─── GET /api/queue ───────────────────────────────────────────────────────────
router.get('/queue', (req, res) => {
  res.json({
    ok: true,
    queueLength: queue.length,
    estimatedWait: queue.length * 30,
    queue: queue.map((q, i) => ({ position: i + 1, sessionId: q.sessionId })),
  });
});

// ─── POST /api/queue/join ─────────────────────────────────────────────────────
router.post('/queue/join', (req, res) => {
  const { sessionId } = req.body;
  const position = queue.length + 1;
  queue.push({ sessionId, joinedAt: new Date().toISOString() });

  res.json({
    ok: true,
    position,
    eta: position * 30,
    sessionId,
  });
});

// ─── GET /api/nodes ───────────────────────────────────────────────────────────
router.get('/nodes', (req, res) => {
  res.json({ ok: true, nodes: getServerNodes() });
});

// ─── GET /api/versions ────────────────────────────────────────────────────────
router.get('/versions', (req, res) => {
  res.json({
    ok: true,
    versions: [
      { id: '1.21.1', label: 'Latest', tag: '1.21.1' },
      { id: '1.20.4', label: 'Stable', tag: '1.20.4' },
      { id: '1.19.4', label: 'Legacy', tag: '1.19.4' },
      { id: '1.16.5', label: 'Classic', tag: '1.16.5' },
    ],
    modpacks: [
      { id: 'vanilla', label: 'Vanilla', desc: 'Clean unmodded Minecraft' },
      { id: 'optifine', label: 'Optifine', desc: 'HD textures & shaders' },
      { id: 'fabric', label: 'Fabric', desc: 'QoL mods bundle' },
      { id: 'forge', label: 'Forge', desc: 'Full mod support' },
    ],
  });
});

// ─── GET /api/health ─────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ ok: true, status: 'healthy', uptime: process.uptime() });
});

module.exports = router;
