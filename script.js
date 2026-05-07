/* ─── script.js — Minecraft EasyProxi Shared JS ─── */

// ─── LOADING SCREEN ───────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  const ls = document.getElementById('loading-screen');
  if (!ls) return;
  setTimeout(() => {
    ls.style.opacity = '0';
    setTimeout(() => ls.remove(), 500);
  }, 1800);
});

// ─── PARTICLES ────────────────────────────────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function rand(min, max) { return min + Math.random() * (max - min); }

  function Particle() {
    this.reset();
  }

  Particle.prototype.reset = function() {
    this.x = rand(0, W);
    this.y = rand(0, H);
    this.size = rand(1, 2.5);
    this.speedX = rand(-0.3, 0.3);
    this.speedY = rand(-0.5, -0.15);
    this.alpha = rand(0.1, 0.5);
    this.alphaDir = rand(0.002, 0.006) * (Math.random() > 0.5 ? 1 : -1);
  };

  Particle.prototype.update = function() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.alpha += this.alphaDir;
    if (this.alpha <= 0.05 || this.alpha >= 0.55) this.alphaDir *= -1;
    if (this.y < -10 || this.x < -10 || this.x > W + 10) this.reset();
  };

  Particle.prototype.draw = function() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    // Minecraft-ish square particles
    if (this.size > 2) {
      ctx.fillRect(this.x, this.y, this.size, this.size);
    } else {
      ctx.arc(this.x, this.y, this.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  function init() {
    resize();
    particles = [];
    const count = Math.floor((W * H) / 14000);
    for (let i = 0; i < count; i++) particles.push(new Particle());
  }

  function animate() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', init);
  init();
  animate();
})();

// ─── TOAST SYSTEM ─────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── SERVER GRID DATA ─────────────────────────────────────────────────────────
const SERVERS = [
  { name: 'US East · NYC', region: 'us-east-1', players: 312, max: 400, ping: 18, status: 'online', gpu: 'RTX 4080' },
  { name: 'US West · LA',  region: 'us-west-2', players: 245, max: 400, ping: 22, status: 'online', gpu: 'RTX 4080' },
  { name: 'EU West · AMS', region: 'eu-west-1', players: 388, max: 400, ping: 31, status: 'busy',   gpu: 'RTX 4090' },
  { name: 'EU Central · FRA', region: 'eu-central-1', players: 260, max: 400, ping: 28, status: 'online', gpu: 'RTX 4080' },
  { name: 'AP Singapore',  region: 'ap-sea-1',  players: 190, max: 300, ping: 55, status: 'online', gpu: 'A100' },
  { name: 'AP Tokyo',      region: 'ap-nrt-1',  players: 140, max: 300, ping: 62, status: 'online', gpu: 'A100' },
  { name: 'SA São Paulo',  region: 'sa-east-1', players: 80,  max: 200, ping: 74, status: 'online', gpu: 'RTX 3080' },
  { name: 'AU Sydney',     region: 'ap-aus-1',  players: 0,   max: 200, ping: 0,  status: 'offline', gpu: 'RTX 3080' },
];

function renderServerGrid(containerId) {
  const targetId = containerId || 'server-grid';
  const container = document.getElementById(targetId);
  if (!container) return;

  // Randomize slightly
  const servers = SERVERS.map(s => ({
    ...s,
    players: s.status === 'offline' ? 0 : Math.max(0, s.players + Math.floor(Math.random() * 20 - 10)),
    ping: s.status === 'offline' ? 0 : Math.max(10, s.ping + Math.floor(Math.random() * 6 - 3)),
  }));

  container.innerHTML = servers.map(s => {
    const pct = Math.round((s.players / s.max) * 100);
    const statusClass = s.status === 'online' ? 'status-online' : s.status === 'busy' ? 'status-busy' : 'status-offline';
    const statusLabel = s.status === 'online' ? '● Online' : s.status === 'busy' ? '● Busy' : '○ Offline';
    const pingColor = s.ping < 30 ? 'var(--green)' : s.ping < 60 ? 'var(--yellow)' : 'var(--red)';

    return `
      <div class="glass server-card" onclick="selectServer('${s.region}')">
        <div class="server-header">
          <div>
            <div class="server-name">${s.name}</div>
            <div class="server-region">${s.region} · ${s.gpu}</div>
          </div>
          <div class="status-badge ${statusClass}">${statusLabel}</div>
        </div>
        <div class="server-meta">
          <span>👥 ${s.status === 'offline' ? '—' : s.players.toLocaleString() + ' / ' + s.max}</span>
          <span style="color:${pingColor};">⚡ ${s.status === 'offline' ? '—' : s.ping + 'ms'}</span>
          <span>📊 ${s.status === 'offline' ? '—' : pct + '% full'}</span>
        </div>
        ${s.status !== 'offline' ? `
          <div class="progress-bar">
            <div class="progress-fill" style="width:${pct}%;background:${pct > 80 ? 'var(--red)' : pct > 60 ? 'var(--yellow)' : 'linear-gradient(90deg,var(--green-dim),var(--green))'}"></div>
          </div>
        ` : '<div style="margin-top:14px;font-size:0.75rem;color:var(--text-dim);">Maintenance · Back soon</div>'}
      </div>
    `;
  }).join('');

  // Auto-refresh server data
  setTimeout(() => renderServerGrid(containerId), 8000);
}

function selectServer(region) {
  showToast(`Selected server: ${region}`, 'info');
  // Navigate to play with region preset
  setTimeout(() => {
    window.location.href = `play.html?region=${region}`;
  }, 600);
}

// ─── SCROLL ANIMATIONS ────────────────────────────────────────────────────────
(function initScrollAnim() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  function initElements() {
    const targets = document.querySelectorAll('.glass.feature-card, .glass.server-card, .stat-card, .achievement');
    targets.forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      observer.observe(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initElements);
  } else {
    setTimeout(initElements, 100);
  }
})();

// ─── CURSOR GLOW EFFECT ────────────────────────────────────────────────────────
(function initCursorGlow() {
  if (window.innerWidth < 768) return;
  const glow = document.createElement('div');
  glow.style.cssText = `
    position: fixed; pointer-events: none; z-index: 9999;
    width: 300px; height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(74,222,128,0.04) 0%, transparent 70%);
    transform: translate(-50%, -50%);
    transition: transform 0.1s ease;
    top: 0; left: 0;
  `;
  document.body.appendChild(glow);

  document.addEventListener('mousemove', e => {
    glow.style.left = e.clientX + 'px';
    glow.style.top = e.clientY + 'px';
  });
})();

// ─── PLAY PAGE QUERY PARAMS ───────────────────────────────────────────────────
(function handleQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const region = params.get('region');
  if (region) {
    const sel = document.getElementById('region-select');
    if (sel) {
      sel.value = region;
      showToast(`Region pre-selected: ${region}`, 'info');
    }
  }
})();

// ─── LIVE PLAYER COUNT (shared) ───────────────────────────────────────────────
(function initLiveCount() {
  const el = document.getElementById('live-count');
  if (!el) return;
  let count = 1842 + Math.floor(Math.random() * 200);
  el.textContent = count.toLocaleString();
  setInterval(() => {
    count += Math.floor(Math.random() * 7) - 3;
    count = Math.max(1500, count);
    el.textContent = count.toLocaleString();
  }, 4000);
})();

// ─── NAV SCROLL EFFECT ────────────────────────────────────────────────────────
window.addEventListener('scroll', () => {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  if (window.scrollY > 20) {
    nav.style.boxShadow = '0 4px 32px rgba(0,0,0,0.5)';
  } else {
    nav.style.boxShadow = 'none';
  }
});

// ─── BUTTON RIPPLE EFFECT ─────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn');
  if (!btn || btn.disabled) return;
  const ripple = document.createElement('span');
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  ripple.style.cssText = `
    position:absolute;border-radius:50%;
    width:${size}px;height:${size}px;
    left:${e.clientX - rect.left - size/2}px;
    top:${e.clientY - rect.top - size/2}px;
    background:rgba(255,255,255,0.15);
    animation:ripple-anim 0.5s ease out;
    pointer-events:none;
  `;
  if (!document.getElementById('ripple-style')) {
    const style = document.createElement('style');
    style.id = 'ripple-style';
    style.textContent = '@keyframes ripple-anim{from{transform:scale(0);opacity:1;}to{transform:scale(2.5);opacity:0;}}';
    document.head.appendChild(style);
  }
  const prevPos = btn.style.position;
  btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  btn.appendChild(ripple);
  setTimeout(() => { ripple.remove(); if (!prevPos) btn.style.position = ''; }, 500);
});

// ─── KEYBOARD NAVIGATION HINTS (play page) ───────────────────────────────────
document.addEventListener('keydown', e => {
  // Global: F1 toggles help overlay on play page
  if (e.key === 'F1') {
    e.preventDefault();
    showToast('Shortcuts: ESC=Pause, F11=Fullscreen, M=Mouse Lock, F3=FPS, Ctrl+S=Save', 'info', 5000);
  }
});

// ─── STARTUP ANNOUNCEMENT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
      showToast('🌿 Welcome to Minecraft EasyProxi! Play Minecraft anywhere.', 'success', 4000);
    }
  }, 2200);
});
