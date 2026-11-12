import { h, esc, logoEl, fmtClock, fmtMins, clamp, store, debounce, rem } from '../util.js';
import { VList } from '../vlist.js';
import { lib, FAV_GROUP, RECENT_GROUP, ALL_GROUP } from '../library.js';
import { player } from '../player.js';
import { settings } from '../settings.js';
import { icon, toast, choose } from '../ui.js';
import { nav } from '../nav.js';

export default function liveView(root, { go }) {
  let group = store.get('liveGroup', ALL_GROUP);
  let channels = [];
  let focused = null;
  const groupsList = () => [
    { name: FAV_GROUP, count: lib.live.filter((c) => lib.favs.has(c.id)).length, special: 'star' },
    { name: RECENT_GROUP, count: lib.recents.filter((id) => lib.byId.has(id)).length, special: 'history' },
    { name: ALL_GROUP, count: lib.live.length, special: 'tv' },
    ...lib.liveGroups,
  ];

  // ---------- groups ----------
  const gl = new VList({
    rowHeight: rem(3.25), className: 'groups',
    render: (g, i, el) => {
      el.classList.toggle('selected', g.name === group);
      el.innerHTML = `${g.special ? icon(g.special) : (lib.isLocked(g.name) ? icon('lock') : '<span class="gdot"></span>')}<span class="gname">${esc(g.name.replace(/^[★⟲] /, ''))}</span><span class="gcount">${g.count.toLocaleString()}</span>`;
    },
    onFocus: debounce((g) => { if (g && g.name !== group) selectGroup(g.name, false); }, 160),
    onActivate: (g) => { selectGroup(g.name, false); cl.focus(); },
    keys: (k) => { if (k === 'right') { cl.focus(); return true; } return false; },
  });

  // ---------- channels ----------
  const cl = new VList({
    rowHeight: rem(4.75), className: 'channels', empty: 'No channels in this group',
    render: (ch, i, el) => renderChannelRow(ch, el),
    onFocus: (ch) => { focused = ch; updateInfo(ch); schedulePreview(ch); },
    onActivate: (ch, i, e) => activate(ch, e),
    keys: (k, e, ch) => {
      if (k === 'left') { gl.focus(); return true; }
      if (k === 'right') { infoPanel.querySelector('button')?.focus(); return true; }
      if (k === 'menu' || k === 'longok') { contextMenu(ch); return true; }
      if (k === 'digit') { jumpDigit(e.key); return true; }
      return false;
    },
  });
  cl.el.dataset.longpress = '';
  cl.el.addEventListener('dblclick', (e) => { const r = e.target.closest('.vrow'); if (r) player.playChannel(cl.items[+r.dataset.i], { list: channels }); });
  cl.el.addEventListener('contextmenu', (e) => { const r = e.target.closest('.vrow'); if (r) { e.preventDefault(); contextMenu(cl.items[+r.dataset.i]); } });

  function renderChannelRow(ch, el) {
    const [now] = lib.nowNext(ch);
    const pct = now ? clamp((Date.now() - now.start) / (now.stop - now.start), 0, 1) * 100 : 0;
    const playing = player.isPlaying(ch.id);
    el.className = 'vrow chrow' + (playing ? ' playing' : '') + (cl.items[cl.index] === ch ? ' current' : '');
    el.innerHTML = `
      <span class="num">${settings.get('showChannelNumbers') ? ch.num : ''}</span>
      <span class="lg"></span>
      <span class="meta">
        <b>${esc(ch.name)}${ch.catchup ? `<i class="badge cu" title="Catch-up">${icon('rewind')}</i>` : ''}</b>
        <small>${now ? `<span class="t">${fmtClock(now.start)}</span> ${esc(now.title)}` : '<span class="muted">No information</span>'}</small>
        ${now ? `<span class="mini-bar"><i style="width:${pct}%"></i></span>` : ''}
      </span>
      ${lib.isFav(ch.id) ? `<span class="fav">${icon('star')}</span>` : ''}
      ${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}`;
    el.querySelector('.lg').append(logoEl(ch.logo, ch.name));
  }

  // ---------- info / preview panel ----------
  const slot = h('div.preview-slot', { onclick: () => focused && player.playChannel(focused, { list: channels }) },
    h('div.preview-ph', { html: `${icon('tv')}<span>Select a channel to preview</span>` }));
  const infoPanel = h('div.info-body');
  const panel = h('section.live-info', slot, infoPanel);

  function updateInfo(ch) {
    if (!ch) { infoPanel.replaceChildren(); return; }
    const [now, next] = lib.nowNext(ch);
    const upcoming = lib.programmes(ch, Date.now(), Date.now() + 12 * 3600e3).slice(1, 5);
    const pct = now ? clamp((Date.now() - now.start) / (now.stop - now.start), 0, 1) * 100 : 0;
    const fav = lib.isFav(ch.id);
    infoPanel.innerHTML = `
      <div class="info-ch"><span class="lg"></span><div><div class="muted small">${settings.get('showChannelNumbers') ? ch.num + ' · ' : ''}${esc(ch.group)}</div><h2>${esc(ch.name)}</h2></div></div>
      ${now ? `
        <div class="info-now">
          <div class="row gap"><span class="live-pill">NOW</span><span class="muted">${fmtClock(now.start)} – ${fmtClock(now.stop)} · ${fmtMins((now.stop - Date.now()) / 60000)} left</span></div>
          <h3>${esc(now.title)} ${now.ep ? `<span class="ep">${esc(now.ep)}</span>` : ''}</h3>
          <div class="bar"><i style="width:${pct}%"></i></div>
          ${now.desc ? `<p class="desc">${esc(now.desc)}</p>` : ''}
          ${now.cat ? `<span class="chip">${esc(now.cat)}</span>` : ''}
        </div>` : `<p class="muted">No programme information for this channel.</p>`}
      ${upcoming.length ? `<div class="info-next"><div class="label">Up next</div>${upcoming.map((p) => `<div class="nx"><span>${fmtClock(p.start)}</span><b>${esc(p.title)}</b></div>`).join('')}</div>` : ''}
      <div class="info-actions"></div>`;
    infoPanel.querySelector('.lg').append(logoEl(ch.logo, ch.name, 'logo lg'));
    const acts = infoPanel.querySelector('.info-actions');
    acts.append(
      h('button.btn.primary', { onclick: () => player.playChannel(ch, { list: channels }), html: icon('play') + '<span>Watch</span>' }),
      h('button.btn.ghost' + (fav ? '.on' : ''), { onclick: () => { lib.toggleFav(ch.id); updateInfo(ch); cl.refresh(); }, html: icon('star') + `<span>${fav ? 'Favorited' : 'Favorite'}</span>` }),
      h('button.btn.ghost', { onclick: () => go('guide', { channel: ch.id, group }), html: icon('guide') + '<span>Guide</span>' }),
    );
    acts.__keys = (k) => { if (k === 'left' && document.activeElement === acts.firstElementChild) { cl.focus(); return true; } return false; };
  }

  let previewT;
  function schedulePreview(ch) {
    clearTimeout(previewT);
    if (!settings.get('previewAutoplay') || player.mode === 'full') return;
    previewT = setTimeout(() => { if (focused === ch && player.mode !== 'full') player.playChannel(ch, { list: channels, preview: true }); }, 650);
  }
  function activate(ch) {
    clearTimeout(previewT);
    // OK on the channel that's already in the preview → fullscreen; otherwise preview it.
    if (player.isPlaying(ch.id) && player.mode === 'preview' && player.state !== 'error') player.fullscreen();
    else if (window.matchMedia('(pointer: coarse)').matches) player.playChannel(ch, { list: channels }); // touch: straight to fullscreen
    else player.playChannel(ch, { list: channels, preview: true });
  }

  let digitBuf = '', digitT;
  function jumpDigit(d) {
    digitBuf += d; clearTimeout(digitT);
    toast('Channel ' + digitBuf, { ms: 1200 });
    digitT = setTimeout(() => {
      const n = +digitBuf; digitBuf = '';
      let i = channels.findIndex((c) => c.num === n);
      if (i === -1) { const ch = lib.live.find((c) => c.num === n); if (ch) { selectGroup(ALL_GROUP, true); i = channels.indexOf(ch); } }
      if (i > -1) cl.focusIndex(i, 'center');
    }, 1200);
  }

  async function contextMenu(ch) {
    if (!ch) return;
    const fav = lib.isFav(ch.id);
    const c = await choose(ch.name, [
      { id: 'play', label: 'Watch fullscreen' },
      { id: 'fav', label: fav ? 'Remove from favorites' : 'Add to favorites' },
      { id: 'guide', label: 'Open in TV guide' },
      { id: 'multi', label: 'Add to multi-view' },
      { id: 'hide', label: `Hide group “${ch.group}”` },
    ]);
    if (!c) return;
    if (c.id === 'play') player.playChannel(ch, { list: channels });
    if (c.id === 'fav') { lib.toggleFav(ch.id); cl.refresh(); updateInfo(ch); gl.refresh(); }
    if (c.id === 'guide') go('guide', { channel: ch.id, group });
    if (c.id === 'multi') go('multiview', ch);
    if (c.id === 'hide') { settings.set('hiddenGroups', [...settings.get('hiddenGroups'), ch.group]); lib.rebuild(); toast('Group hidden · restore it in Settings'); }
  }

  function selectGroup(name, keepFocus) {
    if (lib.isLocked(name)) {
      import('../ui.js').then(async ({ pinDialog }) => {
        if (player.unlocked?.has(name)) return doSelect(name, keepFocus);
        const pin = await pinDialog('Locked group · Enter PIN');
        if (pin === settings.get('parentalPin')) { (player.unlocked ||= new Set()).add(name); doSelect(name, keepFocus); }
        else if (pin) toast('Wrong PIN', { type: 'error' });
      });
      return;
    }
    doSelect(name, keepFocus);
  }
  function doSelect(name, keepFocus) {
    group = name; store.set('liveGroup', name);
    channels = lib.channelsIn(name);
    header.querySelector('.hname').textContent = name.replace(/^[★⟲] /, '');
    header.querySelector('.hcount').textContent = channels.length.toLocaleString() + ' channels';
    const playingIdx = channels.findIndex((c) => player.isPlaying(c.id));
    cl.setItems(channels, playingIdx > -1 ? playingIdx : 0);
    gl.refresh();
    if (keepFocus) cl.focus();
  }

  const header = h('div.col-head', h('button.mobile-only.chip-btn', { onclick: async () => { const c = await choose('Groups', groupsList().map((g) => ({ id: g.name, label: g.name, hint: String(g.count), active: g.name === group }))); if (c) selectGroup(c.id); }, html: icon('list') }), h('div', h('div.hname'), h('div.hcount.muted')),
    h('button.icon-btn', { title: 'Search channels', onclick: () => go('search'), html: icon('search') }));

  root.append(h('div.live-layout',
    h('section.col.groups-col', h('div.col-head', h('div', h('div.hname', 'Groups'), lib.sources.length > 1 ? h('div.hcount.muted', lib.activeName()) : null)), gl.el),
    h('section.col.channels-col', header, cl.el),
    panel));

  const groups = groupsList();
  gl.setItems(groups, Math.max(0, groups.findIndex((g) => g.name === group)));
  if (!groups.some((g) => g.name === group)) group = ALL_GROUP;
  doSelect(group, false);
  if (!channels.length && group !== ALL_GROUP) doSelect(ALL_GROUP, false);
  if (!channels.length && group === FAV_GROUP) doSelect(ALL_GROUP, false);

  // preview positioning
  player.attachPreview(slot);
  const ro = new ResizeObserver(() => player.reposition()); ro.observe(slot);
  const onPlayer = () => { cl.refresh(); };
  window.addEventListener('player-change', onPlayer);
  const offEpg = lib.on('epg', () => { cl.refresh(); updateInfo(focused); });
  const offChange = lib.on('change', () => { const g = groupsList(); gl.setItems(g, gl.index); doSelect(group, false); });
  const tick = setInterval(() => { cl.refresh(); if (document.activeElement?.closest('.channels')) updateInfo(focused); }, 30000);
  player.onExit = () => { cl.refresh(); const i = channels.findIndex((c) => player.isPlaying(c.id) || c.id === player.item?.id); if (i > -1) cl.focusIndex(i, 'center'); else cl.focus(); };

  return {
    focus: () => cl.focus(),
    back: () => {
      if (document.activeElement?.closest('.channels') && player.mode === 'preview') { player.stop(); cl.refresh(); return true; }
      if (document.activeElement?.closest('.channels')) { gl.focus(); return true; }
      return false;
    },
    destroy: () => { clearInterval(tick); clearTimeout(previewT); ro.disconnect(); offEpg(); offChange(); window.removeEventListener('player-change', onPlayer); player.onExit = null; },
  };
}
