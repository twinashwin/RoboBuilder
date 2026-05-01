import http   from 'http';
import https  from 'https';
import fs     from 'fs';
import fsp    from 'fs/promises';
import path   from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

const API_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// ── Auth storage paths ─────────────────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// ── Auth tuning ────────────────────────────────────────────────────────────
const SCRYPT_N      = 16384;       // CPU/memory cost (2^14)
const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;     // 30 days
const SESSION_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh cookie if <24h til expiry
const MAX_PAYLOAD = 256 * 1024;     // 256 KB cap on sync uploads

// ── Mutex (single-process serialization for JSON file writes) ─────────────
let _mutexChain = Promise.resolve();
function withLock(fn) {
  const next = _mutexChain.then(fn, fn);
  // Swallow this run's rejection so subsequent waiters aren't poisoned.
  _mutexChain = next.catch(() => undefined);
  return next;
}

// ── JSON storage helpers ───────────────────────────────────────────────────
async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}
async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}
async function writeJsonAtomic(file, obj) {
  await ensureDataDir();
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  await fsp.writeFile(tmp, JSON.stringify(obj), 'utf8');
  await fsp.rename(tmp, file);
}

// ── Validators ─────────────────────────────────────────────────────────────
function isEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}
function passwordIssue(pw) {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

// ── Scrypt password hashing ────────────────────────────────────────────────
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N }, (err, key) => {
      if (err) return reject(err);
      resolve({ salt: salt.toString('hex'), hash: key.toString('hex') });
    });
  });
}
function verifyPassword(password, saltHex, expectedHashHex) {
  return new Promise((resolve, reject) => {
    let salt, expected;
    try {
      salt     = Buffer.from(saltHex, 'hex');
      expected = Buffer.from(expectedHashHex, 'hex');
    } catch { return resolve(false); }
    if (expected.length !== SCRYPT_KEYLEN) return resolve(false);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N }, (err, key) => {
      if (err) return reject(err);
      try {
        resolve(crypto.timingSafeEqual(key, expected));
      } catch {
        resolve(false);
      }
    });
  });
}

// ── Session helpers ────────────────────────────────────────────────────────
function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(p => {
    const idx = p.indexOf('=');
    if (idx === -1) return;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}
function buildSessionCookie(token, expiresAt) {
  const expiresUtc = new Date(expiresAt).toUTCString();
  return [
    `rb_session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresUtc}`,
  ].join('; ');
}
function clearSessionCookie() {
  return 'rb_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

async function loadAuthedSession(req) {
  const token = parseCookies(req.headers.cookie || '').rb_session;
  if (!token) return null;
  const sessions = await readJson(SESSIONS_FILE, {});
  const sess = sessions[token];
  if (!sess) return null;
  if (typeof sess.expiresAt !== 'number' || sess.expiresAt < Date.now()) {
    // Expired — sweep on next mutating call. For now, treat as logged out.
    return null;
  }
  return { token, email: sess.email, expiresAt: sess.expiresAt };
}

// ── Body parser ────────────────────────────────────────────────────────────
function readJsonBody(req, maxBytes = MAX_PAYLOAD) {
  return new Promise((resolve, reject) => {
    let body = '';
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      body += chunk;
      if (body.length > maxBytes) {
        aborted = true;
        const err = new Error('Payload too large');
        err.status = 413;
        req.destroy();
        reject(err);
      }
    });
    req.on('end', () => {
      if (aborted) return;
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch {
        const err = new Error('Invalid JSON');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj, extraHeaders) {
  const headers = { ...API_HEADERS, ...(extraHeaders || {}) };
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

// ── Email sending via Resend HTTP API (kept; opt-in via env var) ───────────
async function sendConfirmationEmail(toEmail) {
  const apiKey    = process.env.EMAIL_API_KEY || '';
  const fromEmail = process.env.FROM_EMAIL || 'RoboBuilder <noreply@robobuilder.app>';
  if (!apiKey) {
    console.log('[Email] No EMAIL_API_KEY set, skipping confirmation to', toEmail);
    return;
  }

  const body = JSON.stringify({
    from: fromEmail,
    to: toEmail,
    subject: 'Welcome to RoboBuilder!',
    html: [
      '<div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">',
      '<h2 style="color:#1E293B;margin:0 0 8px">Welcome to RoboBuilder!</h2>',
      '<p style="color:#475569;line-height:1.6">Your free account is ready.</p>',
      '<a href="http://localhost:3000" style="display:inline-block;padding:10px 24px;background:#3B82F6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;margin:12px 0">Open RoboBuilder</a>',
      '</div>'
    ].join('')
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error('Resend API error: ' + res.statusCode));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Endpoint: POST /api/signup ─────────────────────────────────────────────
async function handleSignup(req, res) {
  let payload;
  try { payload = await readJsonBody(req); }
  catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password;

  if (!isEmail(email)) {
    return sendJson(res, 400, { error: 'Please enter a valid email address.' });
  }
  const pwIssue = passwordIssue(password);
  if (pwIssue) {
    return sendJson(res, 400, { error: pwIssue });
  }

  // Hash outside the lock — scrypt is slow.
  const { salt, hash } = await hashPassword(password);
  const now = new Date().toISOString();

  const result = await withLock(async () => {
    const accounts = await readJson(ACCOUNTS_FILE, {});
    if (accounts[email]) {
      return { status: 409, body: { error: 'Email already registered. Try logging in?' } };
    }
    accounts[email] = {
      email,
      passwordHash: hash,
      salt,
      createdAt: now,
      updatedAt: now,
      build: null,
      code:  null,
    };
    await writeJsonAtomic(ACCOUNTS_FILE, accounts);

    const sessions = await readJson(SESSIONS_FILE, {});
    const token = newSessionToken();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions[token] = { email, expiresAt };
    await writeJsonAtomic(SESSIONS_FILE, sessions);
    return {
      status: 200,
      body:   { ok: true, email },
      cookie: buildSessionCookie(token, expiresAt),
    };
  });

  if (result.cookie) {
    sendJson(res, result.status, result.body, { 'Set-Cookie': result.cookie });
    // Best-effort confirmation email; never blocks the response.
    sendConfirmationEmail(email).catch(err => {
      console.error('[Email] Failed to send confirmation:', err.message);
    });
  } else {
    sendJson(res, result.status, result.body);
  }

  // Compatibility: keep emails.jsonl growing for any downstream tooling.
  try {
    await fsp.appendFile(
      path.join(DATA_DIR, 'emails.jsonl'),
      JSON.stringify({ email, timestamp: now, userAgent: req.headers['user-agent'] || '' }) + '\n'
    );
  } catch { /* non-fatal */ }
}

// ── Endpoint: POST /api/login ──────────────────────────────────────────────
async function handleLogin(req, res) {
  let payload;
  try { payload = await readJsonBody(req); }
  catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password;

  if (!isEmail(email) || typeof password !== 'string' || !password) {
    return sendJson(res, 400, { error: 'Email and password are required.' });
  }

  // Read account (no need to lock for read-only)
  const accounts = await readJson(ACCOUNTS_FILE, {});
  const acct = accounts[email];

  // To partially blunt enumeration: always run scrypt even if the account
  // doesn't exist (so timing is similar). Use a dummy salt+hash.
  let ok = false;
  if (acct) {
    ok = await verifyPassword(password, acct.salt, acct.passwordHash);
  } else {
    // Burn equivalent CPU so attackers can't easily distinguish.
    const dummySalt = '00'.repeat(16);
    const dummyHash = '00'.repeat(SCRYPT_KEYLEN);
    await verifyPassword(password, dummySalt, dummyHash).catch(() => false);
  }

  if (!ok) {
    return sendJson(res, 401, { error: 'Invalid email or password.' });
  }

  const result = await withLock(async () => {
    const sessions = await readJson(SESSIONS_FILE, {});
    const token = newSessionToken();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions[token] = { email, expiresAt };
    // Sweep expired sessions while we're here.
    const nowMs = Date.now();
    for (const [t, s] of Object.entries(sessions)) {
      if (!s || typeof s.expiresAt !== 'number' || s.expiresAt < nowMs) delete sessions[t];
    }
    sessions[token] = { email, expiresAt }; // re-add in case we just deleted nothing
    await writeJsonAtomic(SESSIONS_FILE, sessions);
    return { token, expiresAt };
  });

  sendJson(res, 200, { ok: true, email }, {
    'Set-Cookie': buildSessionCookie(result.token, result.expiresAt),
  });
}

// ── Endpoint: POST /api/logout ─────────────────────────────────────────────
async function handleLogout(req, res) {
  const token = parseCookies(req.headers.cookie || '').rb_session;
  if (token) {
    await withLock(async () => {
      const sessions = await readJson(SESSIONS_FILE, {});
      if (sessions[token]) {
        delete sessions[token];
        await writeJsonAtomic(SESSIONS_FILE, sessions);
      }
    });
  }
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}

// ── Endpoint: GET /api/me ──────────────────────────────────────────────────
async function handleMe(req, res) {
  const sess = await loadAuthedSession(req);
  if (!sess) return sendJson(res, 401, { error: 'Not signed in.' });

  // Optionally refresh cookie if nearing expiry.
  let extraHeaders;
  if (sess.expiresAt - Date.now() < SESSION_REFRESH_THRESHOLD_MS) {
    const newExpires = Date.now() + SESSION_TTL_MS;
    await withLock(async () => {
      const sessions = await readJson(SESSIONS_FILE, {});
      if (sessions[sess.token]) {
        sessions[sess.token].expiresAt = newExpires;
        await writeJsonAtomic(SESSIONS_FILE, sessions);
      }
    });
    extraHeaders = { 'Set-Cookie': buildSessionCookie(sess.token, newExpires) };
  }
  sendJson(res, 200, { ok: true, email: sess.email }, extraHeaders);
}

// ── Endpoint: GET /api/sync ────────────────────────────────────────────────
async function handleSyncGet(req, res) {
  const sess = await loadAuthedSession(req);
  if (!sess) return sendJson(res, 401, { error: 'Not signed in.' });
  const accounts = await readJson(ACCOUNTS_FILE, {});
  const acct = accounts[sess.email];
  if (!acct) return sendJson(res, 401, { error: 'Account not found.' });
  sendJson(res, 200, {
    ok: true,
    build:     acct.build || null,
    code:      acct.code  || null,
    updatedAt: acct.updatedAt || null,
  });
}

// ── Endpoint: POST /api/sync ───────────────────────────────────────────────
async function handleSyncPost(req, res) {
  const sess = await loadAuthedSession(req);
  if (!sess) return sendJson(res, 401, { error: 'Not signed in.' });

  let payload;
  try { payload = await readJsonBody(req); }
  catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  // Validate shape — `build` is an object or null, `code` is string or null.
  const build = (payload.build === null || payload.build === undefined)
    ? null
    : (typeof payload.build === 'object' ? payload.build : undefined);
  const code = (payload.code === null || payload.code === undefined)
    ? null
    : (typeof payload.code === 'string' ? payload.code : undefined);

  if (build === undefined || code === undefined) {
    return sendJson(res, 400, { error: 'Invalid sync payload.' });
  }

  const updatedAt = new Date().toISOString();

  await withLock(async () => {
    const accounts = await readJson(ACCOUNTS_FILE, {});
    const acct = accounts[sess.email];
    if (!acct) {
      // Account vanished mid-flight. Surface as 401.
      const err = new Error('Account not found.');
      err.status = 401;
      throw err;
    }
    if (build !== null) acct.build = build;
    if (code  !== null) acct.code  = code;
    acct.updatedAt = updatedAt;
    accounts[sess.email] = acct;
    await writeJsonAtomic(ACCOUNTS_FILE, accounts);
  }).catch(err => {
    sendJson(res, err.status || 500, { error: err.message || 'Server error' });
    throw err;
  });

  // Only continue if no error (the mutex error path already responded).
  if (!res.writableEnded) {
    sendJson(res, 200, { ok: true, updatedAt });
  }
}

// ── HTTP Server ────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400); res.end('Bad request');
    return;
  }

  // Same-origin only — no CORS exposed.
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API routing ─────────────────────────────────────────────────────────
  try {
    if (urlPath === '/api/signup'  && req.method === 'POST') return await handleSignup(req, res);
    if (urlPath === '/api/login'   && req.method === 'POST') return await handleLogin(req, res);
    if (urlPath === '/api/logout'  && req.method === 'POST') return await handleLogout(req, res);
    if (urlPath === '/api/me'      && req.method === 'GET')  return await handleMe(req, res);
    if (urlPath === '/api/sync'    && req.method === 'GET')  return await handleSyncGet(req, res);
    if (urlPath === '/api/sync'    && req.method === 'POST') return await handleSyncPost(req, res);
  } catch (err) {
    console.error('[API] Unhandled error on', req.method, urlPath, err);
    if (!res.writableEnded) {
      sendJson(res, 500, { error: 'Server error' });
    }
    return;
  }

  // Block non-GET/HEAD for static files
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method not allowed');
    return;
  }

  // Block access to data directory and unknown API paths
  if (urlPath.startsWith('/data/') || urlPath.startsWith('/api/')) {
    res.writeHead(404); res.end('Not found');
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.resolve(path.join(__dirname, urlPath));
  if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  ensureDataDir().catch(err => console.error('[Boot] Could not create data dir:', err));
  console.log(`Serving http://localhost:${PORT}`);
});
