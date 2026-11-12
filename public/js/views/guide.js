import { h, esc, logoEl, fmtClock, fmtDay, fmtMins, clamp, store, rem, shortName, isDivider } from '../util.js';
import { lib, FAV_GROUP, RECENT_GROUP, ALL_GROUP } from '../library.js';
import { player } from '../player.js';
import { settings } from '../settings.js';
import { icon, toast, choose } from '../ui.js';

const SLOT = 30 * 60e3;
let ROW_H = 68, CH_W = 236;

export default function guideView(root, { arg, go }) {
  ROW_H = rem(4.25); CH_W = window.innerWidth < 800 ? rem(7) : rem(14.75);
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
  const groupBtn = h('button.chip-btn', { onclick: pickGroup });
  const dayLbl = h('span.g-day');
  const timeline = h('div.g-timeline');
  const body = h('div.g-body', { tabindex: 0 });
  const canvas = h('div.g-canvas');
  const nowLine = h('div.g-now');
  body.append(canvas);
  const grid = h('div.g-grid', h('div.g-head', h('div.g-corner', groupBtn), h('div.g-tl-wrap', timeline, dayLbl)), body, nowLine);
  root.append(h('div.guide-layout', h('div.g-top', detail, slot), h('div.g-toolbar',
    h('button.chip-btn', { onclick: () => jumpTo(Date.now()), html: icon('clock') + '<span>Now</span>' }),
    h('button.chip-btn', { onclick: () => jumpTo(focusT - 864e5), html: icon('back') + '<span>-1 day</span>' }),
    h('button.chip-btn', { onclick: () => jumpTo(focusT + 864e5), html: '<span>+1 day</span>' + icon('fwd') }),
    h('span.spacer'),
    h('span.muted.small', { html: '<kbd>OK</kbd> watch / catch-up / remind &nbsp; <kbd>◀ ▶</kbd> browse &nbsp; <kbd>CH±</kbd> page' })), grid));

  // ------- data -------
  function setGroup(g, keepChannel) {
    group = g;
    rows = lib.channelsIn(g);
    if (!rows.length && g !== ALL_GROUP) { group = ALL_GROUP; rows = lib.channelsIn(ALL_GROUP); }
    groupBtn.innerHTML = icon('list') + `<span>${esc(group.replace(/^[★⟲] /, ''))}</span><small>${rows.length}</small>`;
    canvas.style.height = rows.length * ROW_H + 'px';
    if (keepChannel) { const i = rows.findIndex((c) => c.id === keepChannel); rowIdx = i > -1 ? i : 0; } else rowIdx = 0;
    body.scrollTop = Math.max(0, rowIdx * ROW_H - body.clientHeight / 2);
    draw(); updateDetail();
  }
  async function pickGroup() {
    const opts = [FAV_GROUP, RECENT_GROUP, ALL_GROUP, ...lib.liveGroups.map((g) => g.name)].map((g) => ({ id: g, label: g, active: g === group }));
    const c = await choose('Channel group', opts);
    if (c) setGroup(c.id);
    body.focus();
  }

  function progAt(ch, t) {
    const ps = lib.programmes(ch, t - 1, t + 1);
    return ps.find((p) => p.start <= t && p.stop > t) || null;
  }
  /** Focused item: a programme, or a 30-minute placeholder block for channels without EPG */
  function focusedProg() {
    const ch = rows[rowIdx];
    if (!ch) return null;
    return progAt(ch, focusT) || { start: floorSlot(focusT), stop: floorSlot(focusT) + SLOT, title: ch.name, placeholder: true };
  }

  // ------- rendering -------
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  body.addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(schedule).observe(body);

  function draw() {
    const W = body.clientWidth - CH_W;
    if (W <= 0) return;
    const pxPerMs = W / span();
    const vEnd = viewStart + span();
    // timeline
    let tl = '';
    for (let t = viewStart; t < vEnd; t += SLOT) tl += `<span style="left:${(t - viewStart) * pxPerMs}px">${fmtClock(t, { h12: !settings.get('clock24') })}</span>`;
    timeline.innerHTML = tl;
    dayLbl.textContent = fmtDay(focusT);
    // now line
    const nowX = (Date.now() - viewStart) * pxPerMs;
    nowLine.style.display = nowX >= 0 && nowX <= W ? '' : 'none';
    nowLine.style.left = CH_W + nowX + 'px';
    // rows
    const st = body.scrollTop, hgt = body.clientHeight;
    const from = Math.max(0, Math.floor(st / ROW_H) - 2), to = Math.min(rows.length - 1, Math.ceil((st + hgt) / ROW_H) + 2);
    const fp = focusedProg();
    let html = '';
    const now = Date.now();
    for (let i = from; i <= to; i++) {
      const ch = rows[i];
      const sel = i === rowIdx;
      html += `<div class="g-row${sel ? ' sel' : ''}${player.isPlaying(ch.id) ? ' playing' : ''}" style="transform:translateY(${i * ROW_H}px)" data-r="${i}">`;
      const num = settings.get('showChannelNumbers') && ch.num ? ch.num : '';
      html += `<div class="g-ch${isDivider(ch) ? ' divider' : ''}" data-r="${i}" title="${esc(ch.name)}"><span class="lg" data-logo="${i}"></span><span class="g-cht">${num ? `<small>${num}</small>` : ''}<b>${esc(shortName(ch))}</b></span></div><div class="g-progs">`;
      const ps = lib.programmes(ch, viewStart, vEnd);
      if (!ps.length) {
        const isSel = sel && fp?.placeholder;
        html += `<div class="g-p empty${isSel ? ' focus' : ''}" style="left:0;width:${W}px" data-r="${i}" data-t="${viewStart}"><span>${isSel ? esc(ch.name) + ' · ' : ''}No information</span></div>`;
      }
      for (const p of ps) {
        const x = Math.max(0, (p.start - viewStart) * pxPerMs), x2 = Math.min(W, (p.stop - viewStart) * pxPerMs);
        const isFocus = sel && fp && !fp.placeholder && p.start === fp.start;
        const live = p.start <= now && p.stop > now, past = p.stop <= now;
        const cu = past && lib.canCatchup(ch, p);
        const rem = !past && !live && lib.hasReminder(ch, p.start);
        html += `<div class="g-p${isFocus ? ' focus' : ''}${live ? ' live' : ''}${past ? ' past' : ''}" style="left:${x}px;width:${Math.max(0, x2 - x)}px" data-r="${i}" data-t="${p.start}">
          <span class="g-pt">${cu ? icon('rewind', 'cu') : ''}${rem ? icon('bell', 'rem') : ''}${esc(p.title)}</span><span class="g-ps">${fmtClock(p.start)} – ${fmtClock(p.stop)}</span>
          ${live ? `<i class="g-prog" style="width:${clamp((now - p.start) / (p.stop - p.start), 0, 1) * 100}%"></i>` : ''}</div>`;
      }
      html += '</div></div>';
    }
    canvas.innerHTML = html;
    for (const el of canvas.querySelectorAll('[data-logo]')) { const ch = rows[+el.dataset.logo]; el.append(logoEl(ch.logo, ch.name, 'logo sm')); }
  }

  function updateDetail() {
    const ch = rows[rowIdx], p = focusedProg();
    if (!ch || !p) { detail.innerHTML = '<p class="muted">No channels</p>'; return; }
    const now = Date.now(), live = p.start <= now && p.stop > now, past = p.stop <= now;
    const cu = past && lib.canCatchup(ch, p);
    const state = live ? '<span class="live-pill">LIVE</span>' : past ? (cu ? '<span class="cu-pill">CATCH-UP</span>' : '<span class="pill">ENDED</span>') : '<span class="pill">UPCOMING</span>';
    const inPreview = player.isPlaying(ch.id) && player.mode === 'preview';
    const action = p.placeholder || live ? (inPreview ? 'Watch fullscreen' : 'Preview channel') : past ? (cu ? 'Play from catch-up' : 'Watch channel live') : (lib.hasReminder(ch, p.start) ? 'Cancel reminder' : 'Set reminder');
    detail.innerHTML = `
      <div class="g-d-ch"><span class="lg"></span><span>${settings.get('showChannelNumbers') ? ch.num + ' · ' : ''}${esc(ch.name)}</span></div>
      <h2>${esc(p.title)} ${p.ep ? `<span class="ep">${esc(p.ep)}</span>` : ''}</h2>
      <div class="row gap wrap">${state}<span class="muted">${fmtDay(p.start)} · ${fmtClock(p.start)} – ${fmtClock(p.stop)} · ${fmtMins((p.stop - p.start) / 60000)}</span>${p.cat ? `<span class="chip">${esc(p.cat)}</span>` : ''}</div>
      ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : '<p class="desc muted">No description available.</p>'}
      <div class="g-hint"><kbd>OK</kbd> ${action}</div>`;
    detail.querySelector('.lg').append(logoEl(ch.logo, ch.name, 'logo sm'));
  }

  // ------- movement -------
  function ensureVisible() {
    const sp = span();
    const p = focusedProg();
    const ps = p ? p.start : focusT;
    if (ps < viewStart || focusT < viewStart) viewStart = floorSlot(Math.max(ps, focusT - sp + SLOT, minT()));
    if (focusT >= viewStart + sp) viewStart = floorSlot(focusT - sp / 3);
    if (p && p.start >= viewStart + sp) viewStart = floorSlot(p.start);
    const top = rowIdx * ROW_H, h = body.clientHeight;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + ROW_H > body.scrollTop + h) body.scrollTop = top + ROW_H - h;
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
  function jumpTo(t) { focusT = t; viewStart = floorSlot(t - 30 * 60e3); after(); body.focus(); }
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
      case 'up': return moveRow(-1) || (groupBtn.focus(), true);
      case 'down': return moveRow(1);
      case 'left': return moveH(-1);
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
  groupBtn.parentElement.__keys = (k) => { if (k === 'down') { body.focus(); return true; } return false; };
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
    focus: () => body.focus({ preventScroll: true }),
    back: () => {
      if (player.mode === 'preview') { player.stop(); draw(); return true; }
      if (Math.abs(focusT - Date.now()) > SLOT) { jumpTo(Date.now()); return true; }
      return false;
    },
    destroy: () => { clearInterval(tick); clearTimeout(pvT); ro.disconnect(); offEpg(); window.removeEventListener('player-change', onPl); player.onExit = null; },
  };
}
function floorSlot(t) { return Math.floor(t / SLOT) * SLOT; }
