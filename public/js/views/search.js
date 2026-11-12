import { h, esc, logoEl, fmtClock, fmtDay, debounce, nameGradient, initials } from '../util.js';
import { lib } from '../library.js';
import { player } from '../player.js';
import { icon, toast } from '../ui.js';
import { nav } from '../nav.js';

export default function searchView(root, { go }) {
  const input = h('input.search-input', { type: 'search', placeholder: 'Search channels, programmes, movies and series…', autocomplete: 'off', spellcheck: false, 'data-enter': 'nav' });
  const results = h('div.search-results');
  root.append(h('div.search-layout', h('div.search-bar', { html: icon('search') }, input), results));

  const run = debounce(() => {
    const q = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (q.length < 2) { results.append(h('div.empty-state', { html: `${icon('search')}<span>Type at least two characters</span>` })); return; }
    const words = q.split(/\s+/);
    const match = (s) => { s = (s || '').toLowerCase(); return words.every((w) => s.includes(w)); };
    const ch = lib.live.filter((c) => match(c.name)).slice(0, 40);
    const now = Date.now(), progs = [];
    for (const c of lib.live) {
      for (const p of lib.programmes(c, now - 3 * 3600e3, now + 2 * 864e5)) {
        if (match(p.title)) { progs.push({ c, p }); if (progs.length > 60) break; }
      }
      if (progs.length > 60) break;
    }
    progs.sort((a, b) => a.p.start - b.p.start);
    const mv = lib.movies.filter((m) => match(m.name)).slice(0, 40);
    const se = lib.series.filter((m) => match(m.name)).slice(0, 40);
    if (!ch.length && !progs.length && !mv.length && !se.length) {
      results.append(h('div.empty-state', { html: `${icon('search')}<span>No results for “${esc(q)}”</span>` })); return;
    }
    if (ch.length) results.append(section('Channels', ch.map((c) => {
      const [n] = lib.nowNext(c);
      const b = h('button.res-ch', { onclick: () => player.playChannel(c, { list: ch }) }, logoEl(c.logo, c.name), h('div', h('b', c.name), h('small.muted', n ? n.title : c.group)));
      return b;
    })));
    if (progs.length) results.append(section('Programmes', progs.slice(0, 40).map(({ c, p }) => {
      const live = p.start <= now && p.stop > now, past = p.stop <= now, cu = past && lib.canCatchup(c, p);
      return h('button.res-prog', {
        onclick: () => {
          if (live) player.playChannel(c, { list: lib.live });
          else if (cu) player.playCatchup(c, p);
          else if (!past) { const on = lib.toggleReminder(c, [p.start, p.stop, p.title]); toast(on ? 'Reminder set' : 'Reminder removed', { icon: 'bell' }); }
          else player.playChannel(c, { list: lib.live });
        },
      }, h('div.rp-time', h('b', fmtClock(p.start)), h('small', fmtDay(p.start))),
      h('div.rp-main', h('b', p.title), h('small.muted', c.name + (p.ep ? ' · ' + p.ep : ''))),
      live ? h('span.live-pill', 'LIVE') : cu ? h('span.cu-pill', 'CATCH-UP') : past ? null : h('span.pill', { html: icon('bell') }));
    })));
    const posterRow = (title, arr, view) => section(title, arr.map((m) => h('button.poster.small', { onclick: () => go(view, { open: m.id }) },
      h('div.art', { style: { background: nameGradient(m.name) } }, h('span.ph', initials(m.name)), (m.logo || m.cover) && h('img', { src: m.logo || m.cover, loading: 'lazy', alt: '', referrerpolicy: 'no-referrer', onload: (e) => e.target.classList.add('ok'), onerror: (e) => e.target.remove() })),
      h('div.pt', m.name))), 'posters');
    if (mv.length) results.append(posterRow('Movies', mv, 'movies'));
    if (se.length) results.append(posterRow('Series', se, 'series'));
  }, 180);
  input.addEventListener('input', run);
  input.__keys = (k) => { if (k === 'down') { nav.focus(results.querySelector('button')); return true; } return false; };
  run();
  return { focus: () => input.focus() };
}
const section = (t, kids, cls = '') => h('section.res-sec', h('h3', t), h('div.res-row' + (cls ? '.' + cls : ''), { 'data-navgroup': '' }, kids));
