// Mobile companion: serves the exact same renderer UI to your phone's
// browser over your own Wi-Fi. Off by default; flip it on in Settings.
//
// How it stays local and safe:
// - Plain Node http server, LAN only — nothing touches the cloud.
// - A phone must pair with the 6-digit PIN shown on the desktop app before
//   anything (UI, data, RPC) is served to it. 5 wrong guesses rotates the
//   PIN and locks pairing for 60 seconds.
// - Paired sessions are random 256-bit tokens in an HttpOnly cookie, kept
//   in memory only — restarting the app forgets every phone.
// - The phone talks to the same rpc.dispatch() the desktop window uses,
//   so guardrails (approval queue, manual-only Facebook) apply unchanged.
'use strict';

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rpc = require('./rpc');
const config = require('./config');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
const COOKIE = 'shop_mobile_session';
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

let server = null;
let pin = null;
let failedAttempts = 0;
let lockedUntil = 0;
const sessions = new Map();   // token -> { device, pairedAt }
const sseClients = new Set(); // http.ServerResponse

function newPin() {
  pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  failedAttempts = 0;
  return pin;
}

function lanUrls(port) {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) urls.push(`http://${iface.address}:${port}`);
    }
  }
  return urls;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function sessionFor(req) {
  const cookies = req.headers.cookie || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m && sessions.has(m[1]) ? m[1] : null;
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, relPath) {
  const full = path.normalize(path.join(RENDERER_DIR, relPath));
  if (!full.startsWith(RENDERER_DIR + path.sep) && full !== RENDERER_DIR) { res.writeHead(403); res.end(); return; }
  const ext = path.extname(full).toLowerCase();
  if (!MIME[ext] || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(fs.readFileSync(full));
}

async function handlePair(req, res) {
  if (Date.now() < lockedUntil) {
    sendJson(res, 429, { error: `Too many wrong PINs. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)}s — the desktop app now shows a fresh PIN.` });
    return;
  }
  let attempt = '';
  try { attempt = String(JSON.parse(await readBody(req, 4096)).pin || ''); } catch { /* falls through to mismatch */ }
  if (!safeEqual(attempt, pin)) {
    failedAttempts++;
    if (failedAttempts >= MAX_PIN_ATTEMPTS) { newPin(); lockedUntil = Date.now() + LOCKOUT_MS; }
    sendJson(res, 401, { error: 'Wrong PIN — check the Settings screen on your PC.' });
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    device: (req.headers['user-agent'] || 'unknown device').slice(0, 120),
    pairedAt: new Date().toISOString()
  });
  failedAttempts = 0;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify({ ok: true }));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const authed = !!sessionFor(req);

  if (req.method === 'POST' && url.pathname === '/pair') return handlePair(req, res);
  if (url.pathname === '/pair') return serveFile(res, 'pair.html');
  if (url.pathname === '/pair.js') return serveFile(res, 'pair.js');

  if (!authed) {
    if (url.pathname === '/rpc' || url.pathname === '/events') return sendJson(res, 401, { error: 'Not paired' });
    res.writeHead(302, { Location: '/pair' });
    return res.end();
  }

  if (req.method === 'POST' && url.pathname === '/rpc') {
    let method, params;
    try { ({ method, params } = JSON.parse(await readBody(req))); } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
    return sendJson(res, 200, await rpc.dispatch(method, params));
  }

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* dropped */ } }, 25_000);
    req.on('close', () => { clearInterval(keepAlive); sseClients.delete(res); });
    return;
  }

  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  serveFile(res, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
}

function start() {
  if (server) return Promise.resolve(status());
  const port = Number(config.load().mobile.port) || 0;
  newPin();
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      try { sendJson(res, 500, { error: e.message || 'Server error' }); } catch { /* socket gone */ }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => { server = null; reject(e); });
    server.listen(port, '0.0.0.0', () => resolve(status()));
  });
}

function stop() {
  if (!server) return;
  for (const res of sseClients) { try { res.end(); } catch { /* already gone */ } }
  sseClients.clear();
  sessions.clear();
  server.close();
  server = null;
}

function broadcast(payload) {
  if (!sseClients.size) return;
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) { try { res.write(frame); } catch { /* dropped client */ } }
}

function status() {
  const cfg = config.load();
  const running = !!server;
  const port = running ? server.address().port : Number(cfg.mobile.port);
  return {
    enabled: !!cfg.mobile.enabled,
    running,
    port,
    urls: running ? lanUrls(port) : [],
    pin: running ? pin : null,
    devices: [...sessions.values()]
  };
}

function init() {
  if (config.load().mobile.enabled) {
    start().catch((e) => console.error('Mobile companion failed to start:', e.message));
  }
}

rpc.register('mobile.status', () => status());
rpc.register('mobile.set', async ({ enabled, port }) => {
  const mobile = {};
  if (enabled !== undefined) mobile.enabled = !!enabled;
  if (port !== undefined) mobile.port = Number(port) || config.DEFAULTS.mobile.port;
  config.save({ mobile });
  stop();
  if (config.load().mobile.enabled) await start();
  return status();
});
rpc.register('mobile.newPin', () => { newPin(); return status(); });
rpc.register('mobile.disconnectAll', () => { sessions.clear(); return status(); });

module.exports = { init, start, stop, broadcast, status };
