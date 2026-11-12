// Remote-control-first spatial navigation & key normalisation.
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'ok', NumpadEnter: 'ok', ' ': 'space',
  Escape: 'back', BrowserBack: 'back', GoBack: 'back', XF86Back: 'back',
  PageUp: 'chup', PageDown: 'chdown', ChannelUp: 'chup', ChannelDown: 'chdown',
  MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
  MediaFastForward: 'ff', MediaRewind: 'rw', MediaTrackNext: 'next', MediaTrackPrevious: 'prev',
  ContextMenu: 'menu', F1: 'menu', Info: 'info', i: 'info', I: 'info',
  m: 'mute', M: 'mute', f: 'fullscreen', F: 'fullscreen', g: 'guide', G: 'guide', '/': 'search',
};
const CODEMAP = { 10009: 'back', 461: 'back', 8: 'back', 427: 'chup', 428: 'chdown', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw', 10252: 'playpause', 457: 'info', 18: 'menu' };

export function keyOf(e) {
  if (/^[0-9]$/.test(e.key)) return 'digit';
  if (e.key === 'Backspace') return 'back';
  return KEYMAP[e.key] || CODEMAP[e.keyCode] || null;
}

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex="0"],[data-f]';
const handlers = [];

export const nav = {
  /** Push a modal key handler; returns a remover. Handler(key, event) -> true if handled */
  push(fn) { handlers.push(fn); return () => { const i = handlers.indexOf(fn); if (i > -1) handlers.splice(i, 1); }; },
  backHandler: null,
  focus(el) {
    if (!el) return false;
    el.focus({ preventScroll: true });
    scrollIntoViewIfNeeded(el);
    return true;
  },
  focusFirst(root) {
    const g = root.querySelector('[data-autofocus]') || visibleFocusables(root)[0];
    return nav.focus(g);
  },
  /** Next focusable from `from` in `dir`, searching only inside `scope` (no focus change) */
  find(from, dir, scope) { return findNext(from, dir, scope); },
  move(dir, from = document.activeElement) {
    const scope = currentScope();
    if (!from || from === document.body || !scope.contains(from)) {
      // Focus was lost (element re-rendered): go back into the current screen, not the side menu
      if (scope.id === 'app' && nav.recover?.()) return true;
      return nav.focusFirst(scope);
    }
    const target = findNext(from, dir, scope);
    if (target) return nav.focus(rememberOrSelf(target, from));
    return false;
  },
};

function currentScope() {
  const modals = document.querySelectorAll('.modal-wrap:not(.closing)');
  if (modals.length) return modals[modals.length - 1];
  if (document.body.classList.contains('player-full')) return document.getElementById('player');
  return document.getElementById('app');
}

function visible(el) {
  if (el.closest('[inert],[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function visibleFocusables(root) { return [...root.querySelectorAll(FOCUSABLE)].filter(visible); }

function scrollIntoViewIfNeeded(el) {
  if (el.closest('.vlist')) return; // virtual list manages its own scroll
  // smooth scrolling stutters on TV hardware: jump instantly in the Android app
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.AuroraNative ? 'auto' : 'smooth' });
}

function rememberOrSelf(target, from) {
  const side = target.closest('[data-nav-side]');
  if (side && !side.contains(from)) return side.querySelector('.active') || target;
  const g = target.closest('[data-navgroup]');
  if (g && !g.contains(from) && g._last && g._last.isConnected && visible(g._last)) return g._last;
  if (g && !g.contains(from) && g._entry) { const e = g._entry(); if (e) return e; }
  return target;
}
document.addEventListener('focusin', (e) => {
  const g = e.target.closest?.('[data-navgroup]');
  if (g) g._last = e.target;
});

function findNext(from, dir, scope) {
  const fr = from.getBoundingClientRect();
  // The side menu ([data-nav-side]) is only entered deliberately, by pressing Left
  const fromSide = !!from.closest('[data-nav-side]');
  const fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of scope.querySelectorAll(FOCUSABLE)) {
    if (el === from || from.contains(el)) continue;
    if (!fromSide && dir !== 'left' && el.closest('[data-nav-side]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (el.closest('[inert],[hidden]')) continue;
    let primary, ortho;
    switch (dir) {
      case 'left': primary = fr.left - r.right; ortho = overlapDist(fr.top, fr.bottom, r.top, r.bottom, fy, r); if (r.left >= fr.left - 1) continue; break;
      case 'right': primary = r.left - fr.right; ortho = overlapDist(fr.top, fr.bottom, r.top, r.bottom, fy, r); if (r.right <= fr.right + 1) continue; break;
      case 'up': primary = fr.top - r.bottom; ortho = overlapDist(fr.left, fr.right, r.left, r.right, fx, r, true); if (r.top >= fr.top - 1) continue; break;
      case 'down': primary = r.top - fr.bottom; ortho = overlapDist(fr.left, fr.right, r.left, r.right, fx, r, true); if (r.bottom <= fr.bottom + 1) continue; break;
    }
    primary = Math.max(primary, 0);
    const score = primary + ortho * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}
function overlapDist(a1, a2, b1, b2) {
  if (b2 >= a1 && b1 <= a2) return 0; // overlapping on the orthogonal axis
  return b1 > a2 ? b1 - a2 : a1 - b2;
}

document.addEventListener('keydown', (e) => {
  const key = keyOf(e);
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) && ae.type !== 'checkbox' && ae.type !== 'range';
  if (typing) {
    if (e.key === 'Escape') { ae.blur(); e.preventDefault(); return; }
    if (e.key === 'Backspace' || e.key.length === 1 || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    if (e.key === 'Enter' && ae.form == null && ae.dataset.enter !== 'nav') return;
  }
  if (!key) return;
  if (key === 'back' && e.key === 'Backspace' && typing) return;
  // 1. modal handlers (fullscreen player etc)
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i](key, e)) { e.preventDefault(); return; }
  }
  // 2. component handlers
  for (let el = ae; el && el !== document.body; el = el.parentElement) {
    if (el.__keys && el.__keys(key, e)) { e.preventDefault(); return; }
  }
  // 3. defaults
  if (key === 'up' || key === 'down' || key === 'left' || key === 'right') {
    if (ae?.type === 'range' && (key === 'left' || key === 'right')) return;
    e.preventDefault();
    nav.move(key);
  } else if (key === 'ok') {
    if (!e.isTrusted && ae && ae !== document.body && ae.tagName !== 'INPUT') { e.preventDefault(); ae.click(); return; }
    if (ae && ae !== document.body && !(ae.tagName === 'BUTTON' || ae.tagName === 'A' || ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) { e.preventDefault(); ae.click(); }
  } else if (key === 'back') {
    e.preventDefault();
    nav.backHandler?.();
  } else if (nav.fallback?.(key, e)) e.preventDefault();
}, true);
