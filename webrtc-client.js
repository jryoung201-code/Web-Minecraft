/**
 * Minecraft EasyProxi — WebRTC Streaming Client
 * streaming/webrtc-client.js
 *
 * Drop this script into the play page for real WebRTC integration.
 * Currently provides the full signaling flow; swap mock functions
 * with real game-server endpoints to go live.
 */

class EasyProxiStream {
  constructor(options = {}) {
    this.options = {
      socketUrl: options.socketUrl || 'https://minecraft.easyproxi.online',
      videoEl: options.videoEl || document.getElementById('stream-video'),
      onStats: options.onStats || null,
      onStateChange: options.onStateChange || null,
      onError: options.onError || null,
      iceServers: options.iceServers || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Add TURN servers for production:
        // { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pass' }
      ],
    };

    this.socket = null;
    this.pc = null;           // RTCPeerConnection
    this.sessionId = null;
    this.state = 'idle';      // idle | connecting | connected | reconnecting | disconnected
    this.statsInterval = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.MAX_RECONNECT = 5;
  }

  // ─── Connect ───────────────────────────────────────────────────────────────
  async connect({ sessionId, config, token }) {
    this.sessionId = sessionId;
    this._setState('connecting');

    try {
      await this._initSocket(token);
      await this._initPeerConnection();
      this._sendSessionStart(config);
    } catch (err) {
      this._handleError('Connection failed', err);
    }
  }

  // ─── Socket Setup ──────────────────────────────────────────────────────────
  async _initSocket(token) {
    return new Promise((resolve, reject) => {
      // Dynamic import of socket.io-client (CDN fallback)
      if (typeof io === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.4/socket.io.min.js';
        script.onload = () => this._connectSocket(token, resolve, reject);
        script.onerror = () => reject(new Error('Failed to load Socket.IO'));
        document.head.appendChild(script);
      } else {
        this._connectSocket(token, resolve, reject);
      }
    });
  }

  _connectSocket(token, resolve, reject) {
    this.socket = io(this.options.socketUrl, {
      transports: ['websocket', 'polling'],
      auth: { token },
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      console.log('[EasyProxi] Socket connected:', this.socket.id);
      resolve();
    });

    this.socket.on('connect_error', (err) => {
      console.error('[EasyProxi] Socket connect error:', err.message);
      reject(err);
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('[EasyProxi] Socket disconnected:', reason);
      if (this.state === 'connected') {
        this._scheduleReconnect();
      }
    });

    // WebRTC signaling events
    this.socket.on('webrtc:offer', async ({ fromId, sdp }) => {
      await this._handleOffer(fromId, sdp);
    });

    this.socket.on('webrtc:answer', async ({ fromId, sdp }) => {
      await this._handleAnswer(sdp);
    });

    this.socket.on('webrtc:ice-candidate', async ({ candidate }) => {
      await this._addIceCandidate(candidate);
    });

    // Session events
    this.socket.on('session:step', ({ step, message, total }) => {
      console.log(`[EasyProxi] Step ${step}/${total}: ${message}`);
      this.options.onStateChange?.({ type: 'step', step, message, total });
    });

    this.socket.on('session:ready', (data) => {
      console.log('[EasyProxi] Session ready:', data);
      this._setState('connected');
      this._startStatsCollection();
      this.options.onStateChange?.({ type: 'ready', ...data });
    });

    this.socket.on('session:reconnected', () => {
      this._setState('connected');
      this.reconnectAttempts = 0;
    });

    // Live stats from server
    this.socket.on('stream:stats', (stats) => {
      this.options.onStats?.(stats);
    });

    // Queue events
    this.socket.on('queue:position', ({ position, eta }) => {
      this.options.onStateChange?.({ type: 'queue', position, eta });
    });

    this.socket.on('queue:ready', ({ sessionId, node }) => {
      this.sessionId = sessionId;
      this._sendSessionStart({});
    });
  }

  // ─── RTCPeerConnection ─────────────────────────────────────────────────────
  async _initPeerConnection() {
    if (this.pc) { this.pc.close(); }

    this.pc = new RTCPeerConnection({ iceServers: this.options.iceServers });

    // ICE candidates → signal to server
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.socket?.connected) {
        this.socket.emit('webrtc:ice-candidate', {
          targetId: 'server',
          candidate,
          sessionId: this.sessionId,
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE state:', this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'failed') {
        this._scheduleReconnect();
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', this.pc.connectionState);
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        this._scheduleReconnect();
      }
    };

    // Incoming stream → attach to video element
    this.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream && this.options.videoEl) {
        this.options.videoEl.srcObject = stream;
        this.options.videoEl.style.display = 'block';
        this.options.videoEl.play().catch(console.warn);
        console.log('[WebRTC] Stream attached to video element');
      }
    };

    // Create offer to initiate connection with game server
    const offer = await this.pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: true,
    });
    await this.pc.setLocalDescription(offer);

    this.socket.emit('webrtc:offer', {
      targetId: 'server',
      sdp: offer,
      sessionId: this.sessionId,
    });

    console.log('[WebRTC] Offer sent to server');
  }

  async _handleOffer(fromId, sdp) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.socket.emit('webrtc:answer', {
      targetId: fromId,
      sdp: answer,
      sessionId: this.sessionId,
    });
  }

  async _handleAnswer(sdp) {
    if (this.pc.signalingState !== 'stable') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  async _addIceCandidate(candidate) {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC] Failed to add ICE candidate:', err.message);
    }
  }

  // ─── Session ───────────────────────────────────────────────────────────────
  _sendSessionStart(config) {
    this.socket.emit('session:start', {
      sessionId: this.sessionId,
      config,
    });
  }

  // ─── Input forwarding ──────────────────────────────────────────────────────
  sendKey(key, type = 'keydown') {
    this.socket?.emit('input:key', { key, type, sessionId: this.sessionId });
  }

  sendMouseMove(dx, dy) {
    this.socket?.emit('input:mousemove', { dx, dy, sessionId: this.sessionId });
  }

  sendMouseClick(x, y, button = 0, type = 'mousedown') {
    this.socket?.emit('input:mouse', { x, y, button, type, sessionId: this.sessionId });
  }

  // ─── Stats collection ──────────────────────────────────────────────────────
  _startStatsCollection() {
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.statsInterval = setInterval(async () => {
      if (!this.pc || this.state !== 'connected') return;
      try {
        const stats = await this.pc.getStats();
        let inbound = null;
        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            inbound = report;
          }
        });
        if (inbound && this.options.onStats) {
          this.options.onStats({
            fps: inbound.framesPerSecond || 0,
            packetsLost: inbound.packetsLost || 0,
            jitter: inbound.jitter || 0,
            bytesReceived: inbound.bytesReceived || 0,
          });
        }
      } catch (err) {
        // Silently ignore stats errors
      }
    }, 1000);
  }

  // ─── Latency ping ──────────────────────────────────────────────────────────
  measureLatency() {
    return new Promise((resolve) => {
      const t = Date.now();
      this.socket?.emit('client:ping', { timestamp: t });
      this.socket?.once('client:pong', ({ timestamp }) => {
        resolve(Date.now() - timestamp);
      });
      setTimeout(() => resolve(null), 3000); // timeout fallback
    });
  }

  // ─── Reconnect ─────────────────────────────────────────────────────────────
  _scheduleReconnect() {
    if (this.state === 'reconnecting') return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      this._handleError('Max reconnect attempts reached');
      return;
    }

    this._setState('reconnecting');
    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);

    console.log(`[EasyProxi] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this._initPeerConnection();
        this.socket?.emit('session:reconnect', { sessionId: this.sessionId });
      } catch (err) {
        this._scheduleReconnect();
      }
    }, delay);
  }

  // ─── Disconnect ────────────────────────────────────────────────────────────
  disconnect() {
    this._setState('disconnected');
    clearInterval(this.statsInterval);
    clearTimeout(this.reconnectTimer);

    this.socket?.emit('session:end', { sessionId: this.sessionId });
    this.pc?.close();
    this.socket?.disconnect();

    if (this.options.videoEl) {
      this.options.videoEl.srcObject = null;
      this.options.videoEl.style.display = 'none';
    }

    this.pc = null;
    this.socket = null;
    this.sessionId = null;
    console.log('[EasyProxi] Disconnected and cleaned up');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  _setState(state) {
    this.state = state;
    this.options.onStateChange?.({ type: 'state', state });
    console.log(`[EasyProxi] State → ${state}`);
  }

  _handleError(message, err) {
    console.error(`[EasyProxi Error] ${message}`, err || '');
    this._setState('disconnected');
    this.options.onError?.({ message, error: err });
  }

  isConnected() {
    return this.state === 'connected';
  }

  getSessionId() {
    return this.sessionId;
  }
}

// Export for browser and Node environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EasyProxiStream;
} else {
  window.EasyProxiStream = EasyProxiStream;
}
