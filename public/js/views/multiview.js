import { h, esc, logoEl, rem } from '../util.js';
import { Engine } from '../engine.js';
import { lib } from '../library.js';
import { player } from '../player.js';
import { icon, modal, toast, choose } from '../ui.js';
import { VList } from '../vlist.js';
import { nav } from '../nav.js';
import { isNative, NativeTileEngine, nativeApi } from '../native.js';
import { FAV_GROUP, RECENT_GROUP, ALL_GROUP } from '../library.js';

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
    // In the app every screen gets its own hardware player (far lighter than decoding in the web layer)
    const engine = isNative ? new NativeTileEngine(i) : new Engine(video);
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
    requestAnimationFrame(placeAll);
  }
  function setAudio(i) {
    audioIdx = i;
    tiles.forEach((t, j) => {
      t.video.muted = j !== i;
      if (isNative && t.ch) t.engine.setVolume(j === i ? 1 : 0);
      t.el.classList.toggle('audio', j === i && !!t.ch);
    });
  }
  /** Native surfaces sit under the page: keep each one exactly behind its screen */
  function placeAll() {
    if (!isNative) return;
    tiles.forEach((t, j) => {
      if (!t.ch || t.el.hidden) return t.engine.setRect?.(null);
      const r = t.el.getBoundingClientRect(), b = 2; // inside the border
      t.engine.setRect({ left: r.left + b, top: r.top + b, width: r.width - 2 * b, height: r.height - 2 * b });
    });
  }
  const ro = new ResizeObserver(() => placeAll()); ro.observe(gridEl);
  if (isNative) document.body.classList.add('has-video', 'mv-native');
  function load(i, ch) {
    const t = tiles[i];
    t.ch = ch; t.el.classList.add('filled');
    const srcName = lib.sources.length > 1 ? lib.source(ch.src)?.name : '';
    t.label.replaceChildren(...[logoEl(ch.logo, ch.name, 'logo sm'), h('span', ch.name), srcName ? h('em.mv-from', srcName) : null].filter(Boolean));
    t.engine.load(lib.liveUrl(ch), { live: true, ua: ch.ua, ref: ch.ref, preview: true, tile: true });
    setAudio(audioIdx);
    requestAnimationFrame(placeAll);
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
    const hasRoom = (id) => used(id, i) < limit(id);
    let srcId = mine || [lib.activeId(), ...lib.sources.map((s) => s.id)].find((id) => id !== 'all' && lib.source(id) && hasRoom(id)) || lib.sources[0]?.id;
    let group = ALL_GROUP, all = [], filtered = [];
    const q = h('input', { type: 'search', placeholder: 'Search this playlist…', 'data-enter': 'nav' });
    const chips = h('div.mv-srcs', { 'data-navgroup': '' });
    const note = h('p.mv-note');
    const gl = new VList({
      rowHeight: rem(3), className: 'groups pick-groups',
      render: (g, j, el) => { el.classList.toggle('selected', g.name === group); el.innerHTML = `${g.special ? icon(g.special) : '<span class="gdot"></span>'}<span class="gname">${esc(g.name.replace(/^[★⟲] /, ''))}</span><span class="gcount">${g.count.toLocaleString()}</span>`; },
      onFocus: (g) => { if (g && g.name !== group) setGroup(g.name); },
      onActivate: (g) => { setGroup(g.name); vl.focus(); },
      keys: (k) => { if (k === 'right') { vl.focus(); return true; } return false; },
    });
    const vl = new VList({
      rowHeight: rem(3.75), className: 'pick-list', empty: 'No channels here',
      render: (ch, j, el) => { el.className = 'vrow chrow' + (j === vl.index ? ' current' : ''); el.innerHTML = `<span class="num">${ch.num}</span><span class="lg"></span><span class="meta"><b>${esc(ch.name)}</b><small>${esc(lib.nowNext(ch)[0]?.title || ch.group)}</small></span>`; el.querySelector('.lg').append(logoEl(ch.logo, ch.name)); },
      onActivate: (ch) => choose_(ch),
      keys: (k) => { if (k === 'left') { gl.focus(); return true; } return false; },
    });
    function choose_(ch) {
      if (!ch) return;
      if (!hasRoom(ch.src)) { toast(`${lib.source(ch.src)?.name}: ${limit(ch.src) > 1 ? `all ${limit(ch.src)} streams are` : 'its one stream is'} in use. Pick another playlist or change the screen that uses it.`, { type: 'error', ms: 6000 }); return; }
      m.close(); load(i, ch); tiles[i].el.focus();
    }
    function groupsOf(id) {
      const chans = lib.channelsOf(id), counts = new Map();
      for (const c of chans) counts.set(c.group, (counts.get(c.group) || 0) + 1);
      const favs = chans.filter((c) => lib.isFav(c.id)).length;
      const recent = lib.recentChannels(40).filter((c) => c.src === id).length;
      return [
        ...(favs ? [{ name: FAV_GROUP, count: favs, special: 'star' }] : []),
        ...(recent ? [{ name: RECENT_GROUP, count: recent, special: 'history' }] : []),
        { name: ALL_GROUP, count: chans.length, special: 'tv' },
        ...[...counts].map(([name, count]) => ({ name, count })),
      ];
    }
    function listFor() {
      const t = q.value.trim().toLowerCase();
      if (t) return all.filter((c) => c.name.toLowerCase().includes(t)); // search covers the whole playlist
      if (group === FAV_GROUP) return all.filter((c) => lib.isFav(c.id));
      if (group === RECENT_GROUP) return lib.recentChannels(40).filter((c) => c.src === srcId);
      if (group === ALL_GROUP) return all;
      return all.filter((c) => c.group === group);
    }
    function setGroup(g) { group = g; filtered = listFor(); vl.setItems(filtered, Math.max(0, filtered.findIndex((c) => c.id === tiles[i].ch?.id))); gl.refresh(); }
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
      const groups = groupsOf(id);
      const cur = tiles[i].ch && tiles[i].ch.src === id ? tiles[i].ch.group : null;
      group = cur && groups.some((g) => g.name === cur) ? cur : ALL_GROUP;
      gl.setItems(groups, Math.max(0, groups.findIndex((g) => g.name === group)));
      drawChips();
      setGroup(group);
    }
    q.addEventListener('input', () => { filtered = listFor(); vl.setItems(filtered); });
    q.__keys = (k) => {
      if (k === 'down') { vl.focus(); return true; }
      if (k === 'up' && !chips.hidden) { nav.focus(chips.querySelector('.on') || chips.firstChild); return true; }
      if (k === 'ok' && vl.current) { choose_(vl.current); return true; }
      return false;
    };
    chips.__keys = (k) => { if (k === 'down') { gl.focus(); return true; } return false; };
    const m = modal([h('h2', `Screen ${i + 1}`), chips, note, q, h('div.pick-cols', gl.el, vl.el)], { className: 'picker wide' });
    setSrc(srcId);
    setTimeout(() => (tiles[i].ch ? vl.focus() : gl.focus()), 60);
  }
  draw();
  drawUsage();
  const start = arg || (player.kind === 'live' ? player.item : null);
  if (player.mode !== 'hidden') player.stop();
  if (start) { load(0, start); toast('Pick channels for the other screens', { icon: 'grid' }); }
  return {
    focus: () => nav.focus(tiles[audioIdx].el),
    destroy: () => {
      tiles.forEach((t) => t.engine.destroy());
      ro.disconnect();
      if (isNative) { document.body.classList.remove('has-video', 'mv-native'); try { nativeApi.mvReleaseAll(); } catch {} }
    },
  };
}
