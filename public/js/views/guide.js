import { h, esc, logoEl, fmtClock, fmtDay, fmtMins, clamp, store, rem, shortName, isDivider } from '../util.js';
import { lib, FAV_GROUP, RECENT_GROUP, ALL_GROUP, FAV_ALL_GROUP, RECENT_ALL_GROUP } from '../library.js';
import { player } from '../player.js';
import { settings } from '../settings.js';
import { icon, toast } from '../ui.js';
import { pickPlaylist } from '../app.js';

const SLOT = 30 * 60e3;
let ROW_H = 68, CH_W = 236;

export default function guideView(root, { arg, go }) {
  ROW_H = rem(5); CH_W = window.innerWidth < 800 ? rem(7) : rem(12.5);
  let group = arg?.group || store.get('liveGroup', ALL_GROUP);
  let rows = [];
  let rowIdx = 0;
  let focusT = Date.now();
  let viewStart = floorSlot(Date.now() - 30 * 60e3);
  const span = () => settings.get('guideHours') * 3600e3;
  const minT = () => floorSlot(Date.now() - 7 * 864e5);
  const maxT = () => Date.now() + 7 * 864e5;

  // ------- DOM -------
  const slot = h('div.preview-slot.small', { onclick: () => { const ch = rows[rowIdx]; if (ch) player.playChannel(ch, { list: rows }); } },
    h('div.preview-ph', { html: `${icon('tv')}<span>Preview</span>` }));
  const detail = h('div.g-detail');
  // playlist · group (top-right of the details) — press to switch group
  const groupBtn = h('button.g-group', { onclick: () => openPanel() });
  // day switcher above the channel column: ‹ Today ›
  const dayBtn = h('button.g-daybtn', { onclick: () => jumpTo(Date.now(), true) });
  const dayNav = h('div.g-daynav',
    h('button.g-dayarrow', { 'aria-label': 'Previous day', onclick: () => jumpTo(focusT - 864e5, true), html: icon('back') }),
    dayBtn,
    h('button.g-dayarrow', { 'aria-label': 'Next day', onclick: () => jumpTo(focusT + 864e5, true), html: icon('fwd') }));
  const timeline = h('div.g-timeline');
  const nowMark = h('i.g-nowmark');
  const body = h('div.g-body', { tabindex: 0 });
  const canvas = h('div.g-canvas');
  const nowLine = h('div.g-now');
  body.append(canvas);
  const grid = h('div.g-grid', h('div.g-head', h('div.g-corner', dayNav), h('div.g-tl-wrap', timeline, nowMark)), body, nowLine);
  // playlist panel: Left on the current programme slides it in, Left again opens the main menu
  const panel = h('div.g-panel', { dataset: { navgroup: '' } });
  root.append(h('div.guide-layout', h('div.g-top', slot, h('div.g-info', groupBtn, detail)), grid, panel));

  // ------- data -------
  function setGroup(g, keepChannel) {
    group = g;
    rows = lib.channelsIn(g);
    if (!rows.length && g !== ALL_GROUP) { group = ALL_GROUP; rows = lib.channelsIn(ALL_GROUP); }
    const pl = lib.sources.length > 1 ? lib.activeName() + ' · ' : '';
    groupBtn.innerHTML = `<span>${esc(pl + group.replace(/^[★⟲] /, ''))}</span>${icon('list')}`;
    canvas.style.height = rows.length * ROW_H + 'px';
    if (keepChannel) { const i = rows.findIndex((c) => c.id === keepChannel); rowIdx = i > -1 ? i : 0; } else rowIdx = 0;
    fitH = 0; fitRows(); centerRow();
    draw(); updateDetail();
  }
  const label = (g) => g.replace(/^[★⟲] /, '');
  function buildPanel() {
    const multi = lib.sources.length > 1;
    const item = (g, text = label(g)) => h('button.gp-item' + (g === group ? '.on' : ''), { dataset: { g }, onclick: () => { setGroup(g); closePanel(); } },
      h('span', text), g === group ? h('i', { html: icon('check') }) : null);
    const groups = lib.liveGroups.map((g) => item(g.name));
    panel.replaceChildren(
      h('div.gp-head', h('small', 'Playlist'),
        h('button.gp-item.gp-pl', { onclick: () => (multi ? pickPlaylist() : null) },
          h('i', { html: icon('list') }), h('span', lib.activeName() || 'Playlist'), multi ? h('i.ud', { html: icon('updown') }) : null)),
      h('button.gp-item.gp-search', { onclick: () => go('search') }, h('i', { html: icon('search') }), h('span', 'Search channels')),
      h('hr'),
      item(ALL_GROUP),
      ...(multi ? [item(FAV_ALL_GROUP, 'Favorites · all playlists')] : []),
      item(FAV_GROUP),
      ...(multi ? [item(RECENT_ALL_GROUP, 'Recents · all playlists')] : []),
      item(RECENT_GROUP, 'Recents'),
      h('hr'),
      h('small.gp-sec', lib.activeName() || 'Groups'),
      ...groups,
    );
  }
  function openPanel() {
    buildPanel();
    panel.classList.add('open');
    document.documentElement.classList.add('g-panel-open');
    panel.scrollTop = 0;
    const on = panel.querySelector('.gp-item.on') || panel.querySelector('.gp-item');
    on.focus({ preventScroll: true });
    if (on.offsetTop + on.offsetHeight > panel.clientHeight) panel.scrollTop = on.offsetTop - panel.clientHeight / 2;
  }
  function closePanel(focusBody = true) {
    panel.classList.remove('open');
    document.documentElement.classList.remove('g-panel-open');
    if (focusBody) body.focus({ preventScroll: true });
  }
  const railEl = document.getElementById('rail');
  panel.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && !panel.contains(to) && !railEl?.contains(to)) closePanel(false);
  });
  panel.__keys = (k) => {
    const btns = [...panel.querySelectorAll('.gp-item')];
    const i = btns.indexOf(document.activeElement);
    if (k === 'up' || k === 'down' || k === 'chup' || k === 'chdown') {
      const step = { up: -1, down: 1, chup: -8, chdown: 8 }[k];
      const n = btns[clamp(i + step, 0, btns.length - 1)];
      if (n) { n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'nearest' }); }
      return true;
    }
    if (k === 'left') { (railEl?.querySelector('.rail-btn.active') || railEl?.querySelector('.rail-btn'))?.focus(); return true; }
    if (k === 'right') { closePanel(); return true; }
    return false;
  };

  /**
   * Programmes for a channel between from..to, with every gap (no EPG at all, or holes between
   * programmes) filled by one-hour "No information" blocks aligned to the clock hour.
   */
  function blocksFor(ch, from, to) {
    const A = floorHour(from), B = nextHour(to - 1);
    const ps = lib.programmes(ch, A - 6 * 3600e3, B + 6 * 3600e3).slice().sort((a, b) => a.start - b.start);
    const out = [];
    const gaps = (a, b) => { for (let t = a; t < b;) { const e = Math.min(b, nextHour(t)); out.push({ start: t, stop: e, title: 'No information', placeholder: true }); t = e; } };
    let cur = A;
    for (const p of ps) {
      if (p.stop <= cur) continue;
      if (cur >= B) break;
      if (p.start > cur) gaps(cur, Math.min(p.start, B));
      out.push(p); cur = Math.max(cur, p.stop);
    }
    if (cur < B) gaps(cur, B);
    return out.filter((b) => b.stop > from && b.start < to);
  }
  function progAt(ch, t) { return blocksFor(ch, t, t + 1).find((b) => b.start <= t && b.stop > t) || null; }
  /** Focused item: a programme, or a one-hour placeholder block for times without EPG */
  function focusedProg() {
    const ch = rows[rowIdx];
    return ch ? progAt(ch, focusT) : null;
  }

  // ------- rendering -------
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  body.addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(() => { fitRows(); schedule(); }).observe(body);

  function draw() {
    const W = body.clientWidth - CH_W;
    if (W <= 0) return;
    const pxPerMs = W / span();
    const vEnd = viewStart + span();
    // timeline
    let tl = '';
    for (let t = viewStart; t < vEnd; t += SLOT) tl += `<span style="left:${(t - viewStart) * pxPerMs}px">${fmtClock(t, { h12: !settings.get('clock24') })}</span>`;
    timeline.innerHTML = tl;
    dayBtn.textContent = fmtDay(focusT);
    // now line + marker on the timeline
    const nowX = (Date.now() - viewStart) * pxPerMs;
    const showNow = nowX >= 0 && nowX <= W;
    nowLine.style.display = nowMark.style.display = showNow ? '' : 'none';
    nowLine.style.left = CH_W + nowX + 'px';
    nowMark.style.left = nowX + 'px';
    // rows
    const st = body.scrollTop, hgt = body.clientHeight;
    const from = Math.max(0, Math.floor(st / ROW_H) - 2), to = Math.min(rows.length - 1, Math.ceil((st + hgt) / ROW_H) + 2);
    const fp = focusedProg();
    let html = '';
    const now = Date.now();
    for (let i = from; i <= to; i++) {
      const ch = rows[i];
      const sel = i === rowIdx;
      html += `<div class="g-row${sel ? ' sel' : ''}${player.isPlaying(ch.id) ? ' playing' : ''}" style="height:${ROW_H}px;transform:translateY(${i * ROW_H}px)" data-r="${i}">`;
      const num = settings.get('showChannelNumbers') && ch.num ? ch.num : '';
      // big centred logo; channels without one show their name instead
      html += `<div class="g-ch${isDivider(ch) ? ' divider' : ''}${ch.logo ? ' has-logo' : ''}" data-r="${i}" title="${esc(ch.name)}">${num ? `<small class="g-num">${num}</small>` : ''}${ch.logo ? `<span class="lg" data-logo="${i}"></span>` : `<b>${esc(shortName(ch))}</b>`}</div><div class="g-progs">`;
      const ps = blocksFor(ch, viewStart, vEnd);
      let first = true;
      const labelMin = rem(7);
      for (const p of ps) {
        const x = Math.max(0, (p.start - viewStart) * pxPerMs), x2 = Math.min(W, (p.stop - viewStart) * pxPerMs);
        // the first block of each row also names the channel
        const chLabel = first && x2 - x > labelMin ? `<span class="g-chl">${esc(shortName(ch))}</span>` : '';
        first = false;
        const isFocus = sel && fp && p.start === fp.start;
        const live = p.start <= now && p.stop > now, past = p.stop <= now;
        const cu = past && lib.canCatchup(ch, p);
        const remind = !past && !live && lib.hasReminder(ch, p.start);
        html += `<div class="g-p${p.placeholder ? ' empty' : ''}${isFocus ? ' focus' : ''}${live ? ' live' : ''}${past ? ' past' : ''}" style="left:${x}px;width:${Math.max(0, x2 - x)}px" data-r="${i}" data-t="${p.start}">
          ${chLabel}<span class="g-pt">${cu ? icon('rewind', 'cu') : ''}${remind ? icon('bell', 'rem') : ''}${esc(p.title)}</span><span class="g-ps">${fmtClock(p.start)} – ${fmtClock(p.stop)}</span>
          ${live ? `<i class="g-prog" style="width:${clamp((now - p.start) / (p.stop - p.start), 0, 1) * 100}%"></i>` : ''}</div>`;
      }
      html += '</div></div>';
    }
    canvas.innerHTML = html;
    for (const el of canvas.querySelectorAll('[data-logo]')) { const ch = rows[+el.dataset.logo]; el.append(logoEl(ch.logo, ch.name, 'logo gl', { text: shortName(ch) })); }
  }

  function updateDetail() {
    const ch = rows[rowIdx], p = focusedProg();
    if (!ch || !p) { detail.innerHTML = '<p class="muted">No channels</p>'; return; }
    const now = Date.now(), live = p.start <= now && p.stop > now, past = p.stop <= now;
    const cu = past && lib.canCatchup(ch, p);
    const state = live ? '<span class="live-pill">LIVE</span>' : past ? (cu ? '<span class="cu-pill">CATCH-UP</span>' : '<span class="pill">ENDED</span>') : '<span class="pill">UPCOMING</span>';
    const inPreview = player.isPlaying(ch.id) && player.mode === 'preview';
    const action = p.placeholder || live ? (inPreview ? 'Watch fullscreen' : 'Preview channel') : past ? (cu ? 'Play from catch-up' : 'Watch channel live') : (lib.hasReminder(ch, p.start) ? 'Cancel reminder' : 'Set reminder');
    const left = live ? humanLeft(p.stop - now) : '';
    const pct = live ? clamp((now - p.start) / (p.stop - p.start), 0, 1) * 100 : 0;
    detail.innerHTML = `
      <div class="g-d-ch">${settings.get('showChannelNumbers') && ch.num ? ch.num + ' · ' : ''}${esc(ch.name)}</div>
      <h2>${esc(p.title)} ${p.ep ? `<span class="ep">${esc(p.ep)}</span>` : ''}</h2>
      <div class="g-d-time"><b>${fmtClock(p.start)} – ${fmtClock(p.stop)}</b>${live ? `<span>${left}</span>` : `<span>${fmtDay(p.start)} · ${fmtMins((p.stop - p.start) / 60000)}</span>`}${live ? '' : state}${p.cat ? `<span class="chip">${esc(p.cat)}</span>` : ''}</div>
      ${live ? `<div class="bar g-d-bar"><i style="width:${pct}%"></i></div>` : ''}
      ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : '<p class="desc muted">No description available.</p>'}
      <div class="g-hint"><kbd>OK</kbd> ${action} &nbsp;·&nbsp; ${live ? '<kbd>◀</kbd> groups &nbsp;·&nbsp; <kbd>▶</kbd> browse' : '<kbd>◀ ▶</kbd> browse'} &nbsp;·&nbsp; <kbd>CH±</kbd> page</div>`;
  }

  // ------- movement -------
  function ensureVisible() {
    const sp = span();
    const p = focusedProg();
    const ps = p ? p.start : focusT;
    if (ps < viewStart || focusT < viewStart) viewStart = floorSlot(Math.max(ps, focusT - sp + SLOT, minT()));
    if (focusT >= viewStart + sp) viewStart = floorSlot(focusT - sp / 3);
    if (p && p.start >= viewStart + sp) viewStart = floorSlot(p.start);
    centerRow();
  }
  /** keep the selected row in the middle (row 3 of 5); clamps at the top and bottom of the list */
  function centerRow() {
    const h = body.clientHeight;
    body.scrollTop = clamp(rowIdx * ROW_H - (h - ROW_H) / 2, 0, Math.max(0, rows.length * ROW_H - h));
  }
  /** size rows so an odd number of whole rows fills the grid (selected row exactly centred) */
  let fitH = 0;
  function fitRows() {
    const h = body.clientHeight;
    if (!h || Math.abs(h - fitH) < 2) return false;
    fitH = h;
    // aim for 5 rows (like the reference); more on tall screens, 3 only when space is very tight
    const base = rem(4.6);
    let n = Math.round(h / base);
    if (n % 2 === 0) n += h / base > n ? 1 : -1;
    n = Math.max(h / 5 >= rem(3.4) ? 5 : 3, n);
    ROW_H = h / n;
    canvas.style.height = rows.length * ROW_H + 'px';
    centerRow();
    return true;
  }
  function moveRow(d) {
    const ni = clamp(rowIdx + d, 0, rows.length - 1);
    if (ni === rowIdx) return false;
    rowIdx = ni; after(); return true;
  }
  function moveH(d) {
    const p = focusedProg();
    if (!p) return false;
    if (d > 0) {
      const t = p.stop;
      if (t > maxT()) return true;
      focusT = Math.max(t, focusT + 1);
      const np = progAt(rows[rowIdx], focusT);
      if (np) focusT = Math.max(np.start, viewStart);
    } else {
      const t = p.start - 1;
      if (t < minT()) return false;
      if (p.start <= viewStart && viewStart <= minT()) return false;
      const pp = progAt(rows[rowIdx], t);
      focusT = pp ? Math.max(pp.start, Math.min(t, pp.start)) : floorSlot(t);
    }
    after(); return true;
  }
  function jumpTo(t, keepFocus = false) { focusT = t; viewStart = floorSlot(t - 30 * 60e3); after(); if (!keepFocus) body.focus(); }
  function after() { ensureVisible(); draw(); updateDetail(); schedulePreview(); }

  let pvT;
  function schedulePreview() {
    clearTimeout(pvT);
    if (!settings.get('previewAutoplay')) return;
    const ch = rows[rowIdx];
    pvT = setTimeout(() => { if (rows[rowIdx] === ch && player.mode !== 'full') player.playChannel(ch, { list: rows, preview: true }); }, 900);
  }

  function activate() {
    const ch = rows[rowIdx], p = focusedProg();
    if (!ch || !p) return;
    const now = Date.now();
    if (p.placeholder || (p.start <= now && p.stop > now)) {
      // same as Live TV: first OK previews, OK on the previewing channel goes fullscreen
      if ((player.isPlaying(ch.id) && player.mode === 'preview' && player.state !== 'error') || window.matchMedia('(pointer: coarse)').matches) return player.playChannel(ch, { list: rows });
      player.playChannel(ch, { list: rows, preview: true }); draw(); updateDetail(); return;
    }
    if (p.stop <= now) return lib.canCatchup(ch, p) ? player.playCatchup(ch, p) : player.playChannel(ch, { list: rows });
    const on = lib.toggleReminder(ch, [p.start, p.stop, p.title]);
    toast(on ? `Reminder set · ${p.title} at ${fmtClock(p.start)}` : 'Reminder removed', { icon: 'bell' });
    draw(); updateDetail();
  }

  body.__keys = (k) => {
    switch (k) {
      case 'up': return moveRow(-1) || (dayBtn.focus(), true);
      case 'down': return moveRow(1);
      case 'left': {
        // on the programme airing now (or at the far left), Left opens the playlist panel
        const p = focusedProg(), now = Date.now();
        if ((p && p.start <= now && p.stop > now) || !moveH(-1)) openPanel();
        return true;
      }
      case 'right': return moveH(1);
      case 'chup': moveRow(-Math.max(1, Math.floor(body.clientHeight / ROW_H) - 1)); return true;
      case 'chdown': moveRow(Math.max(1, Math.floor(body.clientHeight / ROW_H) - 1)); return true;
      case 'ff': jumpTo(focusT + 864e5); return true;
      case 'rw': jumpTo(focusT - 864e5); return true;
      case 'ok': activate(); return true;
      case 'guide': jumpTo(Date.now()); return true;
    }
    return false;
  };
  dayNav.__keys = (k) => {
    const btns = [...dayNav.children], i = btns.indexOf(document.activeElement);
    if (k === 'down') { body.focus(); return true; }
    if (k === 'up') { groupBtn.focus(); return true; }
    if (k === 'right' && i < btns.length - 1) { btns[i + 1].focus(); return true; }
    if (k === 'left' && i > 0) { btns[i - 1].focus(); return true; }
    return false;
  };
  groupBtn.__keys = (k) => { if (k === 'down') { dayBtn.focus(); return true; } return false; };
  body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-r]'); if (!el) return;
    const r = +el.dataset.r;
    const same = r === rowIdx && el.dataset.t && Math.abs(+el.dataset.t - (focusedProg()?.start ?? -1)) < 1;
    rowIdx = r;
    if (el.dataset.t) focusT = Math.max(+el.dataset.t, viewStart);
    body.focus({ preventScroll: true });
    if (same || e.detail === 2) activate(); else after();
  });
  body.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      e.preventDefault();
      viewStart = clamp(viewStart + Math.sign(e.deltaX || e.deltaY) * SLOT / 2, minT(), maxT());
      draw();
    }
  }, { passive: false });

  // ------- init -------
  player.attachPreview(slot);
  const ro = new ResizeObserver(() => player.reposition()); ro.observe(slot);
  const startCh = arg?.channel || (player.kind === 'live' ? player.item?.id : null);
  setGroup(group, startCh);
  requestAnimationFrame(() => { ensureVisible(); draw(); if (player.mode !== 'preview') schedulePreview(); });
  const tick = setInterval(draw, 30000);
  const offEpg = lib.on('epg', () => { draw(); updateDetail(); });
  const onPl = () => draw();
  window.addEventListener('player-change', onPl);
  player.onExit = () => { const i = rows.findIndex((c) => c.id === player.item?.id); if (i > -1) rowIdx = i; focusT = Date.now(); after(); body.focus(); };

  return {
    focus: () => (panel.classList.contains('open') ? (panel.querySelector('.gp-item.on') || panel.querySelector('.gp-item')).focus() : body.focus({ preventScroll: true })),
    back: () => {
      if (panel.classList.contains('open')) { closePanel(); return true; }
      if (player.mode === 'preview') { player.stop(); draw(); return true; }
      if (Math.abs(focusT - Date.now()) > SLOT) { jumpTo(Date.now()); return true; }
      return false;
    },
    destroy: () => { document.documentElement.classList.remove('g-panel-open'); clearInterval(tick); clearTimeout(pvT); ro.disconnect(); offEpg(); window.removeEventListener('player-change', onPl); player.onExit = null; },
  };
}
function floorSlot(t) { return Math.floor(t / SLOT) * SLOT; }
/** local clock hour boundaries (works for half-hour time zones too) */
function floorHour(t) { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); }
function nextHour(t) { return floorHour(t) + 3600e3 > t ? floorHour(t) + 3600e3 : floorHour(t + 3600e3); }
/** "1 hour, 33 minutes left" */
function humanLeft(ms) {
  const m = Math.max(1, Math.round(ms / 60000)), hrs = Math.floor(m / 60), mins = m % 60;
  const part = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return (hrs ? part(hrs, 'hour') + (mins ? ', ' : '') : '') + (mins ? part(mins, 'minute') : '') + ' left';
}
