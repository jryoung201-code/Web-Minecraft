/**
 * Minecraft EasyProxi — API Routes (with real MC 1.20.4 launcher)
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');

// Import the real Minecraft launcher
let launcher;
try {
  launcher = require('../streaming/minecraft-launcher');
  console.log('[Routes] Minecraft launcher loaded ✓');
} catch (e) {
  console.warn('[Routes] minecraft-launcher unavailable, running in mock mode');
  launcher = null;
}

// ─── In-memory stores ────────────────────────────────────────────────────────
const sessions = new Map();
const users    = new Map();
const queue    = [];

const generateToken = () => crypto.randomBytes(32).toString('hex');
const generateId    = prefix => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
const rand          = n => Math.floor(Math.random() * n);

// ─── GET /api/health ─────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  const javaOk = launcher ? launcher.checkJava(8).ok : false;
  res.json({
    ok: true,
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    launcherReady: !!launcher,
    javaAvailable: javaOk,
    activeServers: launcher ? launcher.getActiveServers().length : 0,
    activeSessions: sessions.size,
  });
});

// ─── GET /api/status ─────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const nodes = getServerNodes();
  res.json({
    ok: true,
    platform: 'Minecraft EasyProxi',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    totalPlayers: nodes.reduce((s, n) => s + n.players, 0),
    onlineNodes: nodes.filter(n => n.status !== 'offline').length,
    totalNodes: nodes.length,
    nodes,
    uptime: process.uptime(),
    launcherReady: !!launcher,
  });
});

function getServerNodes() {
  return [
    { id:'us-east-1',    name:'US East · NYC',    region:'us-east-1',    gpu:'RTX 4080', players:312+rand(40), max:400, ping:18+rand(6),  status:'online'  },
    { id:'us-west-2',    name:'US West · LA',     region:'us-west-2',    gpu:'RTX 4080', players:245+rand(30), max:400, ping:22+rand(6),  status:'online'  },
    { id:'eu-west-1',    name:'EU West · AMS',    region:'eu-west-1',    gpu:'RTX 4090', players:388+rand(12), max:400, ping:31+rand(6),  status:'busy'    },
    { id:'eu-central-1', name:'EU Central · FRA', region:'eu-central-1', gpu:'RTX 4080', players:260+rand(30), max:400, ping:28+rand(6),  status:'online'  },
    { id:'ap-sea-1',     name:'AP Singapore',     region:'ap-sea-1',     gpu:'A100',     players:190+rand(20), max:300, ping:55+rand(8),  status:'online'  },
    { id:'ap-nrt-1',     name:'AP Tokyo',         region:'ap-nrt-1',     gpu:'A100',     players:140+rand(20), max:300, ping:62+rand(8),  status:'online'  },
    { id:'sa-east-1',    name:'SA São Paulo',     region:'sa-east-1',    gpu:'RTX 3080', players:80+rand(10),  max:200, ping:74+rand(8),  status:'online'  },
    { id:'ap-aus-1',     name:'AU Sydney',        region:'ap-aus-1',     gpu:'RTX 3080', players:0,            max:200, ping:0,           status:'offline' },
  ];
}

// ─── POST /api/login ─────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok:false, error:'Email and password required' });
  if (!email.includes('@')) return res.status(400).json({ ok:false, error:'Invalid email' });

  const userId = `user_${Buffer.from(email).toString('hex').slice(0,8)}`;
  const token  = generateToken();
  const user   = { id:userId, email, username:email.split('@')[0], plan:'free', token };
  users.set(userId, user);
  res.json({ ok:true, token, user:{ id:user.id, email, username:user.username, plan:user.plan } });
});

// ─── POST /api/register ──────────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.status(400).json({ ok:false, error:'All fields required' });
  if (password.length < 8)             return res.status(400).json({ ok:false, error:'Password must be 8+ chars' });

  const userId = generateId('user');
  const token  = generateToken();
  users.set(userId, { id:userId, email, username, plan:'free', token });
  res.status(201).json({ ok:true, token, user:{ id:userId, email, username, plan:'free' } });
});

// ─── GET /api/session ────────────────────────────────────────────────────────
router.get('/session', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok:false, error:'Unauthorized' });
  res.json({ ok:true, session:null });
});

// ─── GET /api/session/:id ────────────────────────────────────────────────────
router.get('/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ ok:false, error:'Session not found' });

  const liveList = launcher ? launcher.getActiveServers() : [];
  const live     = liveList.find(s => s.sessionId === req.params.id);
  res.json({ ok:true, session:{ ...session, uptime:live?.uptime || 0, live:!!live } });
});

// ─── POST /api/session/start — Launch Minecraft ───────────────────────────────
router.post('/session/start', async (req, res) => {
  const {
    version       = '1.20.4',
    modpack       = 'vanilla',
    region        = 'auto',
    resolution    = '1080p',
    gamemode      = 'survival',
    renderDistance = 10,
    ram           = '2G',
    seed          = '',
  } = req.body;

  // Queue check
  if (queue.length >= 5) {
    const sessionId = generateId('sess');
    queue.push({ sessionId, joinedAt: Date.now() });
    return res.json({ ok:true, queued:true, position:queue.length, eta:queue.length*30, sessionId });
  }

  const sessionId = generateId('sess');
  const session   = {
    id:         sessionId,
    version,
    modpack,
    region,
    resolution,
    gamemode,
    renderDistance,
    ram,
    seed,
    startedAt:  new Date().toISOString(),
    status:     'starting',
    pid:        null,
    port:       null,
  };
  sessions.set(sessionId, session);

  if (launcher) {
    // Start real Minecraft in background — logs stream via Socket.IO
    launcher.startMinecraftServer(sessionId, { version, modpack, gamemode, renderDistance, ram, seed }, {
      onLog:   (msg, cls) => console.log(`[MC:${sessionId.slice(-6)}] ${msg}`),
      onReady: (info)     => { session.status='running'; session.pid=info.pid; session.port=info.port; sessions.set(sessionId, session); },
      onError: (err)      => { session.status='failed';  session.error=err;    sessions.set(sessionId, session); },
      onExit:  ()         => { sessions.delete(sessionId); },
    }).catch(err => console.error('[MC Launch error]', err.message));
  } else {
    // Mock mode
    setTimeout(() => { if (sessions.has(sessionId)) { session.status='running'; sessions.set(sessionId, session); } }, 7000);
  }

  res.json({
    ok:      true,
    queued:  false,
    sessionId,
    session,
    webrtcSignal: { type:'offer', sdp:`mock_sdp_${sessionId}` },
  });
});

// ─── DELETE /api/session/:id — Stop Minecraft ────────────────────────────────
router.delete('/session/:id', async (req, res) => {
  const { id } = req.params;
  if (launcher) {
    try {
      await launcher.stopMinecraftServer(id);
      launcher.cleanupWorldDir(id);
    } catch (err) {
      console.error('[Stop error]', err.message);
    }
  }
  sessions.delete(id);
  res.json({ ok:true, message:'Session ended and server stopped' });
});

// ─── POST /api/session/:id/command — RCON command ────────────────────────────
router.post('/session/:id/command', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ ok:false, error:'Command required' });

  if (launcher) {
    const result = await launcher.sendCommand(req.params.id, command);
    return res.json(result);
  }
  res.json({ ok:true, mock:true, command });
});

// ─── GET /api/session/:id/log — Tail log file ────────────────────────────────
router.get('/session/:id/log', (req, res) => {
  const logPath = path.join(__dirname, '..', 'minecraft-servers', 'logs', `${req.params.id}.log`);
  if (!fs.existsSync(logPath)) return res.status(404).json({ ok:false, error:'Log not found' });
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-200);
  res.json({ ok:true, lines, sessionId:req.params.id });
});

// ─── GET /api/queue ──────────────────────────────────────────────────────────
router.get('/queue', (req, res) => {
  res.json({ ok:true, queueLength:queue.length, estimatedWait:queue.length*30, queue });
});

// ─── POST /api/queue/join ────────────────────────────────────────────────────
router.post('/queue/join', (req, res) => {
  const sessionId = generateId('sess');
  const position  = queue.length + 1;
  queue.push({ sessionId, joinedAt:new Date().toISOString() });
  res.json({ ok:true, position, eta:position*30, sessionId });
});

// ─── GET /api/nodes ──────────────────────────────────────────────────────────
router.get('/nodes', (req, res) => {
  res.json({ ok:true, nodes:getServerNodes() });
});

// ─── GET /api/versions ───────────────────────────────────────────────────────
router.get('/versions', (req, res) => {
  const { KNOWN_JARS={}, JAVA_REQUIREMENTS={} } = launcher || {};
  res.json({
    ok: true,
    versions: [
      { id:'1.20.4', label:'Latest Stable',        java:JAVA_REQUIREMENTS['1.20.4']||21, badge:'RECOMMENDED' },
      { id:'1.20.2', label:'Trails & Tales',        java:JAVA_REQUIREMENTS['1.20.2']||21, badge:'STABLE'      },
      { id:'1.20.1', label:'Trails & Tales',        java:JAVA_REQUIREMENTS['1.20.1']||17, badge:'STABLE'      },
      { id:'1.19.4', label:'The Wild Update',       java:JAVA_REQUIREMENTS['1.19.4']||17, badge:'LEGACY'      },
      { id:'1.18.2', label:'Caves & Cliffs Pt. II', java:JAVA_REQUIREMENTS['1.18.2']||17, badge:'LEGACY'      },
      { id:'1.16.5', label:'Nether Update',         java:JAVA_REQUIREMENTS['1.16.5']||8,  badge:'CLASSIC'     },
      { id:'1.12.2', label:'World of Color',        java:JAVA_REQUIREMENTS['1.12.2']||8,  badge:'CLASSIC'     },
    ],
    modpacks: [
      { id:'vanilla',    label:'Vanilla',              desc:'No mods · Pure Minecraft'       },
      { id:'optifine',   label:'OptiFine HD',           desc:'HD Textures · Shaders · FPS Boost' },
      { id:'fabric',     label:'Fabric + QoL',          desc:'Sodium · Iris · Lithium · More' },
      { id:'forge',      label:'Forge',                 desc:'Full mod support · 1000s of mods' },
      { id:'rlcraft',    label:'RLCraft',               desc:'Hardcore survival modpack'      },
      { id:'skyfactory', label:'SkyFactory 4',          desc:'Skyblock · Automation · Magic'  },
      { id:'aternos',    label:'Create Above & Beyond', desc:'Automation · Engineering'       },
    ],
    gamemodes: [
      { id:'survival',  label:'Survival',  desc:'Gather resources, fight mobs' },
      { id:'creative',  label:'Creative',  desc:'Unlimited resources, fly, build' },
      { id:'adventure', label:'Adventure', desc:'Custom maps & restricted play' },
      { id:'hardcore',  label:'Hardcore',  desc:'One life, permadeath' },
      { id:'spectator', label:'Spectator', desc:'Observe only, no interaction' },
    ],
  });
});

// ─── GET /api/servers/active ─────────────────────────────────────────────────
router.get('/servers/active', (req, res) => {
  const active = launcher ? launcher.getActiveServers() : [];
  res.json({ ok:true, count:active.length, servers:active });
});

// ─── POST /api/servers/stop-all ──────────────────────────────────────────────
router.post('/servers/stop-all', async (req, res) => {
  if (launcher) await launcher.stopAllServers();
  sessions.clear();
  res.json({ ok:true, message:'All Minecraft servers stopped' });
});

module.exports = router;
