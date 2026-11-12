import { h, esc, logoEl, rem } from '../util.js';
import { Engine } from '../engine.js';
import { lib } from '../library.js';
import { player } from '../player.js';
import { icon, modal, toast, choose } from '../ui.js';
import { VList } from '../vlist.js';
import { nav } from '../nav.js';

export default function multiview(root, { arg }) {
  let layout = 4;
  const tiles = [];
  let audioIdx = 0;
  const gridEl = h('div.mv-grid');
  const layoutBtn = h('button.chip-btn', { onclick: () => { layout = layout === 4 ? 2 : layout === 2 ? 3 : 4; draw(); } });
  const usageEl = h('div.mv-usage');
  root.append(h('div.mv-layout', h('div.mv-head', h('h2', 'Multi-view'), h('span.muted.small', 'Focus a screen to hear it · OK to pick a channel · Hold OK for options'), h('span.spacer'), usageEl, layoutBtn), gridEl));
  gridEl.dataset.longpress = '';

  // ---- per-playlist stream limits (providers allow N streams per account)
  const used = (srcId, exceptTile = -1) => tiles.filter((t, j) => t.ch && t.ch.src === srcId && j !== exceptTile).length;
  const limit = (srcId) => lib.maxStreams(lib.source(srcId));
  function drawUsage() {
    usageEl.replaceChildren(...(lib.sources.length ? lib.sources : []).map((s) => {
      const u = used(s.id), l = limit(s.id);
      return h('span.mv-use' + (u >= l ? '.full' : ''), { title: `${s.name}: ${u} of ${l} streams in use` }, h('b', s.name), ` ${u}/${l}`);
    }));
  }

  for (let i = 0; i < 4; i++) {
    const video = h('video', { playsinline: true, muted: true });
    const engine = new Engine(video);
    const label = h('div.mv-label');
    const state = h('div.mv-state');
    const el = h('button.mv-tile', { onclick: () => pick(i), onfocus: () => setAudio(i) }, video, state, label,
      h('div.mv-empty', { html: `${icon('plus')}<span>Add channel</span>` }));
    engine.on('state', (s) => { state.innerHTML = s === 'loading' || s === 'buffering' || s === 'reconnecting' ? '<div class="spinner"></div>' : s === 'error' ? `<span>${icon('tv')} Unavailable</span>` : ''; });
    el.__keys = (k) => { if (k === 'menu' || k === 'info' || k === 'longok') { tileMenu(i); return true; } return false; };
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); tileMenu(i); });
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
    const srcName = lib.sources.length > 1 ? lib.source(ch.src)?.name : '';
    t.label.replaceChildren(logoEl(ch.logo, ch.name, 'logo sm'), h('span', ch.name), srcName ? h('em.mv-from', srcName) : null);
    t.engine.load(lib.liveUrl(ch), { live: true, ua: ch.ua, ref: ch.ref, preview: true });
    setAudio(audioIdx);
    drawUsage();
  }
  function clear(i) {
    const t = tiles[i];
    t.engine.stop(); t.ch = null; t.el.classList.remove('filled', 'audio'); t.label.replaceChildren();
    drawUsage();
  }
  async function tileMenu(i) {
    const t = tiles[i];
    if (!t.ch) return pick(i);
    const c = await choose(`Screen ${i + 1} · ${t.ch.name}`, [
      { id: 'change', label: 'Change channel' },
      { id: 'full', label: 'Watch fullscreen' },
      { id: 'remove', label: 'Remove from multi-view' },
    ]);
    if (c?.id === 'change') pick(i);
    if (c?.id === 'remove') clear(i);
    if (c?.id === 'full') { const ch = t.ch; tiles.forEach((_, j) => clear(j)); player.playChannel(ch, { list: lib.channelsOf(ch.src) }); }
  }
  function pick(i) {
    const mine = tiles[i].ch?.src;
    // start on: this screen's playlist, else the active one if it has room, else any with room
    const hasRoom = (id) => used(id, i) < limit(id);
    let srcId = mine || [lib.activeId(), ...lib.sources.map((s) => s.id)].find((id) => id !== 'all' && lib.source(id) && hasRoom(id)) || lib.sources[0]?.id;
    let all = [], filtered = [];
    const q = h('input', { type: 'search', placeholder: 'Filter channels…', 'data-enter': 'nav' });
    const chips = h('div.mv-srcs', { 'data-navgroup': '' });
    const note = h('p.mv-note');
    const vl = new VList({
      rowHeight: rem(3.75), className: 'pick-list',
      render: (ch, j, el) => { el.className = 'vrow chrow' + (j === vl.index ? ' current' : ''); el.innerHTML = `<span class="num">${ch.num}</span><span class="lg"></span><span class="meta"><b>${esc(ch.name)}</b><small>${esc(lib.nowNext(ch)[0]?.title || ch.group)}</small></span>`; el.querySelector('.lg').append(logoEl(ch.logo, ch.name)); },
      onActivate: (ch) => choose_(ch),
    });
    function choose_(ch) {
      if (!ch) return;
      if (!hasRoom(ch.src)) { toast(`${lib.source(ch.src)?.name}: ${limit(ch.src) > 1 ? `all ${limit(ch.src)} streams are` : 'its one stream is'} in use. Pick another playlist or change the screen that uses it.`, { type: 'error', ms: 6000 }); return; }
      m.close(); load(i, ch); tiles[i].el.focus();
    }
    function drawChips() {
      chips.replaceChildren(...lib.sources.map((s) => {
        const u = used(s.id, i), l = limit(s.id), full = u >= l;
        return h('button.chip-btn.mv-src' + (s.id === srcId ? '.on' : '') + (full ? '.full' : ''), { onclick: () => setSrc(s.id) },
          h('span', s.name), h('small', full ? `full ${u}/${l}` : `${u}/${l} in use`));
      }));
      chips.hidden = lib.sources.length < 2;
      const s = lib.source(srcId);
      note.textContent = s && !hasRoom(srcId)
        ? (limit(srcId) > 1 ? `All ${limit(srcId)} streams of “${s.name}” are in use on other screens.` : `“${s.name}” allows one stream and it's in use on another screen.`) + ' Pick another playlist, or change the screen that uses it.'
        : '';
      note.hidden = !note.textContent;
    }
    function setSrc(id) {
      srcId = id;
      all = lib.channelsOf(id);
      const t = q.value.toLowerCase();
      filtered = t ? all.filter((c) => c.name.toLowerCase().includes(t)) : all;
      drawChips();
      vl.setItems(filtered, Math.max(0, filtered.findIndex((c) => c.id === tiles[i].ch?.id)));
    }
    q.addEventListener('input', () => { const t = q.value.toLowerCase(); filtered = all.filter((c) => c.name.toLowerCase().includes(t)); vl.setItems(filtered); });
    q.__keys = (k) => {
      if (k === 'down') { vl.focus(); return true; }
      if (k === 'up' && !chips.hidden) { nav.focus(chips.querySelector('.on') || chips.firstChild); return true; }
      if (k === 'ok' && vl.current) { choose_(vl.current); return true; }
      return false;
    };
    chips.__keys = (k) => { if (k === 'down') { q.focus(); return true; } return false; };
    const m = modal([h('h2', `Screen ${i + 1}`), chips, note, q, vl.el], { className: 'picker' });
    setSrc(srcId);
    setTimeout(() => vl.focus(), 60);
  }
  draw();
  drawUsage();
  const start = arg || (player.kind === 'live' ? player.item : null);
  if (player.mode !== 'hidden') player.stop();
  if (start) { load(0, start); toast('Pick channels for the other screens', { icon: 'grid' }); }
  return {
    focus: () => nav.focus(tiles[audioIdx].el),
    destroy: () => tiles.forEach((t) => t.engine.destroy()),
  };
}
