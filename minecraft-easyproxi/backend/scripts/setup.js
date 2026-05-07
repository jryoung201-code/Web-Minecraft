#!/usr/bin/env node
/**
 * EasyProxi Setup Script
 * Checks Java, creates dirs, and optionally pre-downloads Minecraft 1.20.4
 *
 * Usage:  node scripts/setup.js
 *         node scripts/setup.js --prefetch
 */

const { execSync } = require('child_process');
const fs   = require('path');
const path = require('path');
const https = require('https');

const BASE_DIR  = path.join(__dirname, '..', '..', 'minecraft-servers');
const JARS_DIR  = path.join(BASE_DIR, 'jars');
const WORLDS    = path.join(BASE_DIR, 'worlds');
const LOGS      = path.join(BASE_DIR, 'logs');

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

const ok   = msg => console.log(`${GREEN}  ✓${RESET} ${msg}`);
const warn = msg => console.log(`${YELLOW}  ⚠${RESET} ${msg}`);
const err  = msg => console.log(`${RED}  ✗${RESET} ${msg}`);
const info = msg => console.log(`  ${msg}`);

console.log(`\n${BOLD}╔══════════════════════════════════════╗`);
console.log(`║  Minecraft EasyProxi — Setup         ║`);
console.log(`╚══════════════════════════════════════╝${RESET}\n`);

// ── 1. Node.js version ─────────────────────────────────────────────────────
info('Checking Node.js...');
const nodeMajor = parseInt(process.version.replace('v','').split('.')[0]);
if (nodeMajor >= 18) {
  ok(`Node.js ${process.version}`);
} else {
  err(`Node.js 18+ required (found ${process.version})`);
  process.exit(1);
}

// ── 2. Java ────────────────────────────────────────────────────────────────
info('Checking Java...');
try {
  const javaOut = execSync('java -version 2>&1', { encoding:'utf8' });
  const match   = javaOut.match(/version "(\d+)/);
  const ver     = match ? parseInt(match[1]) : 0;
  if (ver >= 21) {
    ok(`Java ${ver} (required: 21 for MC 1.20.4)`);
  } else if (ver >= 17) {
    warn(`Java ${ver} found — Java 21 recommended for MC 1.20.4`);
    warn('Install: https://adoptium.net/ or: sudo apt install openjdk-21-jre');
  } else if (ver >= 8) {
    warn(`Java ${ver} found — only supports MC 1.16.5 and older`);
  } else {
    err('Java not found. Install Java 21 from https://adoptium.net/');
  }
} catch (e) {
  err('Java not found in PATH. Install Java 21: https://adoptium.net/');
  warn('On Ubuntu: sudo apt install openjdk-21-jre');
  warn('On macOS:  brew install openjdk@21');
  warn('On Windows: https://adoptium.net/');
}

// ── 3. Create directories ──────────────────────────────────────────────────
info('\nCreating server directories...');
[BASE_DIR, JARS_DIR, WORLDS, LOGS].forEach(dir => {
  const rp = require('path');
  const rf = require('fs');
  if (!rf.existsSync(dir)) { rf.mkdirSync(dir, { recursive:true }); ok(rp.relative(process.cwd(), dir)); }
  else { info(`  Already exists: ${rp.relative(process.cwd(), dir)}`); }
});

// ── 4. Check network ───────────────────────────────────────────────────────
info('\nChecking Mojang CDN connectivity...');
const req = https.get('https://piston-data.mojang.com', res => {
  if (res.statusCode < 400) ok('Mojang CDN reachable');
  else warn(`Mojang CDN returned ${res.statusCode}`);
  res.destroy();
  printSummary();
});
req.on('error', e => {
  warn(`Cannot reach Mojang CDN: ${e.message}`);
  warn('Server JARs will fail to download. Check your network/firewall.');
  printSummary();
});
req.setTimeout(5000, () => { req.destroy(); warn('Mojang CDN timeout'); printSummary(); });

function printSummary() {
  console.log(`\n${BOLD}Setup complete!${RESET}`);
  console.log('\nNext steps:');
  console.log('  1. cd backend && npm install');
  console.log('  2. npm start');
  console.log('  3. Open http://localhost:3000\n');
  console.log('Optional — pre-download MC 1.20.4 JAR now:');
  console.log('  node scripts/setup.js --prefetch\n');

  if (process.argv.includes('--prefetch')) {
    prefetchJar();
  }
}

async function prefetchJar() {
  const { startMinecraftServer, KNOWN_JARS } = require('../streaming/minecraft-launcher');
  const url  = KNOWN_JARS['1.20.4'];
  const dest = require('path').join(JARS_DIR, 'server-1.20.4.jar');

  if (require('fs').existsSync(dest)) {
    ok('server-1.20.4.jar already cached');
    return;
  }

  console.log('\nDownloading Minecraft 1.20.4 server JAR...');
  const file = require('fs').createWriteStream(dest);
  https.get(url, res => {
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let   dl    = 0;
    res.on('data', chunk => {
      dl += chunk.length;
      if (total) {
        const pct = Math.round(dl/total*100);
        process.stdout.write(`\r  ${pct}% — ${(dl/1024/1024).toFixed(1)}/${(total/1024/1024).toFixed(1)} MB`);
      }
    });
    res.pipe(file);
    file.on('finish', () => { console.log('\n'); ok('server-1.20.4.jar saved'); });
  }).on('error', e => { err(`Download failed: ${e.message}`); require('fs').unlinkSync(dest); });
}
