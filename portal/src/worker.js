// Lumora TV remote-management backend (Cloudflare Worker + D1).
import { PAGES } from './pages.js'; // generated from ../public by build.mjs
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};
// Admin API (cookie session) for the portal, device API (bearer token) for TVs.

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const err = (status, message) => json({ error: message }, status);

const now = () => Date.now();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const newId = () => randomToken(9);
async function sha256(s) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
async function hashPassword(password, salt) {
  // 10k iterations keeps us inside the free plan's CPU budget; logins are rate limited.
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 10000 }, key, 256);
  return b64url(bits);
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function pairCode() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return [...r].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}
async function body(req) { try { return await req.json(); } catch { return {}; } }
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));

// ------------------------------------------------------------------ admin auth
const COOKIE = 'lt_s';
async function adminSession(req, env) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)lt_s=([^;]+)/);
  if (!m) return false;
  const row = await env.DB.prepare('SELECT expires FROM sessions WHERE hash = ?').bind(await sha256(m[1])).first();
  return !!row && row.expires > now();
}
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function handleAuth(req, env, path) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  if (path === '/api/auth/state') {
    const admin = await env.DB.prepare('SELECT 1 FROM admin WHERE id = 1').first();
    return json({ setup: !admin, loggedIn: await adminSession(req, env) });
  }
  if (req.method !== 'POST') return err(405, 'Method not allowed');
  if (path === '/api/auth/logout') {
    const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)lt_s=([^;]+)/);
    if (m) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha256(m[1])).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  }
  // brute-force protection for setup + login: 10 tries / 15 min / IP
  const since = now() - 15 * 60e3;
  const tries = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?').bind(ip, since).first();
  if (tries.n >= 10) return err(429, 'Too many attempts. Try again in 15 minutes.');
  const b = await body(req);
  const password = str(b.password, 200);
  if (path === '/api/auth/setup') {
    const admin = await env.DB.prepare('SELECT 1 FROM admin WHERE id = 1').first();
    if (admin) return err(409, 'Already set up');
    if (!env.SETUP_KEY || !safeEqual(str(b.setupKey, 200), env.SETUP_KEY)) {
      await env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(ip, now()).run();
      return err(403, 'Wrong setup key');
    }
    if (password.length < 10) return err(400, 'Use at least 10 characters');
    const salt = randomToken(16);
    await env.DB.prepare('INSERT INTO admin (id, pass_hash, salt, created) VALUES (1, ?, ?, ?)').bind(await hashPassword(password, salt), salt, now()).run();
  } else if (path === '/api/auth/login') {
    const admin = await env.DB.prepare('SELECT pass_hash, salt FROM admin WHERE id = 1').first();
    if (!admin || !safeEqual(await hashPassword(password, admin.salt), admin.pass_hash)) {
      await env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(ip, now()).run();
      return err(401, 'Wrong password');
    }
  } else return err(404, 'Not found');
  const token = randomToken();
  const maxAge = 30 * 86400;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (hash, expires) VALUES (?, ?)').bind(await sha256(token), now() + maxAge * 1000),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()),
    env.DB.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(since),
  ]);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, maxAge) });
}

// ------------------------------------------------------------------ admin API
const PL_FIELDS = (p) => ({ id: p.id, name: p.name, type: p.type, server: p.server, user: p.user, pass: p.pass, url: p.url, epgUrl: p.epg_url, updated: p.updated });
function validatePlaylist(b) {
  const type = b.type === 'm3u' ? 'm3u' : 'xtream';
  const p = { type, name: str(b.name, 80), server: '', user: '', pass: '', url: '', epg_url: str(b.epgUrl, 1000) };
  if (type === 'xtream') {
    p.server = str(b.server, 300); p.user = str(b.user, 200); p.pass = str(b.pass, 200);
    if (!p.server || !p.user) return [null, 'Server and username are required'];
  } else {
    p.url = str(b.url, 2000);
    if (!/^https?:\/\//i.test(p.url)) return [null, 'Enter a playlist URL starting with http:// or https://'];
  }
  if (p.epg_url && !/^https?:\/\//i.test(p.epg_url)) return [null, 'The guide URL must start with http:// or https://'];
  return [p, null];
}

async function handleAdmin(req, env, path) {
  if (!(await adminSession(req, env))) return err(401, 'Not signed in');
  const m = req.method;
  // origin check for state-changing requests (defence in depth on top of SameSite=Strict)
  if (m !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== new URL(req.url).host) return err(403, 'Bad origin');
  }
  let r;
  if (path === '/api/devices' && m === 'GET') {
    const devs = (await env.DB.prepare('SELECT * FROM devices WHERE claimed = 1 ORDER BY name').all()).results;
    const pls = (await env.DB.prepare('SELECT * FROM playlists').all()).results;
    return json({
      now: now(),
      devices: devs.map((d) => ({
        id: d.id, name: d.name, lastSeen: d.last_seen, appVersion: d.app_version, model: d.model,
        nowPlaying: d.now_playing, report: d.report ? JSON.parse(d.report) : null,
        playlists: pls.filter((p) => p.device_id === d.id).map(PL_FIELDS),
      })),
    });
  }
  if (path === '/api/devices/claim' && m === 'POST') {
    const b = await body(req);
    const code = str(b.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const d = await env.DB.prepare('SELECT id FROM devices WHERE pair_code = ? AND claimed = 0 AND pair_expires > ?').bind(code, now()).first();
    if (!d) return err(404, 'No TV is showing that code. Codes expire after 15 minutes.');
    await env.DB.prepare('UPDATE devices SET claimed = 1, pair_code = NULL, name = ? WHERE id = ?').bind(str(b.name, 60) || 'TV', d.id).run();
    return json({ ok: true, id: d.id });
  }
  if ((r = path.match(/^\/api\/devices\/([\w-]+)$/))) {
    const id = r[1];
    if (m === 'PATCH') {
      const b = await body(req);
      await env.DB.prepare('UPDATE devices SET name = ? WHERE id = ? AND claimed = 1').bind(str(b.name, 60) || 'TV', id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM playlists WHERE device_id = ?').bind(id),
        env.DB.prepare('DELETE FROM commands WHERE device_id = ?').bind(id),
        env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }
  if ((r = path.match(/^\/api\/devices\/([\w-]+)\/playlists$/)) && m === 'POST') {
    const dev = await env.DB.prepare('SELECT id FROM devices WHERE id = ? AND claimed = 1').bind(r[1]).first();
    if (!dev) return err(404, 'Unknown TV');
    const [p, e] = validatePlaylist(await body(req));
    if (e) return err(400, e);
    const id = newId();
    await env.DB.prepare('INSERT INTO playlists (id, device_id, name, type, server, user, pass, url, epg_url, updated) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, dev.id, p.name, p.type, p.server, p.user, p.pass, p.url, p.epg_url, now()).run();
    return json({ ok: true, id });
  }
  if ((r = path.match(/^\/api\/playlists\/([\w-]+)$/))) {
    if (m === 'PUT') {
      const [p, e] = validatePlaylist(await body(req));
      if (e) return err(400, e);
      await env.DB.prepare('UPDATE playlists SET name=?, type=?, server=?, user=?, pass=?, url=?, epg_url=?, updated=? WHERE id = ?')
        .bind(p.name, p.type, p.server, p.user, p.pass, p.url, p.epg_url, now(), r[1]).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') { await env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(r[1]).run(); return json({ ok: true }); }
  }
  if ((r = path.match(/^\/api\/devices\/([\w-]+)\/commands$/)) && m === 'POST') {
    const b = await body(req);
    const type = str(b.type, 30);
    if (!['refresh', 'refreshEpg', 'checkUpdate', 'reload', 'message'].includes(type)) return err(400, 'Unknown command');
    await env.DB.prepare('INSERT INTO commands (id, device_id, type, payload, created) VALUES (?,?,?,?,?)')
      .bind(newId(), r[1], type, str(b.payload, 300), now()).run();
    return json({ ok: true });
  }
  return err(404, 'Not found');
}

// ------------------------------------------------------------------ device API
async function deviceAuth(req, env) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer ([\w-]+)\.([\w-]+)$/);
  if (!m) return null;
  const d = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(m[1]).first();
  return d && safeEqual(await sha256(m[2]), d.token_hash) ? d : null;
}

async function handleDevice(req, env, path) {
  if (path === '/api/device/register' && req.method === 'POST') {
    const b = await body(req);
    const id = newId(), token = randomToken();
    // drop abandoned, never-claimed registrations
    await env.DB.prepare('DELETE FROM devices WHERE claimed = 0 AND created < ?').bind(now() - 7 * 86400e3).run();
    let code;
    for (let i = 0; i < 5; i++) {
      code = pairCode();
      if (!(await env.DB.prepare('SELECT 1 FROM devices WHERE pair_code = ?').bind(code).first())) break;
    }
    await env.DB.prepare('INSERT INTO devices (id, token_hash, pair_code, pair_expires, created, last_seen, app_version, model) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, await sha256(token), code, now() + 15 * 60e3, now(), now(), str(b.version, 30), str(b.model, 80)).run();
    return json({ id, token: `${id}.${token}`, code, expires: now() + 15 * 60e3 });
  }
  const d = await deviceAuth(req, env);
  if (!d) return err(401, 'Unknown device');

  if (path === '/api/device/sync' && req.method === 'GET') {
    if (!d.claimed) {
      let code = d.pair_code, expires = d.pair_expires;
      if (!code || expires < now()) {
        code = pairCode(); expires = now() + 15 * 60e3;
        await env.DB.prepare('UPDATE devices SET pair_code = ?, pair_expires = ?, last_seen = ? WHERE id = ?').bind(code, expires, now(), d.id).run();
      } else await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(now(), d.id).run();
      return json({ claimed: false, code, expires });
    }
    await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(now(), d.id).run();
    const pls = (await env.DB.prepare('SELECT * FROM playlists WHERE device_id = ? ORDER BY updated').bind(d.id).all()).results;
    const cmds = (await env.DB.prepare('SELECT id, type, payload FROM commands WHERE device_id = ? AND done IS NULL ORDER BY created').bind(d.id).all()).results;
    return json({ claimed: true, name: d.name, playlists: pls.map(PL_FIELDS), commands: cmds });
  }

  if (path === '/api/device/report' && req.method === 'POST') {
    const b = await body(req);
    const stmts = [env.DB.prepare('UPDATE devices SET last_seen = ?, app_version = ?, model = ?, now_playing = ?, report = ? WHERE id = ?')
      .bind(now(), str(b.version, 30), str(b.model, 80), str(b.nowPlaying, 200), JSON.stringify(b.report || {}).slice(0, 20000), d.id)];
    for (const cid of (Array.isArray(b.done) ? b.done : []).slice(0, 50)) {
      stmts.push(env.DB.prepare('UPDATE commands SET done = ? WHERE id = ? AND device_id = ?').bind(now(), str(cid, 40), d.id));
    }
    stmts.push(env.DB.prepare('DELETE FROM commands WHERE done IS NOT NULL AND done < ?').bind(now() - 7 * 86400e3));
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  // First sync after pairing: the TV hands over the playlists it already has so
  // they can be managed from the portal. Returns the new ids to link them.
  if (path === '/api/device/adopt' && req.method === 'POST' && d.claimed) {
    const b = await body(req);
    const out = [];
    for (const item of (Array.isArray(b.playlists) ? b.playlists : []).slice(0, 20)) {
      const [p, e] = validatePlaylist(item);
      if (e) continue;
      const id = newId();
      await env.DB.prepare('INSERT INTO playlists (id, device_id, name, type, server, user, pass, url, epg_url, updated) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(id, d.id, p.name, p.type, p.server, p.user, p.pass, p.url, p.epg_url, now()).run();
      out.push({ localId: str(item.localId, 40), id });
    }
    return json({ ok: true, linked: out });
  }
  return err(404, 'Not found');
}

// ------------------------------------------------------------------ entry
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/api/device/')) {
        // TVs call from their app (different origin): allow CORS, bearer auth only (no cookies)
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        const res = await handleDevice(req, env, path);
        for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
        return res;
      }
      if (path.startsWith('/api/auth/')) return await handleAuth(req, env, path);
      if (path.startsWith('/api/')) return await handleAdmin(req, env, path);
      const page = PAGES[path] || (req.method === 'GET' && !path.includes('.') ? PAGES['/'] : null);
      if (!page) return new Response('Not found', { status: 404 });
      return new Response(page[0], { headers: { 'content-type': page[1], 'cache-control': 'no-cache', ...SECURITY_HEADERS } });
    } catch (e) {
      console.error(e);
      return err(500, 'Server error');
    }
  },
};
