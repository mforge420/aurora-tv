import { settings } from './settings.js';

const PROXY_OK = location.protocol.startsWith('http'); // the bundled node server provides /api/*
let proxyAvailable = null;

export async function detectProxy() {
  if (!PROXY_OK) return (proxyAvailable = false);
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    proxyAvailable = r.ok;
  } catch { proxyAvailable = false; }
  return proxyAvailable;
}
export const hasProxy = () => !!proxyAvailable;

function headers() {
  const ua = settings.get('userAgent');
  return ua ? { 'x-aurora-ua': ua } : {};
}

/** Fetch a remote resource. Tries proxy (auto-gunzip) first, falls back to direct. */
export async function fetchRemote(url, { signal, onProgress } = {}) {
  const mode = settings.get('proxyMode');
  const attempts = [];
  if (hasProxy() && mode !== 'never') attempts.push('/api/fetch?url=' + encodeURIComponent(url));
  if (mode !== 'always' || !hasProxy()) attempts.push(url);
  let lastErr;
  for (const u of attempts) {
    try {
      const r = await fetch(u, { signal, headers: u.startsWith('/api') ? headers() : {} });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.clone().json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      return r;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('Network error');
}

/** Read a Response as text with progress callback (bytes). Handles gzip when proxy is bypassed. */
export async function readText(r, onProgress) {
  const total = Number(r.headers.get('content-length')) || 0;
  let stream = r.body;
  const reader = stream.getReader();
  const first = await reader.read();
  const chunks = [];
  let loaded = 0;
  const isGz = first.value && first.value[0] === 0x1f && first.value[1] === 0x8b;
  // re-assemble a stream starting with the peeked chunk
  stream = new ReadableStream({
    start(c) { if (!first.done) c.enqueue(first.value); else c.close(); },
    async pull(c) { const x = await reader.read(); if (x.done) c.close(); else c.enqueue(x.value); },
  });
  if (isGz && 'DecompressionStream' in window) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const dec = stream.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await dec.read();
    if (done) break;
    chunks.push(value); loaded += value.length;
    onProgress?.(loaded, total);
  }
  return chunks.join('');
}

export async function fetchText(url, opts = {}) {
  const r = await fetchRemote(url, opts);
  return readText(r, opts.onProgress);
}
export async function fetchJSON(url, opts = {}) {
  const t = await fetchText(url, opts);
  try { return JSON.parse(t); } catch { throw new Error('Invalid JSON response'); }
}

/** URL the player should load for a media stream */
export function mediaUrl(url, { forceProxy = false } = {}) {
  const mode = settings.get('proxyMode');
  const mixed = location.protocol === 'https:' && url.startsWith('http:');
  const useProxy = hasProxy() && mode !== 'never' && (forceProxy || mode === 'always' || mixed);
  return useProxy ? '/api/stream?url=' + encodeURIComponent(url) : url;
}
export const proxiedMedia = (url) => (hasProxy() ? '/api/stream?url=' + encodeURIComponent(url) : url);
