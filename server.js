#!/usr/bin/env node
/**
 * Lumora TV – tiny zero-dependency server.
 *  - serves the web app from ./public
 *  - /api/fetch?url=   CORS proxy for playlists, EPG (auto-gunzip) and Xtream API calls
 *  - /api/stream?url=  streaming proxy for live/VOD media; rewrites HLS playlists so
 *                      every segment/key/variant also flows through the proxy
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');
const VENDOR = {
  '/vendor/hls.min.js': path.join(__dirname, 'node_modules/hls.js/dist/hls.min.js'),
  '/vendor/mpegts.js': path.join(__dirname, 'node_modules/mpegts.js/dist/mpegts.js'),
};
const DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, X-Final-Url');
}

function fail(res, code, msg) {
  if (res.headersSent) return res.destroy();
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

function targetFrom(u) {
  const url = u.searchParams.get('url');
  if (!url) return null;
  try {
    const t = new URL(url);
    if (t.protocol !== 'http:' && t.protocol !== 'https:') return null;
    return t;
  } catch { return null; }
}

async function upstream(target, req, extraHeaders = {}, q = null) {
  const headers = {
    'User-Agent': q?.get('ua') || req.headers['x-aurora-ua'] || DEFAULT_UA,
    'Accept': '*/*',
    ...extraHeaders,
  };
  if (req.headers.range) headers.Range = req.headers.range;
  const ref = q?.get('ref') || req.headers['x-aurora-referer'];
  if (ref) headers.Referer = ref;
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  return fetch(target, { headers, redirect: 'follow', signal: ac.signal });
}

// ---------- /api/fetch : text-ish resources, gunzip if needed ----------
async function handleFetch(req, res, target, q) {
  let r;
  try { r = await upstream(target, req, {}, q); }
  catch (e) { return fail(res, 502, 'Upstream unreachable: ' + (e.cause?.code || e.message)); }
  cors(res);
  const ct = r.headers.get('content-type') || 'application/octet-stream';
  if (!r.body) { res.writeHead(r.status, { 'Content-Type': ct }); return res.end(); }
  const src = Readable.fromWeb(r.body);
  src.on('error', () => res.destroy());
  // Peek the first chunk to detect gzip magic bytes (.xml.gz EPGs)
  src.once('readable', () => {
    const first = src.read();
    if (first === null) { res.writeHead(r.status, { 'Content-Type': ct }); return res.end(); }
    const gz = first.length >= 2 && first[0] === 0x1f && first[1] === 0x8b;
    res.writeHead(r.status, {
      'Content-Type': gz ? 'application/xml' : ct,
      'Cache-Control': 'no-store',
      'X-Final-Url': r.url,
    });
    if (gz) {
      const gunzip = zlib.createGunzip();
      gunzip.on('error', () => res.destroy());
      gunzip.write(first);
      src.pipe(gunzip).pipe(res);
    } else {
      res.write(first);
      src.pipe(res);
    }
  });
}

// ---------- /api/stream : media, with HLS playlist rewriting ----------
function proxify(abs, base, q) {
  const qs = new URLSearchParams({ url: abs });
  if (q?.get('ua')) qs.set('ua', q.get('ua'));
  if (q?.get('ref')) qs.set('ref', q.get('ref'));
  return `${base}/api/stream?${qs}`;
}

function rewriteM3U8(text, finalUrl, base, q) {
  const resolve = (u) => { try { return new URL(u, finalUrl).href; } catch { return u; } };
  return text.split(/\r?\n/).map((line) => {
    const l = line.trim();
    if (!l) return line;
    if (l.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxify(resolve(u), base, q)}"`);
    }
    return proxify(resolve(l), base, q);
  }).join('\n');
}

async function handleStream(req, res, target, q) {
  let r;
  try { r = await upstream(target, req, {}, q); }
  catch (e) { return fail(res, 502, 'Upstream unreachable: ' + (e.cause?.code || e.message)); }
  cors(res);
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const finalUrl = r.url || target.href;
  const looksHls = /mpegurl/.test(ct) || /\.m3u8?(\?|$)/i.test(new URL(finalUrl).pathname);
  if (looksHls && r.ok) {
    const text = await r.text();
    if (text.trimStart().startsWith('#EXTM3U')) {
      const base = ""; // root-relative so it works behind https reverse proxies
      const out = rewriteM3U8(text, finalUrl, base, q);
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
      return res.end(out);
    }
    res.writeHead(r.status, { 'Content-Type': ct || 'application/octet-stream' });
    return res.end(text);
  }
  const headers = { 'Content-Type': ct || 'application/octet-stream', 'Cache-Control': 'no-store' };
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = r.headers.get(h); if (v) headers[h] = v;
  }
  res.writeHead(r.status, headers);
  if (!r.body) return res.end();
  const s = Readable.fromWeb(r.body);
  s.on('error', () => res.destroy());
  s.pipe(res);
}

// ---------- static ----------
function serveStatic(req, res, pathname) {
  let file = VENDOR[pathname];
  if (!file) {
    const p = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) return fail(res, 403, 'Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      if (!path.extname(pathname)) return serveStatic(req, res, '/');
      return fail(res, 404, 'Not found');
    }
    const ext = path.extname(file);
    const accept = req.headers['accept-encoding'] || '';
    const compressible = /\.(js|css|html|svg|json|webmanifest)$/.test(ext);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache',
    };
    if (compressible && /\bbr\b/.test(accept)) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'br' });
      return fs.createReadStream(file).pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })).pipe(res);
    }
    if (compressible && /\bgzip\b/.test(accept)) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
      return fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (u.pathname === '/api/fetch' || u.pathname === '/api/stream') {
    const target = targetFrom(u);
    if (!target) return fail(res, 400, 'Missing or invalid ?url=');
    return (u.pathname === '/api/fetch' ? handleFetch : handleStream)(req, res, target, u.searchParams)
      .catch((e) => fail(res, 500, e.message));
  }
  if (u.pathname === '/api/health') { cors(res); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  serveStatic(req, res, u.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ✦ Lumora TV running at http://localhost:${PORT}\n`);
});
