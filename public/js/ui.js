import { h } from './util.js';
import { nav } from './nav.js';

const P = {
  live: '<rect x="2" y="7" width="20" height="14" rx="3"/><path d="m17 2-5 5-5-5"/>',
  guide: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 10h18M8 2v4M16 2v4M8 14h3M13 14h3M8 17.5h5"/>',
  movie: '<rect x="2.5" y="3" width="19" height="18" rx="3"/><path d="M7 3v18M17 3v18M2.5 8h4.5M2.5 16h4.5M17 8h4.5M17 16h4.5M2.5 12h19"/>',
  series: '<rect x="2" y="6" width="20" height="15" rx="3"/><path d="M7 2h10M5 4h14"/><path d="m10 10.5 5 3-5 3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  star: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  updown: '<path d="m7 9 5-5 5 5M7 15l5 5 5-5"/>',
  fwd: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  audio: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  cc: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3"/>',
  hd: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M7 9v6M11 9v6M7 12h4M14 9v6h1.5a3 3 0 0 0 0-6z"/>',
  aspect: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M7 9H5.5v2M17 15h1.5v-2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  rewind: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>',
  pip: '<rect x="2" y="4" width="20" height="16" rx="3"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M9.9 4.24A9 9 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  stats: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  sparkle: '<path d="M12 3 13.9 8.1 19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="m17 2-5 5-5-5"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  football: '<circle cx="12" cy="12" r="9.5"/><path d="m12 7.5 3.8 2.8-1.5 4.4H9.7l-1.5-4.4z"/><path d="M12 7.5V2.6M15.8 10.3l4.6-1.5M14.3 14.7l2.8 4M9.7 14.7l-2.8 4M8.2 10.3 3.6 8.8"/>',
  cricket: '<path d="m4 20 2.5-2.5M6.5 17.5l9.8-9.8a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0L2.5 13.5"/><path d="m6.5 17.5-2-2"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  f1: '<path d="M4 21V4"/><path d="M4 4h15v10H4"/><path d="M4 4h3.75v2.5H4zM11.5 4h3.75v2.5H11.5zM7.75 6.5h3.75V9H7.75zM15.25 6.5H19V9h-3.75zM4 9h3.75v2.5H4zM11.5 9h3.75v2.5H11.5zM7.75 11.5h3.75V14H7.75zM15.25 11.5H19V14h-3.75z" fill="currentColor" stroke="none"/>',
  skip: '<path d="m5 4 10 8-10 8z" fill="currentColor"/><path d="M19 5v14"/>',
};
export const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
export const iconEl = (n, cls) => { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = icon(n, cls); return s.firstChild; };

// ---------------- toasts ----------------
export function toast(msg, { type = 'info', ms = 3200, icon: ic } = {}) {
  const root = document.getElementById('toasts');
  const el = h('div.toast.' + type, { html: (ic ? icon(ic) : '') + `<span></span>` });
  el.querySelector('span').textContent = msg;
  root.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, ms);
}

// ---------------- modal ----------------
export function modal(content, { className = '', onClose, dismissable = true } = {}) {
  const prevFocus = document.activeElement;
  const box = h('div.modal' + (className ? '.' + className.split(' ').join('.') : ''), content);
  const wrap = h('div.modal-wrap', { onclick: (e) => { if (e.target === wrap && dismissable) close(); } }, box);
  document.getElementById('modals').append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  const unbind = nav.push((k) => {
    if (k === 'back' && dismissable) { close(); return true; }
    return false;
  });
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    unbind();
    wrap.classList.add('closing'); wrap.classList.remove('in');
    setTimeout(() => wrap.remove(), 220);
    if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
    onClose?.(result);
  }
  setTimeout(() => nav.focusFirst(box), 30);
  return { close, el: box, wrap };
}

export function confirmDialog(title, text, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let res = false;
    const m = modal([
      h('h2', title),
      text && h('p.muted', text),
      h('div.row.end',
        h('button.btn.ghost', { onclick: () => m.close() }, cancel),
        h('button.btn' + (danger ? '.danger' : '.primary'), { 'data-autofocus': true, onclick: () => { res = true; m.close(); } }, ok)),
    ], { className: 'small', onClose: () => resolve(res) });
  });
}

/** Choose one option from a list (used for audio/subtitles/quality, etc.) */
export function choose(title, options, { current } = {}) {
  return new Promise((resolve) => {
    let res = null;
    const m = modal([
      h('h2', title),
      h('div.choices', options.map((o) => h('button.choice' + (o.active || o.id === current ? '.active' : ''), {
        'data-autofocus': o.active || o.id === current || undefined,
        onclick: () => { res = o; m.close(); },
      }, h('span', o.label), o.hint && h('small.muted', o.hint), (o.active || o.id === current) && h('span.check', { html: icon('check') })))),
    ], { className: 'small', onClose: () => resolve(res) });
  });
}

export function pinDialog(title = 'Enter PIN') {
  return new Promise((resolve) => {
    let v = '';
    const dots = h('div.pin-dots');
    const draw = () => { dots.innerHTML = [0, 1, 2, 3].map((i) => `<i class="${i < v.length ? 'on' : ''}"></i>`).join(''); };
    draw();
    const press = (d) => {
      if (d === '⌫') v = v.slice(0, -1); else if (v.length < 4) v += d;
      draw();
      if (v.length === 4) setTimeout(() => { res = v; m.close(); }, 120);
    };
    let res = null;
    const pad = h('div.pinpad', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d) => d ? h('button.btn.key', { onclick: () => press(d) }, d) : h('span')));
    const m = modal([h('h2', title), dots, pad], { className: 'small', onClose: () => { un(); resolve(res); } });
    const un = nav.push((k, e) => { if (k === 'digit') { press(e.key); return true; } return false; });
  });
}

export function spinner(text = '') {
  return h('div.loading', h('div.spinner'), text && h('span', text));
}
