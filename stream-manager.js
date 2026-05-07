/**
 * Minecraft EasyProxi — Server-Side Stream Manager
 * streaming/stream-manager.js
 *
 * Manages Minecraft container lifecycle and WebRTC session routing.
 * In production, integrate with:
 *   - Docker API (start/stop Minecraft containers)
 *   - GStreamer / FFmpeg (capture & encode game output)
 *   - mediasoup / Janus (SFU for WebRTC at scale)
 */

const { EventEmitter } = require('events');

class StreamManager extends EventEmitter {
  constructor() {
    super();
    this.activeSessions = new Map();  // sessionId → SessionInfo
    this.nodeCapacity = {
      'us-east-1':    { max: 400, current: 0 },
      'us-west-2':    { max: 400, current: 0 },
      'eu-west-1':    { max: 400, current: 0 },
      'eu-central-1': { max: 400, current: 0 },
      'ap-sea-1':     { max: 300, current: 0 },
      'ap-nrt-1':     { max: 300, current: 0 },
      'sa-east-1':    { max: 200, current: 0 },
    };
  }

  // ─── Allocate a session slot on the best available node ───────────────────
  allocateNode(preferredRegion) {
    // Try preferred region first
    if (preferredRegion && this.nodeCapacity[preferredRegion]) {
      const node = this.nodeCapacity[preferredRegion];
      if (node.current < node.max) {
        node.current++;
        return { nodeId: preferredRegion, allocated: true };
      }
    }

    // Fall back to least-loaded node
    let bestNode = null;
    let bestLoad = 1;

    for (const [nodeId, info] of Object.entries(this.nodeCapacity)) {
      const load = info.current / info.max;
      if (load < bestLoad) {
        bestLoad = load;
        bestNode = nodeId;
      }
    }

    if (!bestNode) {
      return { nodeId: null, allocated: false, reason: 'All nodes at capacity' };
    }

    this.nodeCapacity[bestNode].current++;
    return { nodeId: bestNode, allocated: true };
  }

  // ─── Start a stream session ───────────────────────────────────────────────
  async startSession({ sessionId, userId, config, nodeId }) {
    if (this.activeSessions.has(sessionId)) {
      return { ok: false, error: 'Session already exists' };
    }

    const session = {
      sessionId,
      userId,
      nodeId,
      config,
      startedAt: Date.now(),
      status: 'starting',
      containerId: null,
      streamPort: null,
      webrtcPort: null,
    };

    this.activeSessions.set(sessionId, session);

    try {
      // In production: spawn Docker container here
      // const container = await docker.createContainer({
      //   Image: 'minecraft-server:latest',
      //   Env: [`MC_VERSION=${config.version}`, `MODPACK=${config.modpack}`],
      //   HostConfig: { NetworkMode: 'host', Runtime: 'nvidia' }
      // });
      // await container.start();
      // session.containerId = container.id;

      // Mock: simulate container startup
      await this._mockContainerStart(session);

      session.status = 'running';
      this.activeSessions.set(sessionId, session);
      this.emit('session:started', session);

      return { ok: true, session };
    } catch (err) {
      session.status = 'failed';
      this.activeSessions.set(sessionId, session);
      this._releaseNode(nodeId);
      return { ok: false, error: err.message };
    }
  }

  // ─── End a stream session ─────────────────────────────────────────────────
  async endSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };

    try {
      // In production: stop Docker container
      // if (session.containerId) {
      //   const container = docker.getContainer(session.containerId);
      //   await container.stop({ t: 10 });
      //   await container.remove();
      // }

      this._releaseNode(session.nodeId);
      const duration = Math.round((Date.now() - session.startedAt) / 1000);
      this.activeSessions.delete(sessionId);
      this.emit('session:ended', { sessionId, duration });

      return { ok: true, duration };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ─── Get active session info ──────────────────────────────────────────────
  getSession(sessionId) {
    return this.activeSessions.get(sessionId) || null;
  }

  // ─── Node capacity info ───────────────────────────────────────────────────
  getNodeStatus() {
    return Object.entries(this.nodeCapacity).map(([nodeId, info]) => ({
      nodeId,
      current: info.current,
      max: info.max,
      available: info.max - info.current,
      load: Math.round((info.current / info.max) * 100),
      status: info.current >= info.max ? 'full' : info.current > info.max * 0.8 ? 'busy' : 'available',
    }));
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────
  _releaseNode(nodeId) {
    if (this.nodeCapacity[nodeId]) {
      this.nodeCapacity[nodeId].current = Math.max(0, this.nodeCapacity[nodeId].current - 1);
    }
  }

  async _mockContainerStart(session) {
    return new Promise((resolve) => setTimeout(() => {
      session.containerId = `container_${session.sessionId.slice(-8)}`;
      session.streamPort = 5000 + Math.floor(Math.random() * 1000);
      session.webrtcPort = 8000 + Math.floor(Math.random() * 1000);
      resolve();
    }, 500));
  }

  // ─── Health check: kill stale sessions ───────────────────────────────────
  runHealthCheck() {
    const TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours (free plan)
    const now = Date.now();

    for (const [sessionId, session] of this.activeSessions) {
      if (now - session.startedAt > TIMEOUT_MS) {
        console.log(`[StreamManager] Session ${sessionId} timed out, ending...`);
        this.endSession(sessionId);
      }
    }
  }
}

// Singleton
const streamManager = new StreamManager();

// Health check every 10 minutes
setInterval(() => streamManager.runHealthCheck(), 10 * 60 * 1000);

module.exports = streamManager;
