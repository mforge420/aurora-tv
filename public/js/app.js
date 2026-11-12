import { h, fmtClock, store, clockCfg } from './util.js';
import { nav } from './nav.js';
import { settings } from './settings.js';
import { lib } from './library.js';
import { detectProxy } from './net.js';
import { player } from './player.js';
import { icon, toast, confirmDialog } from './ui.js';
import { isNative, nativeApi } from './native.js';
import { autoCheck } from './updater.js';

const VIEWS = {
  live: { label: 'Live TV', icon: 'live', load: () => import('./views/live.js') },
  guide: { label: 'TV Guide', icon: 'guide', load: () => import('./views/guide.js') },
  movies: { label: 'Movies', icon: 'movie', load: () => import('./views/vod.js') },
  series: { label: 'Series', icon: 'series', load: () => import('./views/vod.js') },
  multiview: { label: 'Multi-view', icon: 'grid', load: () => import('./views/multiview.js') },
  search: { label: 'Search', icon: 'search', load: () => import('./views/search.js') },
  settings: { label: 'Settings', icon: 'settings', load: () => import('./views/settings.js') },
};

let current = null, currentName = '';
const viewEl = document.getElementById('view');
const rail = document.getElementById('rail');

function buildRail() {
  rail.replaceChildren(
    h('div.brand', { html: `<img src="/icons/icon.svg" alt=""><span>Lumora</span>` }),
    h('div.rail-items', Object.entries(VIEWS).map(([k, v]) =>
      h('button.rail-btn', { dataset: { view: k }, onclick: () => go(k), html: `${icon(v.icon)}<span>${v.label}</span>` }))),
    h('div.rail-foot', h('div.rail-clock#clock'), h('div.epg-status#epgstatus')),
  );
  rail.addEventListener('focusin', () => rail.classList.add('expanded'));
  rail.addEventListener('focusout', (e) => { if (!rail.contains(e.relatedTarget)) rail.classList.remove('expanded'); });
  rail.addEventListener('mouseenter', () => rail.classList.add('expanded'));
  rail.addEventListener('mouseleave', () => { if (!rail.contains(document.activeElement)) rail.classList.remove('expanded'); });
  // The expanded rail overlaps the view, so geometric navigation could jump to
  // elements hidden underneath it: move strictly between rail buttons instead.
  rail.__keys = (k) => {
    if (k === 'right') { focusView(); return true; }
    if (k === 'up' || k === 'down') {
      const btns = [...rail.querySelectorAll('.rail-btn')].filter((b) => b.offsetParent !== null);
      const i = btns.indexOf(document.activeElement);
      const next = btns[i + (k === 'down' ? 1 : -1)];
      if (next) next.focus();
      return true;
    }
    if (k === 'left') return true;
    return false;
  };
}

function focusView() {
  if (current?.focus) current.focus();
  else nav.focusFirst(viewEl);
}

export async function go(name, arg) {
  if (!VIEWS[name]) name = 'live';
  if (!lib.sources.length && !['settings'].includes(name)) name = 'welcome';
  if (name === currentName && !arg) { focusView(); return; }
  const mod = name === 'welcome' ? await import('./views/welcome.js') : await VIEWS[name].load();
  current?.destroy?.();
  if (player.mode === 'preview') player.attachPreview(null);
  currentName = name;
  viewEl.replaceChildren();
  viewEl.dataset.view = name;
  for (const b of rail.querySelectorAll('.rail-btn')) b.classList.toggle('active', b.dataset.view === name);
  current = mod.default(viewEl, { name, arg, go });
  viewEl.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (name !== 'settings' && name !== 'welcome') settings.set('lastView', name);
  requestAnimationFrame(() => focusView());
}

function tickClock() {
  const el = document.getElementById('clock');
  if (el) {
    const d = new Date();
    el.innerHTML = `<b>${fmtClock(d, { h12: !settings.get('clock24') })}</b><span>${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
  }
}

function applyTheme() {
  document.documentElement.dataset.accent = settings.get('accent');
  clockCfg.h12 = !settings.get('clock24');
}

nav.backHandler = () => {
  if (current?.back?.()) return;
  if (!rail.contains(document.activeElement)) { rail.querySelector('.rail-btn.active')?.focus(); return; }
  if (currentName !== 'live' && lib.sources.length) { go('live'); return; }
  if (isNative && !document.querySelector('.modal-wrap')) {
    confirmDialog('Exit Lumora TV?', null, { ok: 'Exit' }).then((yes) => yes && nativeApi.exit());
  }
};
nav.recover = () => {
  focusView();
  return viewEl.contains(document.activeElement);
};
nav.fallback = (k) => {
  if (k === 'guide') { go('guide'); return true; }
  if (k === 'search') { go('search'); return true; }
  return false;
};

async function boot() {
  applyTheme();
  settings.on('change:accent', applyTheme);
  settings.on('change:clock24', applyTheme);
  buildRail();
  tickClock(); setInterval(tickClock, 10000);
  player.init();
  navigator.storage?.persist?.().catch(() => {});
  await detectProxy();
  await lib.init();
  lib.on('epg-status', (s) => {
    const el = document.getElementById('epgstatus');
    if (!el) return;
    el.innerHTML = s.loading ? `<div class="spinner sm"></div><span>Updating guide${s.count ? ` · ${s.count.toLocaleString()}` : ''}</span>` : '';
  });
  window.addEventListener('go', (e) => go(e.detail));
  window.addEventListener('multiview', (e) => go('multiview', e.detail));
  window.addEventListener('resize', () => player.reposition());
  document.getElementById('boot').classList.add('done');
  setTimeout(() => document.getElementById('boot')?.remove(), 600);
  const start = settings.get('lastView');
  await go(start === 'multiview' ? 'live' : start || 'live');
  if (settings.get('startOnLastChannel')) {
    const ch = lib.byId.get(store.get('lastChannel'));
    if (ch) player.playChannel(ch, { list: lib.live });
  }
  // reminders
  setInterval(() => {
    const now = Date.now();
    for (const r of lib.reminders) {
      if (!r.fired && r.start - now < 60e3 && r.start - now > -300e3) {
        r.fired = true;
        const ch = lib.byId.get(r.ch);
        toast(`Starting now on ${ch?.name || 'TV'}: ${r.title}`, { icon: 'bell', ms: 8000 });
      }
    }
  }, 15000);
  if (isNative) setTimeout(() => autoCheck(), 6000);
  if (!isNative && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot().catch((e) => { console.error(e); document.body.append(h('pre.fatal', String(e.stack || e))); });
