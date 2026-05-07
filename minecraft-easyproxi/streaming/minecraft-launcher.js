/**
 * Minecraft EasyProxi — Minecraft 1.20.4 Launcher
 * streaming/minecraft-launcher.js
 *
 * Downloads and runs the official Minecraft server JAR.
 * Streams stdout/stderr back over Socket.IO.
 * Real framebuffer capture requires GStreamer or FFmpeg (see bottom).
 */

const { spawn, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

// ─── Minecraft version manifest ───────────────────────────────────────────────
const VERSION_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

// Direct server JAR download URLs for known versions (fallback if manifest fails)
const KNOWN_JARS = {
  '1.20.4': 'https://piston-data.mojang.com/v1/objects/8dd1a28015f51b1803213892b50b7b4fc76e594d/server.jar',
  '1.20.2': 'https://piston-data.mojang.com/v1/objects/5b868151bd02b41319f54c8d4061b8cae84e665c/server.jar',
  '1.20.1': 'https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar',
  '1.19.4': 'https://piston-data.mojang.com/v1/objects/8f3112a1049751cc472ec13e397eade5336ca7ae/server.jar',
  '1.18.2': 'https://piston-data.mojang.com/v1/objects/c8f83c5655308435b3a907db1c6f3f87f952f0e9/server.jar',
  '1.16.5': 'https://piston-data.mojang.com/v1/objects/1b557e7b033b583cd9f66746b7a9ab1ec1673eca/server.jar',
  '1.12.2': 'https://piston-data.mojang.com/v1/objects/886945bfb2b978778c3a0288fd7fab09d315b25f/server.jar',
};

// Minimum Java versions required per MC version
const JAVA_REQUIREMENTS = {
  '1.20.4': 21, '1.20.2': 21, '1.20.1': 17,
  '1.19.4': 17, '1.18.2': 17, '1.16.5': 8,
  '1.12.2': 8,
};

// ─── Server directory layout ──────────────────────────────────────────────────
const BASE_DIR     = path.join(__dirname, '..', 'minecraft-servers');
const JARS_DIR     = path.join(BASE_DIR, 'jars');
const WORLDS_DIR   = path.join(BASE_DIR, 'worlds');
const LOGS_DIR     = path.join(BASE_DIR, 'logs');

// ─── Active server processes ──────────────────────────────────────────────────
// Map: sessionId → { process, version, port, worldDir, startedAt, logStream }
const activeServers = new Map();

let nextPort = 25565; // Each session gets its own port

function allocatePort() {
  const port = nextPort;
  nextPort++;
  if (nextPort > 26565) nextPort = 25565; // wrap
  return port;
}

// ─── Ensure directories exist ─────────────────────────────────────────────────
function ensureDirs() {
  [BASE_DIR, JARS_DIR, WORLDS_DIR, LOGS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ─── Check Java availability ──────────────────────────────────────────────────
function checkJava(requiredVersion = 17) {
  try {
    const output = execSync('java -version 2>&1', { encoding: 'utf8' });
    const match  = output.match(/version "(\d+)/);
    if (!match) return { ok: false, error: 'Java not found in PATH' };
    const installed = parseInt(match[1]);
    if (installed < requiredVersion) {
      return { ok: false, error: `Java ${requiredVersion} required, found Java ${installed}` };
    }
    return { ok: true, version: installed };
  } catch (err) {
    return { ok: false, error: 'Java is not installed or not in PATH' };
  }
}

// ─── Download a file with progress callback ───────────────────────────────────
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file   = fs.createWriteStream(destPath);
    const client = url.startsWith('https') ? https : http;

    const request = client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(res.headers.location, destPath, onProgress)
          .then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const total   = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;

      res.on('data', chunk => {
        downloaded += chunk.length;
        if (total && onProgress) {
          onProgress(Math.round((downloaded / total) * 100), downloaded, total);
        }
      });

      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
      file.on('error', err => { file.close(); fs.unlinkSync(destPath); reject(err); });
    });

    request.on('error', err => { file.close(); reject(err); });
    request.setTimeout(30000, () => { request.destroy(); reject(new Error('Download timed out')); });
  });
}

// ─── Get or download the server JAR ──────────────────────────────────────────
async function getServerJar(version, onLog) {
  ensureDirs();
  const jarPath = path.join(JARS_DIR, `server-${version}.jar`);

  if (fs.existsSync(jarPath)) {
    const size = fs.statSync(jarPath).size;
    onLog(`[EasyProxi] Using cached JAR: server-${version}.jar (${(size/1024/1024).toFixed(1)} MB)`, 'info');
    return jarPath;
  }

  // Try known direct URL first
  const directUrl = KNOWN_JARS[version];
  if (directUrl) {
    onLog(`[EasyProxi] Downloading minecraft_server.${version}.jar...`, 'info');
    await downloadFile(directUrl, jarPath, (pct, dl, total) => {
      onLog(`[EasyProxi] Download: ${pct}% (${(dl/1024/1024).toFixed(1)}/${(total/1024/1024).toFixed(1)} MB)`, 'info');
    });
    onLog(`[EasyProxi] Download complete: server-${version}.jar`, 'done');
    return jarPath;
  }

  // Fallback: fetch version manifest
  onLog(`[EasyProxi] Fetching version manifest for ${version}...`, 'info');
  const manifest = await fetchJSON(VERSION_MANIFEST_URL);
  const versionInfo = manifest.versions.find(v => v.id === version);
  if (!versionInfo) throw new Error(`Version ${version} not found in manifest`);

  const versionData = await fetchJSON(versionInfo.url);
  const serverUrl   = versionData.downloads?.server?.url;
  if (!serverUrl) throw new Error(`No server download for ${version}`);

  onLog(`[EasyProxi] Downloading from Mojang CDN...`, 'info');
  await downloadFile(serverUrl, jarPath, (pct) => {
    onLog(`[EasyProxi] Download: ${pct}%`, 'info');
  });
  onLog(`[EasyProxi] Download complete!`, 'done');
  return jarPath;
}

// ─── Fetch JSON over HTTPS ────────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ─── Write server.properties ──────────────────────────────────────────────────
function writeServerProperties(worldDir, config) {
  const gamemode = config.gamemode || 'survival';
  const difficulty = gamemode === 'hardcore' ? 'hard' : (config.difficulty || 'easy');
  const hardcore = gamemode === 'hardcore' ? 'true' : 'false';
  const props = [
    '#Minecraft server properties — generated by EasyProxi',
    `#${new Date().toUTCString()}`,
    `server-port=${config.port || 25565}`,
    `gamemode=${gamemode === 'hardcore' ? 'survival' : gamemode}`,
    `difficulty=${difficulty}`,
    `hardcore=${hardcore}`,
    `online-mode=false`,         // Allow unauthenticated (for cloud streaming)
    `enable-rcon=true`,
    `rcon.port=${(config.port || 25565) + 10}`,
    `rcon.password=easyproxi_${config.sessionId || 'default'}`,
    `max-players=1`,             // One player per cloud session
    `view-distance=${config.renderDistance || 10}`,
    `simulation-distance=8`,
    `spawn-protection=0`,
    `allow-flight=true`,
    `enable-command-block=true`,
    `motd=EasyProxi Cloud Session`,
    `level-seed=${config.seed || ''}`,
    `level-type=minecraft\\:normal`,
    `generate-structures=true`,
    `pvp=true`,
    `white-list=false`,
  ].join('\n');

  fs.writeFileSync(path.join(worldDir, 'server.properties'), props);
}

// ─── Accept EULA ─────────────────────────────────────────────────────────────
function acceptEula(worldDir) {
  fs.writeFileSync(
    path.join(worldDir, 'eula.txt'),
    '#By setting eula=true you agree to the Minecraft EULA\n' +
    '#https://account.mojang.com/documents/minecraft_eula\n' +
    `#${new Date().toUTCString()}\n` +
    'eula=true\n'
  );
}

// ─── Build JVM arguments ──────────────────────────────────────────────────────
function buildJvmArgs(version, config) {
  const ram   = config.ram || '2G';
  const flags = [
    `-Xmx${ram}`,
    `-Xms512M`,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true',
  ];
  return flags;
}

// ─── MAIN: Start a Minecraft server for a session ─────────────────────────────
async function startMinecraftServer(sessionId, config = {}, callbacks = {}) {
  const {
    onLog    = () => {},
    onReady  = () => {},
    onError  = () => {},
    onExit   = () => {},
  } = callbacks;

  const version = config.version || '1.20.4';
  const requiredJava = JAVA_REQUIREMENTS[version] || 17;

  // 1. Check Java
  onLog(`[EasyProxi] Checking Java installation...`, 'info');
  const javaCheck = checkJava(requiredJava);
  if (!javaCheck.ok) {
    onError(javaCheck.error);
    return null;
  }
  onLog(`[EasyProxi] Java ${javaCheck.version} detected ✓`, 'done');

  // 2. Download JAR
  let jarPath;
  try {
    jarPath = await getServerJar(version, onLog);
  } catch (err) {
    onError(`Failed to get server JAR: ${err.message}`);
    return null;
  }

  // 3. Setup world directory (per-session isolation)
  ensureDirs();
  const worldDir = path.join(WORLDS_DIR, `session-${sessionId}`);
  if (!fs.existsSync(worldDir)) fs.mkdirSync(worldDir, { recursive: true });

  const port = allocatePort();
  writeServerProperties(worldDir, { ...config, port, sessionId });
  acceptEula(worldDir);

  // 4. Build launch command
  const jvmArgs = buildJvmArgs(version, config);
  const args    = [...jvmArgs, '-jar', jarPath, '--nogui'];

  onLog(`[EasyProxi] Starting server on port ${port}...`, 'info');
  onLog(`[Server thread/INFO]: Starting minecraft server version ${version}`, 'info');

  // 5. Spawn server process
  let proc;
  try {
    proc = spawn('java', args, {
      cwd:   worldDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env:   { ...process.env, JAVA_TOOL_OPTIONS: '' },
    });
  } catch (err) {
    onError(`Failed to spawn Java: ${err.message}`);
    return null;
  }

  // 6. Set up log file
  const logPath   = path.join(LOGS_DIR, `${sessionId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  // 7. Stream stdout → callback + log file
  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (!line.trim()) return;
      logStream.write(line + '\n');

      // Detect "Done" message → server ready
      if (line.includes('Done') && line.includes('For help')) {
        onLog(line.trim(), 'done');
        onReady({ port, pid: proc.pid, worldDir, version });
      } else if (line.includes('WARN') || line.includes('warn')) {
        onLog(line.trim(), 'warn');
      } else if (line.includes('ERROR') || line.includes('error')) {
        onLog(line.trim(), 'error');
      } else {
        onLog(line.trim(), 'info');
      }
    });
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      logStream.write('[STDERR] ' + line + '\n');
      // Filter JVM startup noise
      if (!line.startsWith('OpenJDK') && !line.startsWith('Picked up')) {
        onLog(line, 'warn');
      }
    }
  });

  proc.on('close', (code) => {
    logStream.end();
    activeServers.delete(sessionId);
    onExit({ code, sessionId });
    onLog(`[EasyProxi] Server process exited with code ${code}`, code === 0 ? 'info' : 'error');
  });

  proc.on('error', (err) => {
    onError(`Process error: ${err.message}`);
  });

  // 8. Register active server
  const serverInfo = {
    process:   proc,
    pid:       proc.pid,
    version,
    port,
    worldDir,
    logPath,
    logStream,
    startedAt: Date.now(),
    config,
    sessionId,
  };

  activeServers.set(sessionId, serverInfo);
  onLog(`[EasyProxi] Server process started (PID: ${proc.pid})`, 'done');

  return serverInfo;
}

// ─── Send RCON command to running server ──────────────────────────────────────
async function sendCommand(sessionId, command) {
  const server = activeServers.get(sessionId);
  if (!server) return { ok: false, error: 'Server not found' };

  // Write to stdin (works for basic commands)
  try {
    server.process.stdin.write(command + '\n');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Stop a Minecraft server ──────────────────────────────────────────────────
async function stopMinecraftServer(sessionId) {
  const server = activeServers.get(sessionId);
  if (!server) return { ok: false, error: 'Server not running' };

  return new Promise((resolve) => {
    // Send /stop command first (graceful)
    try { server.process.stdin.write('stop\n'); } catch (e) {}

    const timeout = setTimeout(() => {
      // Force kill if doesn't stop in 10s
      try { server.process.kill('SIGKILL'); } catch(e) {}
      activeServers.delete(sessionId);
      resolve({ ok: true, forced: true });
    }, 10000);

    server.process.on('close', () => {
      clearTimeout(timeout);
      activeServers.delete(sessionId);
      resolve({ ok: true, forced: false });
    });
  });
}

// ─── Clean up world directory after session ───────────────────────────────────
function cleanupWorldDir(sessionId) {
  const worldDir = path.join(WORLDS_DIR, `session-${sessionId}`);
  if (fs.existsSync(worldDir)) {
    fs.rmSync(worldDir, { recursive: true, force: true });
  }
}

// ─── List active servers ──────────────────────────────────────────────────────
function getActiveServers() {
  const result = [];
  activeServers.forEach((info, sessionId) => {
    result.push({
      sessionId,
      version:   info.version,
      port:      info.port,
      pid:       info.pid,
      uptime:    Math.floor((Date.now() - info.startedAt) / 1000),
      config:    info.config,
    });
  });
  return result;
}

// ─── Graceful shutdown: stop all servers ─────────────────────────────────────
async function stopAllServers() {
  const promises = [];
  activeServers.forEach((_, sessionId) => {
    promises.push(stopMinecraftServer(sessionId));
  });
  await Promise.allSettled(promises);
}

process.on('SIGTERM', () => stopAllServers());
process.on('SIGINT',  () => stopAllServers());

// ─── Export ───────────────────────────────────────────────────────────────────
module.exports = {
  startMinecraftServer,
  stopMinecraftServer,
  sendCommand,
  cleanupWorldDir,
  getActiveServers,
  stopAllServers,
  checkJava,
  KNOWN_JARS,
  JAVA_REQUIREMENTS,
};

/*
 ═══════════════════════════════════════════════════════════════════════
  FRAMEBUFFER → WebRTC STREAMING (Production Integration Guide)
 ═══════════════════════════════════════════════════════════════════════

 Once the Minecraft server is running on localhost:PORT, you need to
 capture its rendered output and stream it via WebRTC.

 Since Minecraft is a GUI app, you'll run it on a virtual display:

 STEP 1 — Virtual display (Linux only)
 ──────────────────────────────────────
   sudo apt install xvfb
   Xvfb :99 -screen 0 1920x1080x24 &
   export DISPLAY=:99
   java -jar server.jar   ← (this is the client, not server, for display)

 STEP 2 — Capture with GStreamer → WebRTC
 ─────────────────────────────────────────
   gst-launch-1.0 \
     ximagesrc display-name=:99 use-damage=false ! \
     video/x-raw,framerate=60/1 ! \
     videoconvert ! \
     x264enc tune=zerolatency bitrate=4000 speed-preset=ultrafast ! \
     rtph264pay ! \
     webrtcbin name=sendonly ...

 STEP 3 — Or capture with FFmpeg → HLS/DASH (simpler, more latency)
 ────────────────────────────────────────────────────────────────────
   ffmpeg \
     -f x11grab -video_size 1920x1080 -framerate 60 -i :99 \
     -c:v libx264 -preset ultrafast -tune zerolatency \
     -b:v 4000k -maxrate 4000k -bufsize 8000k \
     -f hls -hls_time 1 -hls_list_size 3 \
     /tmp/stream/stream.m3u8

 STEP 4 — Forward mouse/keyboard (xdotool)
 ─────────────────────────────────────────
   // From Socket.IO input:key events:
   execSync(`DISPLAY=:99 xdotool key ${key}`);
   execSync(`DISPLAY=:99 xdotool mousemove ${x} ${y}`);
   execSync(`DISPLAY=:99 xdotool click ${button}`);

 STEP 5 — Use mediasoup (Node.js WebRTC SFU) for low-latency streaming
 ───────────────────────────────────────────────────────────────────────
   npm install mediasoup
   // mediasoup can ingest GStreamer's RTP output and forward to browsers
   // See: https://mediasoup.org/documentation/

 ═══════════════════════════════════════════════════════════════════════
*/
