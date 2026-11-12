export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny hyperscript: h('div.card#id', {onclick}, children...) */
export function h(tag, props, ...kids) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = (el.className + ' ' + v).trim();
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const clockCfg = { h12: false };
export function fmtClock(ts, opts = {}) {
  const d = new Date(ts);
  const h12 = opts.h12 ?? clockCfg.h12;
  if (!h12) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}
export function fmtDay(ts) {
  const d = new Date(ts), today = new Date();
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
export function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '--:--';
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
export function fmtMins(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60 ? (min % 60) + 'm' : ''}`.trim();
}

/** Normalised channel name for fuzzy EPG matching */
export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|backup|raw|\d{3,4}p)\b/g, ' ')
    .replace(/^[a-z]{2,3}\s*[|:\-]\s*/, '') // "UK | ", "US: "
    .replace(/[^a-z0-9]+/g, '');
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Deterministic pleasant gradient for channels without logos */
export function nameGradient(name) {
  const n = parseInt(hashStr(name || '?'), 36);
  const h1 = n % 360, h2 = (h1 + 40 + (n >> 9) % 60) % 360;
  return `linear-gradient(135deg, hsl(${h1} 55% 38%), hsl(${h2} 60% 28%))`;
}
export function initials(name) {
  const w = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[1][0] : (w[0]?.[1] || ''))).toUpperCase();
}

/**
 * Image URL to load. In the Android app images go through the built-in network
 * layer (/api/fetch): it follows http↔https redirects, sends a normal player
 * User-Agent, isn't affected by mixed-content rules, and caches on disk.
 */
export function imgUrl(src) {
  if (!src) return '';
  src = String(src).trim();
  if (window.AuroraNative && /^https?:\/\//i.test(src)) return '/api/fetch?url=' + encodeURIComponent(src);
  return src;
}

// Remember which logos loaded / failed so re-rendered rows show them instantly
// (no initials flash) and broken URLs aren't retried on every redraw.
const logoState = new Map();

/** Logo element with graceful fallback */
export function logoEl(src, name, cls = 'logo') {
  const el = h('div', { class: cls, style: { background: nameGradient(name) } }, h('span', initials(name)));
  const url = imgUrl(src);
  if (!url || logoState.get(url) === false) return el;
  const img = new Image();
  img.decoding = 'async'; img.alt = '';
  img.referrerPolicy = 'no-referrer';
  const show = () => { el.style.background = ''; el.classList.add('has-img'); el.replaceChildren(img); };
  if (logoState.get(url) === true) { img.src = url; show(); return el; }
  img.onload = () => { if (logoState.size > 4000) logoState.clear(); logoState.set(url, true); show(); };
  img.onerror = () => logoState.set(url, false);
  img.src = url;
  return el;
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem('aurora:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('aurora:' + k, JSON.stringify(v)); return true; } catch (e) { console.error('storage write failed', k, e); return false; } },
  del(k) { try { localStorage.removeItem('aurora:' + k); } catch {} },
};

export class Emitter {
  #l = new Map();
  on(ev, fn) { (this.#l.get(ev) || this.#l.set(ev, new Set()).get(ev)).add(fn); return () => this.#l.get(ev)?.delete(fn); }
  emit(ev, ...a) { this.#l.get(ev)?.forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } }); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Convert rem to px using the live root font size (UI scales with screen size) */
export const rem = (n) => Math.round(n * parseFloat(getComputedStyle(document.documentElement).fontSize || 16));
