# 🌿 Minecraft EasyProxi

> **Play Minecraft Anywhere.** — Cloud gaming platform for browser-based Minecraft streaming.

**Domain:** `minecraft.easyproxi.online`  
**Stack:** HTML · CSS · Vanilla JS · Node.js · Express · Socket.IO · WebRTC

---

## 📁 Project Structure

```
/project
├── frontend/
│   ├── index.html          ← Landing page
│   ├── play.html           ← Stream interface + queue + controls
│   ├── dashboard.html      ← User dashboard
│   ├── login.html          ← Auth (login + register)
│   ├── style.css           ← Full design system
│   ├── script.js           ← Shared JS (particles, toasts, server grid)
│   └── _redirects          ← Cloudflare Pages routing
│
├── backend/
│   ├── server.js           ← Express + Socket.IO server
│   ├── routes.js           ← REST API routes
│   ├── socket.js           ← WebRTC signaling + queue system
│   └── package.json
│
├── streaming/
│   ├── webrtc-client.js    ← Browser-side WebRTC client class
│   └── stream-manager.js   ← Server-side container + session manager
│
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── nginx.conf
│
├── vercel.json             ← Vercel deployment config
└── render.yaml             ← Render.com deployment config
```

---

## 🚀 Quick Start

### Frontend Only (Static)

Just open `frontend/index.html` in any browser — no build step needed.

```bash
cd frontend
# Open with any local server:
npx serve .
# or
python3 -m http.server 8080
```

Visit: `http://localhost:8080`

---

### Full Stack (Local)

```bash
# 1. Install backend deps
cd backend
npm install

# 2. Start backend
npm start
# → http://localhost:3000

# 3. Open frontend
open http://localhost:3000
```

---

## ☁️ Deployment

### Vercel (Frontend)

```bash
npm install -g vercel
vercel --prod
```

Or connect your GitHub repo to [vercel.com](https://vercel.com) and set:
- **Root Directory:** `frontend`
- **Build Command:** *(leave empty)*
- **Output Directory:** `.`

### Render (Full Stack)

1. Push repo to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect repo → it reads `render.yaml` automatically
4. Set env vars if needed

### Cloudflare Pages (Frontend)

1. Go to [pages.cloudflare.com](https://pages.cloudflare.com)
2. Connect repo → set root to `frontend`
3. Build command: *(leave empty)*
4. Output: `.`

The `_redirects` file handles API proxying automatically.

### Docker (Self-hosted / VPS)

```bash
cd docker
docker-compose up -d
```

For HTTPS, update `nginx.conf` with your domain and SSL cert paths.

```bash
# Get SSL cert with certbot
certbot certonly --standalone -d minecraft.easyproxi.online
```

### Ubuntu Server (Manual)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone repo
git clone https://github.com/yourname/minecraft-easyproxi.git
cd minecraft-easyproxi

# Install deps
cd backend && npm install --production

# Run with PM2
npm install -g pm2
pm2 start backend/server.js --name easyproxi
pm2 save
pm2 startup
```

---

## 🔌 API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/status` | Platform status + all nodes |
| `GET` | `/api/nodes` | Server node list |
| `GET` | `/api/versions` | Available MC versions + modpacks |
| `POST` | `/api/login` | Authenticate user |
| `POST` | `/api/register` | Create account |
| `GET` | `/api/session` | Get current session |
| `POST` | `/api/session/start` | Start a stream session |
| `DELETE` | `/api/session/:id` | End a session |
| `GET` | `/api/queue` | Queue status |
| `POST` | `/api/queue/join` | Join queue |

---

## 📡 Socket.IO Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `auth` | `{ token, userId }` | Authenticate socket |
| `queue:join` | `{ config }` | Join session queue |
| `queue:leave` | — | Leave queue |
| `session:start` | `{ sessionId, config }` | Start streaming session |
| `session:end` | `{ sessionId }` | End session |
| `session:reconnect` | `{ sessionId }` | Reconnect to session |
| `webrtc:offer` | `{ targetId, sdp, sessionId }` | Send WebRTC offer |
| `webrtc:answer` | `{ targetId, sdp, sessionId }` | Send WebRTC answer |
| `webrtc:ice-candidate` | `{ targetId, candidate }` | Send ICE candidate |
| `input:key` | `{ key, type, sessionId }` | Forward keyboard input |
| `input:mousemove` | `{ dx, dy, sessionId }` | Forward mouse delta |
| `input:mouse` | `{ x, y, button, type }` | Forward mouse click |
| `client:ping` | `{ timestamp }` | Latency measurement |
| `settings:save` | `{ settings }` | Sync settings to server |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `welcome` | `{ socketId, serverTime }` | Connection welcome |
| `auth:ok` | `{ userId }` | Auth confirmed |
| `queue:joined` | `{ position, eta, sessionId }` | Joined queue |
| `queue:position` | `{ position, eta }` | Queue position update |
| `queue:ready` | `{ sessionId, node }` | Session slot ready |
| `queue:left` | — | Left queue confirmed |
| `session:step` | `{ step, message, total }` | Connection progress |
| `session:ready` | `{ sessionId, node, ... }` | Stream is live |
| `session:ended` | `{ sessionId }` | Session ended |
| `session:reconnected` | — | Reconnected to session |
| `stream:stats` | `{ fps, ping, bandwidth, ... }` | Live stream metrics |
| `platform:stats` | `{ totalPlayers, ... }` | Platform-wide stats |
| `client:pong` | `{ timestamp }` | Ping response |

---

## 🎮 Play Page Features

| Feature | How |
|---------|-----|
| **Version selector** | Click cards before connecting |
| **Modpack selector** | Click cards before connecting |
| **Queue system** | Auto-shown when server is busy |
| **Stream overlay** | FPS / ping / bandwidth HUD |
| **Mouse lock** | Click stream area or press `M` |
| **Fullscreen** | Press `F11` or click ⛶ button |
| **Pause menu** | Press `ESC` while streaming |
| **Settings panel** | Click ⚙️ button in overlay |
| **FPS counter** | Toggle with `F3` |
| **Reconnect** | Auto-detected + manual banner |
| **Save session** | `Ctrl+S` or Settings → Save |

---

## 🎨 Design System

| Token | Value |
|-------|-------|
| `--green` | `#4ade80` |
| `--green-dim` | `#22c55e` |
| `--bg` | `#080c10` |
| `--bg-2` | `#0d1117` |
| `--text` | `#e8f4e9` |
| Font Display | Rajdhani 700 |
| Font Body | Outfit 400/500/600 |
| Font Mono | JetBrains Mono |
| Border radius | 12px / 20px |

---

## 🔒 Security Notes

- Replace mock auth with a real JWT + database system before going public
- Add TURN servers to ICE config for clients behind strict NAT
- Use Redis for session storage in production
- Rate-limit `/api/login` and `/api/register`
- Validate all socket events server-side

---

## 📝 License

MIT — © 2025 EasyProxi Team  
**minecraft.easyproxi.online**
