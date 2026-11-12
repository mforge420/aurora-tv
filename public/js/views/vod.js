import { h, esc, fmtDuration, nameGradient, initials, store, debounce, rem } from '../util.js';
import { imgUrl } from '../util.js';
import { VList } from '../vlist.js';
import { lib } from '../library.js';
import { player } from '../player.js';
import { icon, modal, toast, spinner } from '../ui.js';
import { nav } from '../nav.js';

const CONT = '▶ Continue watching', RECENT = '✦ Recently added', FAVS = '★ Favorites', ALL = 'All';
const PAGE = 90;

export default function vodView(root, { name, arg }) {
  const isSeries = name === 'series';
  const items = () => (isSeries ? lib.series : lib.movies);
  const key = isSeries ? 'seriesGroup' : 'movieGroup';
  let group = store.get(key, RECENT);
  let list = [], shown = 0, sort = store.get('vodSort', 'default');

  const groups = () => {
    const base = [{ name: RECENT, count: Math.min(items().length, 200) }, { name: FAVS, count: items().filter((m) => lib.favs.has(m.id)).length }, { name: ALL, count: items().length }];
    if (!isSeries) base.unshift({ name: CONT, count: contMovies().length });
    return [...base, ...(isSeries ? lib.seriesGroups : lib.movieGroups)];
  };
  const gl = new VList({
    rowHeight: rem(3.25), className: 'groups',
    render: (g, i, el) => { el.classList.toggle('selected', g.name === group); el.innerHTML = `<span class="gname">${esc(g.name)}</span><span class="gcount">${g.count.toLocaleString()}</span>`; },
    onFocus: debounce((g) => { if (g && g.name !== group) select(g.name); }, 200),
    onActivate: (g) => { select(g.name); gridEl.querySelector('.poster')?.focus(); },
    keys: (k) => { if (k === 'right') { (gridEl.querySelector('.poster') || null)?.focus(); return true; } return false; },
  });

  const titleEl = h('div.hname'), countEl = h('div.hcount.muted');
  const sortBtn = h('button.chip-btn', { onclick: cycleSort });
  const gridEl = h('div.poster-grid', { 'data-navgroup': '' });
  const scroller = h('div.grid-scroll', gridEl);
  scroller.addEventListener('scroll', () => { if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 900) more(); }, { passive: true });

  root.append(h('div.vod-layout',
    h('section.col.groups-col', h('div.col-head', h('div.hname', isSeries ? 'Series' : 'Movies')), gl.el),
    h('section.vod-main', h('div.col-head', h('div', titleEl, countEl), sortBtn), scroller)));

  function cycleSort() {
    const order = ['default', 'az', 'rating', 'year'];
    sort = order[(order.indexOf(sort) + 1) % order.length];
    store.set('vodSort', sort);
    select(group, true);
  }
  function select(g, force) {
    if (g === group && !force && list.length) return;
    group = g; store.set(key, g);
    const all = items();
    if (g === CONT) list = contMovies().map((c) => ({ ...c.item, _resume: c.r }));
    else if (g === RECENT) list = [...all].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 200);
    else if (g === FAVS) list = all.filter((m) => lib.favs.has(m.id));
    else if (g === ALL) list = all;
    else list = all.filter((m) => m.group === g);
    if (sort !== 'default' && g !== CONT) {
      list = [...list];
      if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
      if (sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      if (sort === 'year') list.sort((a, b) => String(b.year || '').localeCompare(String(a.year || '')));
    }
    sortBtn.innerHTML = icon('list') + `<span>${{ default: 'Default order', az: 'A–Z', rating: 'Top rated', year: 'Newest' }[sort]}</span>`;
    titleEl.textContent = g; countEl.textContent = list.length.toLocaleString() + ' titles';
    gridEl.replaceChildren(); shown = 0; scroller.scrollTop = 0;
    if (!list.length) gridEl.append(h('div.empty-state', { html: `${icon(isSeries ? 'series' : 'movie')}<span>Nothing here yet</span>` }));
    more(); gl.refresh();
  }
  function more() {
    if (shown >= list.length) return;
    const frag = document.createDocumentFragment();
    for (const m of list.slice(shown, shown + PAGE)) frag.append(poster(m));
    shown += PAGE;
    gridEl.append(frag);
  }
  function poster(m) {
    const img = m.logo || m.cover || m.meta?.logo;
    const r = m._resume || lib.resume[m.id];
    const el = h('button.poster', { onclick: () => (isSeries ? openSeries(m) : openMovie(m)) },
      h('div.art', { style: { background: nameGradient(m.name) } },
        h('span.ph', initials(m.name)),
        img && h('img', { src: imgUrl(img), loading: 'lazy', decoding: 'async', alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove(), onload: (e) => e.target.classList.add('ok') }),
        m.rating ? h('span.rating', { html: icon('star') + (+m.rating).toFixed(1) }) : null,
        lib.isFav(m.id) ? h('span.fav', { html: icon('star') }) : null,
        r ? h('span.progress', h('i', { style: { width: (r.pos / r.dur * 100) + '%' } })) : null),
      h('div.pt', m.name), h('div.ps', [m.year, m.group].filter(Boolean).join(' · ')));
    el.__keys = (k) => {
      if (k === 'left' && !hasLeft(el)) { gl.focus(); return true; }
      if (k === 'menu') { lib.toggleFav(m.id); toast(lib.isFav(m.id) ? 'Added to favorites' : 'Removed from favorites', { icon: 'star' }); return true; }
      return false;
    };
    return el;
  }
  const hasLeft = (el) => { const p = el.previousElementSibling; return p && p.getBoundingClientRect().top === el.getBoundingClientRect().top; };

  const groupsData = groups();
  if (!groupsData.some((g) => g.name === group)) group = RECENT;
  gl.setItems(groupsData, Math.max(0, groupsData.findIndex((g) => g.name === group)));
  select(group, true);
  if (arg?.open) { const it = lib.byId.get(arg.open); if (it) setTimeout(() => (isSeries ? openSeries(it) : openMovie(it)), 50); }
  const off = lib.on('change', () => { gl.setItems(groups(), gl.index); select(group, true); });

  return {
    focus: () => (gridEl.querySelector('.poster') ? nav.focus(gridEl._last?.isConnected ? gridEl._last : gridEl.querySelector('.poster')) : gl.focus()),
    back: () => { if (gridEl.contains(document.activeElement)) { gl.focus(); return true; } return false; },
    destroy: off,
  };
}

const contMovies = () => lib.continueWatching().filter((c) => (c.r.meta?.kind || 'movie') === 'movie' && lib.byId.has(c.id));

// ------------------------------------------------------------------ movie detail
async function openMovie(m) {
  const src = lib.source(m.src);
  const body = h('div.detail-body', spinner('Loading details'));
  const hero = h('div.detail-hero', { style: { background: nameGradient(m.name) } });
  const md = modal([hero, body], { className: 'detail' });
  let info = {};
  if (src?.type === 'xtream') {
    try { const r = await lib.xtream(src).api('get_vod_info', { vod_id: m.xid }); info = r?.info || {}; } catch {}
  }
  const backdrop = (Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path) || info.cover_big || m.logo;
  if (backdrop) hero.append(h('img', { src: imgUrl(backdrop), alt: '', referrerpolicy: 'no-referrer', onload: (e) => e.target.classList.add('ok'), onerror: (e) => e.target.remove() }));
  const r = lib.resume[m.id];
  const url = lib.movieUrl(m);
  const play = (startAt = 0) => { md.close(); player.playVod(m, url, { kind: 'movie', startAt, subtitle: [info.releasedate?.slice(0, 4) || m.year, info.genre].filter(Boolean).join(' · ') }); };
  const fav = () => lib.isFav(m.id);
  const favBtn = h('button.btn.ghost', { onclick: () => { lib.toggleFav(m.id); favBtn.classList.toggle('on', fav()); favBtn.querySelector('span').textContent = fav() ? 'Favorited' : 'Favorite'; }, html: icon('star') + `<span>${fav() ? 'Favorited' : 'Favorite'}</span>` });
  favBtn.classList.toggle('on', fav());
  const meta = [info.releasedate?.slice(0, 4) || m.year, info.duration || (info.duration_secs ? fmtDuration(info.duration_secs) : ''), info.genre, m.rating ? '★ ' + (+m.rating).toFixed(1) : ''].filter(Boolean);
  body.replaceChildren(
    h('div.detail-main',
      h('div.detail-poster', { style: { background: nameGradient(m.name) } }, h('span.ph', initials(m.name)), (info.movie_image || m.logo) && h('img', { src: imgUrl(info.movie_image || m.logo), alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })),
      h('div.detail-text',
        h('h1', info.name || m.name),
        h('div.meta-row', meta.map((x) => h('span', x))),
        h('p.plot', info.plot || info.description || 'No description available.'),
        info.cast && h('p.muted.small', h('b', 'Cast '), info.cast),
        info.director && h('p.muted.small', h('b', 'Director '), info.director),
        h('div.row.gap.wrap.actions',
          r ? h('button.btn.primary', { 'data-autofocus': true, onclick: () => play(r.pos), html: icon('play') + `<span>Resume · ${fmtDuration(r.pos)}</span>` }) : null,
          h('button.btn' + (r ? '.ghost' : '.primary'), { 'data-autofocus': !r || undefined, onclick: () => play(0), html: icon(r ? 'rewind' : 'play') + `<span>${r ? 'From start' : 'Play'}</span>` }),
          favBtn,
          info.youtube_trailer && h('a.btn.ghost', { href: 'https://www.youtube.com/watch?v=' + info.youtube_trailer, target: '_blank', rel: 'noopener', html: icon('movie') + '<span>Trailer</span>' })))),
  );
  setTimeout(() => nav.focusFirst(md.el), 20);
}

// ------------------------------------------------------------------ series detail
async function openSeries(s) {
  const src = lib.source(s.src);
  const body = h('div.detail-body', spinner('Loading episodes'));
  const hero = h('div.detail-hero', { style: { background: nameGradient(s.name) } });
  const md = modal([hero, body], { className: 'detail' });
  let info = {}, seasons = new Map();
  try {
    if (src?.type === 'xtream') {
      const r = await lib.xtream(src).api('get_series_info', { series_id: s.xid });
      info = r?.info || {};
      const eps = r?.episodes || {};
      for (const [sn, arr] of Object.entries(eps)) {
        seasons.set(+sn, (arr || []).map((e) => ({
          id: `${s.src}:e${e.id}`, title: e.title || `Episode ${e.episode_num}`, episode: +e.episode_num, season: +sn,
          url: lib.xtream(src).episodeUrl(e.id, e.container_extension), plot: e.info?.plot || '', img: e.info?.movie_image || '', dur: e.info?.duration || '',
        })).sort((a, b) => a.episode - b.episode));
      }
    } else {
      for (const e of s.m3uEpisodes || []) { if (!seasons.has(e.season)) seasons.set(e.season, []); seasons.get(e.season).push({ ...e }); }
      for (const a of seasons.values()) a.sort((x, y) => x.episode - y.episode);
    }
  } catch (e) { body.replaceChildren(h('p.muted', 'Could not load series: ' + e.message)); return; }
  const backdrop = (Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path) || s.backdrop || s.cover;
  if (backdrop) hero.append(h('img', { src: imgUrl(backdrop), alt: '', referrerpolicy: 'no-referrer', onload: (e) => e.target.classList.add('ok'), onerror: (e) => e.target.remove() }));
  const sNums = [...seasons.keys()].sort((a, b) => a - b);
  const flat = sNums.flatMap((n) => seasons.get(n));
  // find the episode to continue
  const lastWatched = flat.filter((e) => lib.resume[e.id]).sort((a, b) => lib.resume[b.id].t - lib.resume[a.id].t)[0];
  let season = lastWatched?.season ?? sNums[0];
  const epList = h('div.episodes', { 'data-navgroup': '' });
  const tabs = h('div.season-tabs', { 'data-navgroup': '' });
  const playEp = (ep, startAt = 0) => {
    md.close();
    const idx = flat.indexOf(ep);
    const mk = (e) => ({ id: e.id, name: e.title, logo: e.img || s.cover, group: s.name });
    const nextFn = (i) => () => {
      const n = flat[i + 1]; if (!n) return null;
      return { item: mk(n), url: n.url, opts: { kind: 'episode', subtitle: `${s.name} · S${n.season} E${n.episode}`, next: nextFn(i + 1) } };
    };
    store.set('lastEp:' + s.id, ep.id);
    player.playVod(mk(ep), ep.url, { kind: 'episode', startAt, subtitle: `${s.name} · S${ep.season} E${ep.episode}`, next: nextFn(idx) });
  };
  // Season tabs are built once and only change state; the episode list is rebuilt
  // only when the season actually changes (debounced while sliding along the tabs).
  // Rebuilding the tabs under the focus used to drop focus and make the screen jump.
  const tabBtns = new Map(sNums.map((n) => [n, h('button.tab', { onclick: () => setSeason(n, true), onfocus: () => setSeason(n) }, `Season ${n}`)]));
  tabs.replaceChildren(...tabBtns.values());
  let seasonT, drawn = null;
  const lastEp = new Map(); // season -> last focused episode button
  function setSeason(n, now = false) {
    season = n;
    for (const [k, b] of tabBtns) b.classList.toggle('active', k === n);
    clearTimeout(seasonT);
    if (now) drawEpisodes(); else seasonT = setTimeout(drawEpisodes, 180);
  }
  function drawEpisodes() {
    if (drawn === season) return;
    drawn = season;
    epList.replaceChildren(...(seasons.get(season) || []).map((e) => {
      const r = lib.resume[e.id];
      return h('button.episode', { onclick: () => playEp(e, r?.pos || 0), onfocus: (ev) => lastEp.set(season, ev.currentTarget) },
        h('div.ep-img', { style: { background: nameGradient(s.name + e.episode) } }, e.img && h('img', { src: imgUrl(e.img), loading: 'lazy', decoding: 'async', alt: '', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }), h('span.ep-n', 'E' + e.episode),
          r && h('span.progress', h('i', { style: { width: (r.pos / r.dur * 100) + '%' } }))),
        h('div.ep-text', h('b', e.title), e.dur && h('small.muted', e.dur), e.plot && h('p.small.muted', e.plot)));
    }));
  }
  // Remote: tabs row ↔ episodes ↔ buttons, without geometric guessing
  tabs.__keys = (k) => {
    if (k === 'down') { drawEpisodes(); const ep = lastEp.get(season)?.isConnected ? lastEp.get(season) : epList.querySelector('.episode'); if (ep) nav.focus(ep); return true; }
    if (k === 'up') { nav.focus(body.querySelector('.actions .btn')); return true; }
    if (k === 'left' || k === 'right') { const i = sNums.indexOf(season) + (k === 'right' ? 1 : -1); if (sNums[i] != null) tabBtns.get(sNums[i]).focus(); return true; }
    return false;
  };
  epList.__keys = (k) => {
    if (k === 'up') {
      const el = document.activeElement, r = el.getBoundingClientRect();
      const above = [...epList.children].some((c) => c.getBoundingClientRect().bottom <= r.top + 1);
      if (!above) { tabBtns.get(season)?.focus(); return true; }
    }
    return false;
  };
  setSeason(season, true);
  const contEp = lastWatched || flat[0];
  const fav = () => lib.isFav(s.id);
  const favBtn = h('button.btn.ghost' + (fav() ? '.on' : ''), { onclick: () => { lib.toggleFav(s.id); favBtn.classList.toggle('on', fav()); }, html: icon('star') + '<span>Favorite</span>' });
  body.replaceChildren(
    h('div.detail-main',
      h('div.detail-poster', { style: { background: nameGradient(s.name) } }, h('span.ph', initials(s.name)), (info.cover || s.cover) && h('img', { src: imgUrl(info.cover || s.cover), alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })),
      h('div.detail-text',
        h('h1', info.name || s.name),
        h('div.meta-row', [info.releaseDate?.slice(0, 4) || s.year, info.genre || s.genre, `${sNums.length} season${sNums.length === 1 ? '' : 's'}`, s.rating ? '★ ' + (+s.rating).toFixed(1) : ''].filter(Boolean).map((x) => h('span', x))),
        h('p.plot', info.plot || s.plot || ''),
        info.cast && h('p.muted.small', h('b', 'Cast '), info.cast),
        h('div.row.gap.wrap.actions',
          contEp && h('button.btn.primary', { 'data-autofocus': true, onclick: () => playEp(contEp, lib.resume[contEp.id]?.pos || 0), html: icon('play') + `<span>${lastWatched ? 'Continue' : 'Play'} S${contEp.season} E${contEp.episode}</span>` }),
          favBtn))),
    sNums.length ? tabs : h('p.muted', 'No episodes found'), epList);
  const actions = body.querySelector('.actions');
  if (actions && sNums.length) actions.__keys = (k) => { if (k === 'down') { tabBtns.get(season)?.focus(); return true; } return false; };
  setTimeout(() => nav.focusFirst(md.el), 20);
}
