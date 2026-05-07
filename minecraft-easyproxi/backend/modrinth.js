/**
 * Minecraft EasyProxi — Modrinth API Proxy
 * backend/modrinth.js
 *
 * Proxies requests to Modrinth API so the frontend
 * doesn't hit CORS issues and we can cache responses.
 * Also handles modpack downloading for the launcher.
 */

const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const MODRINTH_BASE    = 'https://api.modrinth.com/v2';
const MODRINTH_HEADERS = {
  'User-Agent': 'EasyProxi/1.0 (minecraft.easyproxi.online)',
  'Accept':     'application/json',
};

// Simple in-memory cache (5 min TTL)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ── HTTPS GET helper ──────────────────────────────────────────────
function modrinthGet(path) {
  return new Promise((resolve, reject) => {
    const url  = `${MODRINTH_BASE}${path}`;
    const cached = getCached(url);
    if (cached) return resolve(cached);

    https.get(url, { headers: MODRINTH_HEADERS }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200) setCache(url, parsed);
          resolve(parsed);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── GET /api/modrinth/search ──────────────────────────────────────
// Proxies: GET /v2/search
router.get('/search', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString();
    const data   = await modrinthGet(`/search?${params}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/modrinth/project/:slug ──────────────────────────────
router.get('/project/:slug', async (req, res) => {
  try {
    const data = await modrinthGet(`/project/${req.params.slug}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/modrinth/project/:slug/version ───────────────────────
router.get('/project/:slug/version', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString();
    const data   = await modrinthGet(`/project/${req.params.slug}/version${params ? '?' + params : ''}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/modrinth/categories ─────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const data = await modrinthGet('/tag/category');
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/modrinth/loaders ────────────────────────────────────
router.get('/loaders', async (req, res) => {
  try {
    const data = await modrinthGet('/tag/loader');
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/modrinth/game-versions ──────────────────────────────
router.get('/game-versions', async (req, res) => {
  try {
    const data = await modrinthGet('/tag/game_version');
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/modrinth/download ───────────────────────────────────
// Downloads a modpack to the server for use with the launcher
router.post('/download', async (req, res) => {
  const { projectSlug, versionId, sessionId } = req.body;
  if (!projectSlug) return res.status(400).json({ ok: false, error: 'projectSlug required' });

  try {
    // Get project versions
    const versions = await modrinthGet(`/project/${projectSlug}/version`);
    if (!Array.isArray(versions) || versions.length === 0) {
      return res.status(404).json({ ok: false, error: 'No versions found' });
    }

    // Find requested version or use latest
    const version = versionId
      ? versions.find(v => v.id === versionId)
      : versions[0];

    if (!version) return res.status(404).json({ ok: false, error: 'Version not found' });

    // Find the primary file
    const file = version.files?.find(f => f.primary) || version.files?.[0];
    if (!file) return res.status(404).json({ ok: false, error: 'No download file found' });

    // Destination path
    const modpacksDir = path.join(__dirname, '..', 'minecraft-servers', 'modpacks');
    if (!fs.existsSync(modpacksDir)) fs.mkdirSync(modpacksDir, { recursive: true });

    const destPath = path.join(modpacksDir, `${projectSlug}-${version.id}.mrpack`);

    // Return download info (actual download happens via launcher)
    res.json({
      ok:          true,
      projectSlug,
      versionId:   version.id,
      versionName: version.name,
      fileName:    file.filename,
      fileSize:    file.size,
      downloadUrl: file.url,
      sha512:      file.hashes?.sha512,
      destPath,
      gameVersions: version.game_versions,
      loaders:      version.loaders,
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/modrinth/featured ────────────────────────────────────
// Returns hand-picked featured modpacks
router.get('/featured', async (req, res) => {
  try {
    const featured = ['rlcraft', 'all-the-mods-9', 'prominence-ii-rpg', 'sky-factory-4', 'better-minecraft'];
    const projects = await Promise.allSettled(
      featured.map(slug => modrinthGet(`/project/${slug}`))
    );
    const results = projects
      .filter(p => p.status === 'fulfilled')
      .map(p => p.value);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
