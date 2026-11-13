import { h, esc, logoEl, fmtClock, fmtDay, fmtMins, clamp, store } from '../util.js';
import { lib } from '../library.js';
import { player } from '../player.js';
import { settings } from '../settings.js';
import { icon, toast, choose, spinner } from '../ui.js';
import { nav } from '../nav.js';
import { SPORTS, findSportsEvents } from '../sports.js';
import { scoresFor, scoresEnabled, crestsFor } from '../scores.js';
import { imgUrl } from '../util.js';

export default function sportsView(root) {
  let filter = store.get('sportsFilter', 'all');
  let showReplays = store.get('sportsReplays', false);
  let data = null;
  let scores = new Map();
  const crests = new Map();          // event key -> crest info (or null)
  const expanded = new Set();        // sections the user asked to see in full
  const CAP = 12;

  const chips = h('div.sp-chips', { 'data-navgroup': '' });
  const body = h('div.sp-body', spinner('Finding matches in your TV guide…'));
  root.append(h('div.sports-layout',
    h('div.sp-head', h('div', h('h1', { html: `${icon('trophy')} Sports` }), h('p.muted.small', 'Live and upcoming football, cricket and Formula 1 from your channels')), chips),
    body));

  function drawChips() {
    const counts = { all: 0, football: 0, cricket: 0, f1: 0 };
    for (const e of visibleEvents(true)) { counts.all++; counts[e.sport]++; }
    chips.replaceChildren(
      ...[['all', 'All', 'trophy'], ...Object.entries(SPORTS).map(([k, v]) => [k, v.label, v.icon])].map(([k, l, ic]) =>
        h('button.chip-btn.sp-chip' + (filter === k ? '.on' : ''), { dataset: { sport: k }, onclick: () => { filter = k; store.set('sportsFilter', k); draw(); } },
          h('span', { html: icon(ic) }), h('span', l), data && h('small', String(counts[k])))),
      h('button.chip-btn.sp-chip' + (showReplays ? '.on' : ''), { onclick: () => { showReplays = !showReplays; store.set('sportsReplays', showReplays); draw(); } },
        h('span', { html: icon(showReplays ? 'eye' : 'eyeoff') }), h('span', 'Highlights & replays')),
    );
  }

  function visibleEvents(ignoreFilter = false) {
    if (!data) return [];
    return [...data.events, ...data.eventChannels].filter((e) => (ignoreFilter || filter === 'all' || e.sport === filter) && (showReplays || !e.replay));
  }

  function card(e) {
    const s = SPORTS[e.sport];
    const now = Date.now();
    const live = e.eventChannel || (e.start <= now && e.stop > now);
    const ch = e.channels[0];
    let when;
    if (e.eventChannel) when = `<span class="live-pill">EVENT</span>${e.time ? `<span>${esc(e.time)}</span>` : ''}`;
    else if (live) when = `<span class="live-pill">LIVE</span><span>${fmtMins((e.stop - now) / 60000)} left</span>`;
    else when = `<span class="sp-time">${fmtDay(e.start)} · ${fmtClock(e.start)}</span>${lib.hasReminder(ch, e.start) ? `<span class="sp-rem">${icon('bell')}</span>` : ''}`;
    const el = h('button.sp-card' + (live ? '.live' : ''), { dataset: { ekey: e.key }, onclick: () => open(e) },
      h('div.sp-top', { html: `<span class="sp-sport">${icon(s.icon)}${esc(s.label)}</span><span class="sp-when">${when}</span>` }),
      h('div.sp-title', e.title),
      crestEl(crests.get(e.key)),
      scoreEl(scores.get(e.key)),
      e.sub ? h('div.sp-sub', e.sub) : null,
      live && !e.eventChannel ? h('div.bar', h('i', { style: { width: clamp((now - e.start) / (e.stop - e.start), 0, 1) * 100 + '%' } })) : null,
      h('div.sp-ch', logoEl(ch.logo, ch.name, 'logo sm'), h('span', ch.name), e.channels.length > 1 ? h('small', `+${e.channels.length - 1} more`) : null),
    );
    el.style.setProperty('--sport', s.color); // custom properties need setProperty
    el.__ev = e;
    return el;
  }

  function crestEl(c) {
    if (!c) return null;
    const one = (logo, name) => h('span.sp-side', logo ? h('img.sp-crest', { src: imgUrl(logo, 96), alt: '', decoding: 'async', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }) : h('span.sp-crest.ph'), h('b', name));
    return h('div.sp-crests', one(c.home, c.names[0]), h('span.sp-v', 'v'), one(c.away, c.names[1]));
  }
  /** Look up crests for the cards on screen and patch them in (doesn't block drawing) */
  let crestRun = 0;
  async function loadCrests() {
    const run = ++crestRun;
    for (const el of body.querySelectorAll('.sp-card')) {
      if (run !== crestRun) return;
      const e = el.__ev;
      if (!e || crests.has(e.key)) continue;
      const c = await crestsFor(e).catch(() => null);
      crests.set(e.key, c);
      if (c && el.isConnected && !el.querySelector('.sp-crests')) el.querySelector('.sp-title').after(crestEl(c));
    }
  }
  function scoreEl(sc) {
    if (!sc) return null;
    const pill = sc.clock ? `<span class="sp-clock${sc.state === 'post' ? ' ft' : ''}">${esc(sc.clock)}</span>` : '';
    if (sc.sport === 'cricket') {
      return h('div.sp-score.cricket', { html: `<div class="sp-inn"><b>${esc(sc.home.short)}</b><span>${esc(sc.home.score || 'Yet to bat')}</span></div>
        <div class="sp-inn"><b>${esc(sc.away.short)}</b><span>${esc(sc.away.score || 'Yet to bat')}</span></div>
        ${sc.note ? `<div class="sp-note">${esc(sc.note)}</div>` : ''}` });
    }
    if (sc.sport === 'f1') {
      return h('div.sp-score.f1', { html: `<div class="sp-podium">${sc.top.map((n, i) => `<span><i>${i + 1}</i>${esc(n)}</span>`).join('')}</div>${pill}` });
    }
    return h('div.sp-score.football', { html: `<span class="sp-team">${esc(sc.home.name)}</span><span class="sp-goals">${esc(sc.home.score)} – ${esc(sc.away.score)}</span><span class="sp-team">${esc(sc.away.name)}</span>${pill}` });
  }

  /** Fetch scores for live / about-to-start events and patch them into the cards */
  let scoreBusy = false;
  async function refreshScores() {
    if (!data || scoreBusy || !scoresEnabled()) return;
    const now = Date.now();
    const evs = [...data.events.filter((e) => e.start <= now + 10 * 60e3 && e.stop > now - 30 * 60e3), ...data.eventChannels].filter((e) => !e.replay).slice(0, 40);
    if (!evs.length) return;
    scoreBusy = true;
    try { scores = await scoresFor(evs); } finally { scoreBusy = false; }
    // live scoreboards also teach us team logos (e.g. domestic cricket): retry cards without crests
    let retry = false;
    for (const e of evs) if (e.sport === 'cricket' && crests.get(e.key) === null) { crests.delete(e.key); retry = true; }
    if (retry) loadCrests();
    for (const el of body.querySelectorAll('.sp-card')) {
      const sc = scores.get(el.dataset.ekey);
      const old = el.querySelector('.sp-score');
      const neu = scoreEl(sc);
      if (old && neu) old.replaceWith(neu);
      else if (old) old.remove();
      else if (neu) el.querySelector('.sp-title').after(neu);
    }
  }

  async function pickChannel(e) {
    if (e.channels.length === 1) return e.channels[0];
    const c = await choose('Watch on', e.channels.map((ch, i) => ({ id: i, label: ch.name, hint: ch.group })));
    return c ? e.channels[c.id] : null;
  }

  async function open(e) {
    const now = Date.now();
    const live = e.eventChannel || (e.start <= now + 5 * 60e3 && e.stop > now);
    if (live) {
      const ch = await pickChannel(e);
      if (ch) player.playChannel(ch, { list: e.channels });
      return;
    }
    // upcoming: reminder (on every channel showing it, so it fires whichever you watch)
    const c = await choose(e.title, [
      { id: 'remind', label: lib.hasReminder(e.channels[0], e.start) ? 'Cancel reminder' : `Remind me at ${fmtClock(e.start)}` },
      { id: 'channel', label: `Watch ${e.channels[0].name} now` },
      ...(e.channels.length > 1 ? [{ id: 'all', label: `Shown on ${e.channels.length} channels`, hint: e.channels.map((c) => c.name).join(', ') }] : []),
    ]);
    if (!c) return;
    if (c.id === 'remind') {
      const on = lib.toggleReminder(e.channels[0], [e.start, e.stop, e.title]);
      toast(on ? `Reminder set · ${e.title} at ${fmtClock(e.start)}` : 'Reminder removed', { icon: 'bell' });
      draw();
    } else if (c.id === 'channel' || c.id === 'all') {
      const ch = await pickChannel(e);
      if (ch) player.playChannel(ch, { list: e.channels });
    }
  }

  function section(title, list, cls = '', always = false) {
    if (!list.length) return null;
    const full = always || expanded.has(title) || list.length <= CAP + 2;
    const shown = full ? list : list.slice(0, CAP);
    const more = full ? null : h('button.sp-card.sp-more', { onclick: () => { expanded.add(title); draw(); body.querySelector(`[data-sec="${title}"] .sp-card:nth-child(${CAP + 1})`)?.focus(); } },
      h('b', `Show all ${list.length}`), h('small.muted', `${list.length - CAP} more ${title.toLowerCase()}`));
    return h('section.sp-sec' + cls, { dataset: { sec: title } }, h('h3', title, h('small', String(list.length))), h('div.sp-grid', { 'data-navgroup': '' }, shown.map(card), more));
  }

  function draw() {
    drawChips();
    if (!data) return;
    const evs = visibleEvents();
    const now = Date.now();
    const dayEnd = (d) => new Date(new Date(now).setHours(24 * d, 0, 0, 0)).getTime();
    const progs = evs.filter((e) => !e.eventChannel);
    const groups = [
      ['Live now', progs.filter((e) => e.start <= now && e.stop > now), '.live-sec', true],
      ['Event channels', evs.filter((e) => e.eventChannel), '', true],
      ['Starting soon', progs.filter((e) => e.start > now && e.start <= now + 3 * 3600e3), ''],
      ['Later today', progs.filter((e) => e.start > now + 3 * 3600e3 && e.start < dayEnd(1)), ''],
      ['Tomorrow', progs.filter((e) => e.start >= dayEnd(1) && e.start < dayEnd(2)), ''],
      ['This week', progs.filter((e) => e.start >= dayEnd(2)), ''],
    ];
    const focusedKey = document.activeElement?.closest?.('.sp-card')?.dataset.key;
    const secs = groups.map(([t, l, c, a]) => section(t, l, c, a)).filter(Boolean);
    if (!secs.length) {
      const noGuide = !lib.epgIndex.size;
      body.replaceChildren(h('div.empty-state', { html: `${icon('trophy')}<b>${noGuide ? 'No TV guide yet' : 'No matches found'}</b><span>${noGuide
        ? 'The Sports hub finds matches in your TV guide. Wait for the guide to finish loading, or check Settings → TV Guide.'
        : filter === 'all' ? 'Nothing coming up in the next 7 days in your guide. Try “Highlights & replays”, or check that your provider’s guide covers sports channels.' : `No ${SPORTS[filter].label} found right now.`}</span>` }));
      return;
    }
    body.replaceChildren(...secs);
    // keep keys for focus restore
    body.querySelectorAll('.sp-card').forEach((el, i) => { el.dataset.key = i; });
    if (focusedKey != null) body.querySelector(`.sp-card[data-key="${focusedKey}"]`)?.focus({ preventScroll: true });
    loadCrests();
  }

  async function load() {
    data = await findSportsEvents();
    draw();
    refreshScores();
    if (root.contains(document.activeElement) === false || document.activeElement === document.body) focus();
  }
  function focus() { nav.focus(body.querySelector('.sp-card') || chips.querySelector('.on') || chips.firstChild); }

  // Filter row: Up does nothing, Down always goes to the first match (cards may be scrolled away)
  chips.__keys = (k) => {
    if (k === 'up') return true;
    if (k === 'down') { const c = body.querySelector('.sp-card'); if (c) { body.scrollTo({ top: 0 }); nav.focus(c); } return true; }
    return false;
  };

  drawChips();
  load();
  const offEpg = lib.on('epg', () => load());
  const tick = setInterval(() => { if (data) { data = null; load(); } }, 60e3);
  const scoreTick = setInterval(refreshScores, 30e3);
  return {
    focus,
    back: () => { if (body.contains(document.activeElement)) { chips.querySelector('.on')?.focus(); body.scrollTo({ top: 0, behavior: 'smooth' }); return true; } return false; },
    destroy: () => { offEpg(); clearInterval(tick); clearInterval(scoreTick); },
  };
}
