import { h, esc, logoEl, rem } from '../util.js';
import { Engine } from '../engine.js';
import { lib } from '../library.js';
import { player } from '../player.js';
import { icon, modal, toast } from '../ui.js';
import { VList } from '../vlist.js';
import { nav } from '../nav.js';

export default function multiview(root, { arg }) {
  let layout = 4;
  const tiles = [];
  let audioIdx = 0;
  const gridEl = h('div.mv-grid');
  const layoutBtn = h('button.chip-btn', { onclick: () => { layout = layout === 4 ? 2 : layout === 2 ? 3 : 4; draw(); } });
  root.append(h('div.mv-layout', h('div.mv-head', h('h2', 'Multi-view'), h('span.muted.small', 'Focus a tile to hear it · OK to pick a channel · Menu to remove'), h('span.spacer'), layoutBtn), gridEl));

  for (let i = 0; i < 4; i++) {
    const video = h('video', { playsinline: true, muted: true });
    const engine = new Engine(video);
    const label = h('div.mv-label');
    const state = h('div.mv-state');
    const el = h('button.mv-tile', { onclick: () => pick(i), onfocus: () => setAudio(i) }, video, state, label,
      h('div.mv-empty', { html: `${icon('plus')}<span>Add channel</span>` }));
    engine.on('state', (s) => { state.innerHTML = s === 'loading' || s === 'buffering' || s === 'reconnecting' ? '<div class="spinner"></div>' : s === 'error' ? `<span>${icon('tv')} Unavailable</span>` : ''; });
    el.__keys = (k) => { if (k === 'menu' || k === 'info') { clear(i); return true; } return false; };
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); clear(i); });
    gridEl.append(el);
    tiles.push({ el, video, engine, label, ch: null });
  }
  function draw() {
    gridEl.dataset.layout = layout;
    layoutBtn.innerHTML = icon('grid') + `<span>${layout} screens</span>`;
    tiles.forEach((t, i) => { t.el.hidden = i >= layout; if (i >= layout && t.ch) clear(i); });
  }
  function setAudio(i) {
    audioIdx = i;
    tiles.forEach((t, j) => { t.video.muted = j !== i; t.el.classList.toggle('audio', j === i && !!t.ch); });
  }
  function load(i, ch) {
    const t = tiles[i];
    t.ch = ch; t.el.classList.add('filled');
    t.label.replaceChildren(logoEl(ch.logo, ch.name, 'logo sm'), h('span', ch.name));
    t.engine.load(lib.liveUrl(ch), { live: true, ua: ch.ua, ref: ch.ref, preview: true });
    setAudio(audioIdx);
  }
  function clear(i) {
    const t = tiles[i];
    t.engine.stop(); t.ch = null; t.el.classList.remove('filled', 'audio'); t.label.replaceChildren();
  }
  function pick(i) {
    let filtered = lib.live;
    const q = h('input', { type: 'search', placeholder: 'Filter channels…', 'data-enter': 'nav' });
    const vl = new VList({
      rowHeight: rem(3.75), className: 'pick-list',
      render: (ch, j, el) => { el.className = 'vrow chrow' + (j === vl.index ? ' current' : ''); el.innerHTML = `<span class="num">${ch.num}</span><span class="lg"></span><span class="meta"><b>${esc(ch.name)}</b><small>${esc(lib.nowNext(ch)[0]?.title || ch.group)}</small></span>`; el.querySelector('.lg').append(logoEl(ch.logo, ch.name)); },
      onActivate: (ch) => { m.close(); load(i, ch); tiles[i].el.focus(); },
    });
    q.addEventListener('input', () => { const s = q.value.toLowerCase(); filtered = lib.live.filter((c) => c.name.toLowerCase().includes(s)); vl.setItems(filtered); });
    q.__keys = (k) => {
      if (k === 'down') { vl.focus(); return true; }
      if (k === 'ok' && vl.current) { m.close(); load(i, vl.current); tiles[i].el.focus(); return true; }
      return false;
    };
    const m = modal([h('h2', `Screen ${i + 1}`), q, vl.el], { className: 'picker' });
    vl.setItems(filtered, Math.max(0, filtered.findIndex((c) => c.id === tiles[i].ch?.id)));
    setTimeout(() => vl.focus(), 60);
  }
  draw();
  const start = arg || (player.kind === 'live' ? player.item : null);
  if (player.mode !== 'hidden') player.stop();
  if (start) { load(0, start); toast('Pick channels for the other screens', { icon: 'grid' }); }
  return {
    focus: () => nav.focus(tiles[audioIdx].el),
    destroy: () => tiles.forEach((t) => t.engine.destroy()),
  };
}
