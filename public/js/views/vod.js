import { h, esc, fmtDuration, nameGradient, initials, store, debounce, rem } from '../util.js';
import { imgUrl } from '../util.js';
import { VList } from '../vlist.js';
import { lib } from '../library.js';
import { player } from '../player.js';
import { icon, modal, toast, spinner, choose } from '../ui.js';
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
    base.unshift({ name: CONT, count: isSeries ? contSeries().length : contMovies().length });
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
    if (g === CONT) list = isSeries ? contSeries() : contMovies().map((c) => ({ ...c.item, _resume: c.r }));
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
        img && h('img', { src: imgUrl(img, 342), loading: 'lazy', decoding: 'async', alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove(), onload: (e) => e.target.classList.add('ok') }),
        m.rating ? h('span.rating', { html: icon('star') + (+m.rating).toFixed(1) }) : null,
        lib.isFav(m.id) ? h('span.fav', { html: icon('star') }) : null,
        !isSeries && lib.isWatched(m.id) ? h('span.watched-badge', { html: icon('check') }) : null,
        isSeries && lib.seriesProg[m.id] ? h('span.ep-badge', lib.seriesProg[m.id].label) : null,
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

const contSeries = () => Object.entries(lib.seriesProg).sort((a, b) => b[1].t - a[1].t).map(([id]) => lib.byId.get(id)).filter(Boolean);
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
  if (backdrop) hero.append(h('img', { src: imgUrl(backdrop, 1280), alt: '', referrerpolicy: 'no-referrer', onload: (e) => e.target.classList.add('ok'), onerror: (e) => e.target.remove() }));
  const r = lib.resume[m.id];
  const url = lib.movieUrl(m);
  const play = (startAt = 0) => { md.close(); player.playVod(m, url, { kind: 'movie', startAt, subtitle: [info.releasedate?.slice(0, 4) || m.year, info.genre].filter(Boolean).join(' · ') }); };
  const fav = () => lib.isFav(m.id);
  const favBtn = h('button.btn.ghost', { onclick: () => { lib.toggleFav(m.id); favBtn.classList.toggle('on', fav()); favBtn.querySelector('span').textContent = fav() ? 'Favorited' : 'Favorite'; }, html: icon('star') + `<span>${fav() ? 'Favorited' : 'Favorite'}</span>` });
  const wLabel = () => (lib.isWatched(m.id) ? 'Watched ✓' : 'Mark as watched');
  const watchedBtn = h('button.btn.ghost', { onclick: () => { lib.markWatched(m.id, !lib.isWatched(m.id)); watchedBtn.querySelector('span').textContent = wLabel(); watchedBtn.classList.toggle('on', lib.isWatched(m.id)); }, html: icon('check') + `<span>${wLabel()}</span>` });
  watchedBtn.classList.toggle('on', lib.isWatched(m.id));
  favBtn.classList.toggle('on', fav());
  const meta = [info.releasedate?.slice(0, 4) || m.year, info.duration || (info.duration_secs ? fmtDuration(info.duration_secs) : ''), info.genre, m.rating ? '★ ' + (+m.rating).toFixed(1) : ''].filter(Boolean);
  body.replaceChildren(
    h('div.detail-main',
      h('div.detail-poster', { style: { background: nameGradient(m.name) } }, h('span.ph', initials(m.name)), (info.movie_image || m.logo) && h('img', { src: imgUrl(info.movie_image || m.logo, 342), alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })),
      h('div.detail-text',
        h('h1', info.name || m.name),
        h('div.meta-row', meta.map((x) => h('span', x))),
        h('p.plot', info.plot || info.description || 'No description available.'),
        info.cast && h('p.muted.small', h('b', 'Cast '), info.cast),
        info.director && h('p.muted.small', h('b', 'Director '), info.director),
        h('div.row.gap.wrap.actions',
          r ? h('button.btn.primary', { 'data-autofocus': true, onclick: () => play(r.pos), html: icon('play') + `<span>Resume · ${fmtDuration(r.pos)}</span>` }) : null,
          h('button.btn' + (r ? '.ghost' : '.primary'), { 'data-autofocus': !r || undefined, onclick: () => play(0), html: icon(r ? 'rewind' : 'play') + `<span>${r ? 'From start' : 'Play'}</span>` }),
          favBtn, watchedBtn,
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
  if (backdrop) hero.append(h('img', { src: imgUrl(backdrop, 1280), alt: '', referrerpolicy: 'no-referrer', onload: (e) => e.target.classList.add('ok'), onerror: (e) => e.target.remove() }));
  const sNums = [...seasons.keys()].sort((a, b) => a - b);
  const flat = sNums.flatMap((n) => seasons.get(n));
  // ---- watched state: what to continue, what's up next
  const stamp = (e) => Math.max(lib.resume[e.id]?.t || 0, lib.watched[e.id] || 0);
  function nextUp() {
    const recent = flat.filter(stamp).sort((a, b) => stamp(b) - stamp(a))[0];
    if (recent && lib.resume[recent.id]) return { ep: recent, label: 'Continue', upNext: false };
    if (recent) {
      const nxt = flat.slice(flat.indexOf(recent) + 1).find((e) => !lib.isWatched(e.id)) || flat.find((e) => !lib.isWatched(e.id));
      if (nxt) return { ep: nxt, label: 'Continue', upNext: true };
      return { ep: flat[0], label: 'Watch again', upNext: false };
    }
    return { ep: flat[0], label: 'Play', upNext: false };
  }
  let cont = nextUp();
  let season = cont.ep?.season ?? sNums[0];
  const epList = h('div.episodes', { 'data-navgroup': '', 'data-longpress': '' });
  const tabs = h('div.season-tabs', { 'data-navgroup': '' });
  const mk = (e) => ({ id: e.id, name: e.title, logo: e.img || s.cover, group: s.name });
  const nextFn = (i) => () => {
    const n = flat[i + 1]; if (!n) return null;
    lib.noteSeries(s.id, n);
    return { item: mk(n), url: n.url, opts: { kind: 'episode', subtitle: `${s.name} · S${n.season} E${n.episode}`, next: nextFn(i + 1) } };
  };
  const playEp = (ep, startAt = 0) => {
    md.close();
    lib.noteSeries(s.id, ep);
    player.playVod(mk(ep), ep.url, { kind: 'episode', startAt, subtitle: `${s.name} · S${ep.season} E${ep.episode}`, next: nextFn(flat.indexOf(ep)) });
  };

  // Season tabs are built once and only change state; the episode list is rebuilt
  // only when the season actually changes (debounced while sliding along the tabs).
  const tabBtns = new Map(sNums.map((n) => [n, h('button.tab', { onclick: () => setSeason(n, true), onfocus: () => setSeason(n) }, h('span', `Season ${n}`), h('small.tab-count'))]));
  tabs.replaceChildren(...tabBtns.values());
  function updateTabs() {
    for (const [n, b] of tabBtns) {
      const eps = seasons.get(n) || [];
      const w = eps.filter((e) => lib.isWatched(e.id)).length;
      const c = b.querySelector('.tab-count');
      c.textContent = w === eps.length && w ? '✓' : w ? `${w}/${eps.length}` : '';
      b.classList.toggle('done', w === eps.length && w > 0);
    }
  }
  let seasonT, drawn = null;
  const lastEp = new Map(); // season -> index of last focused episode
  function setSeason(n, now = false) {
    season = n;
    for (const [k, b] of tabBtns) b.classList.toggle('active', k === n);
    clearTimeout(seasonT);
    if (now) drawEpisodes(); else seasonT = setTimeout(drawEpisodes, 180);
  }
  const left = (r) => { const m = Math.max(1, Math.round((r.dur - r.pos) / 60)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`; };
  function epTile(e, i) {
    const r = lib.resume[e.id], w = lib.isWatched(e.id), up = cont.upNext && cont.ep === e;
    const btn = h('button.episode' + (w ? '.watched' : '') + (up ? '.upnext' : ''), { onclick: () => playEp(e, r?.pos || 0), onfocus: () => lastEp.set(season, i) },
      h('div.ep-img', { style: { background: nameGradient(s.name + e.episode) } },
        e.img && h('img', { src: imgUrl(e.img, 320), loading: 'lazy', decoding: 'async', alt: '', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }),
        h('span.ep-n', 'E' + e.episode),
        w && h('span.ep-check', { html: icon('check') }),
        r && h('span.progress', h('i', { style: { width: (r.pos / r.dur * 100) + '%' } }))),
      h('div.ep-text',
        up && h('span.ep-up', 'UP NEXT'),
        h('b', e.title),
        h('small.ep-state', w ? 'Watched' : r ? left(r) : (e.dur || '')),
        e.plot && h('p.small.muted', e.plot)));
    btn.__ep = e;
    return btn;
  }
  function drawEpisodes(force = false) {
    if (drawn === season && !force) return;
    drawn = season;
    const focusIdx = epList.contains(document.activeElement) ? [...epList.children].indexOf(document.activeElement) : -1;
    epList.replaceChildren(...(seasons.get(season) || []).map(epTile));
    if (focusIdx > -1) epList.children[Math.min(focusIdx, epList.children.length - 1)]?.focus({ preventScroll: true });
  }
  function refreshState() {
    cont = nextUp();
    updateTabs();
    drawEpisodes(true);
    const wc = body.querySelector('.watched-count'), n = flat.filter((e) => lib.isWatched(e.id)).length;
    if (wc) { wc.textContent = `${n}/${flat.length} watched`; wc.hidden = !n; }
    const pb = body.querySelector('.actions .btn.primary span');
    if (pb && cont.ep) pb.textContent = `${cont.label} S${cont.ep.season} E${cont.ep.episode}`;
  }
  async function episodeMenu(e) {
    const w = lib.isWatched(e.id);
    const eps = seasons.get(e.season) || [];
    const c = await choose(`S${e.season} E${e.episode} · ${e.title}`, [
      { id: 'toggle', label: w ? 'Mark as unwatched' : 'Mark as watched' },
      { id: 'upto', label: `Mark watched up to here` },
      { id: 'season', label: `Mark season ${e.season} as watched` },
      { id: 'unseason', label: `Mark season ${e.season} as unwatched` },
      ...(lib.resume[e.id] ? [{ id: 'restart', label: 'Play from the beginning' }] : []),
    ]);
    if (!c) return;
    if (c.id === 'toggle') lib.markWatched(e.id, !w);
    if (c.id === 'upto') for (const x of flat.slice(0, flat.indexOf(e) + 1)) lib.markWatched(x.id, true);
    if (c.id === 'season') for (const x of eps) lib.markWatched(x.id, true);
    if (c.id === 'unseason') for (const x of eps) lib.markWatched(x.id, false);
    if (c.id === 'restart') return playEp(e, 0);
    refreshState();
  }
  // Remote: tabs row ↔ episodes ↔ buttons, without geometric guessing
  tabs.__keys = (k) => {
    if (k === 'down') {
      drawEpisodes();
      const eps = [...epList.children];
      const upIdx = cont.ep?.season === season ? eps.findIndex((b) => b.__ep === cont.ep) : -1;
      const ep = eps[lastEp.get(season) ?? (upIdx > -1 ? upIdx : 0)] || eps[0];
      if (ep) nav.focus(ep);
      return true;
    }
    if (k === 'up') { nav.focus(body.querySelector('.actions .btn')); return true; }
    if (k === 'left' || k === 'right') { const i = sNums.indexOf(season) + (k === 'right' ? 1 : -1); if (sNums[i] != null) tabBtns.get(sNums[i]).focus(); return true; }
    return false;
  };
  epList.__keys = (k) => {
    const el = document.activeElement;
    if (k === 'menu' || k === 'info' || k === 'longok') { if (el?.__ep) episodeMenu(el.__ep); return true; }
    if (k === 'up') {
      const r = el.getBoundingClientRect();
      const above = [...epList.children].some((c) => c.getBoundingClientRect().bottom <= r.top + 1);
      if (!above) { tabBtns.get(season)?.focus(); return true; }
    }
    return false;
  };
  epList.addEventListener('contextmenu', (ev) => { const b = ev.target.closest('.episode'); if (b?.__ep) { ev.preventDefault(); episodeMenu(b.__ep); } });
  updateTabs();
  setSeason(season, true);
  const contEp = cont.ep;
  const fav = () => lib.isFav(s.id);
  const favBtn = h('button.btn.ghost' + (fav() ? '.on' : ''), { onclick: () => { lib.toggleFav(s.id); favBtn.classList.toggle('on', fav()); }, html: icon('star') + '<span>Favorite</span>' });
  const watchedCount = flat.filter((e) => lib.isWatched(e.id)).length;
  body.replaceChildren(
    h('div.detail-main',
      h('div.detail-poster', { style: { background: nameGradient(s.name) } }, h('span.ph', initials(s.name)), (info.cover || s.cover) && h('img', { src: imgUrl(info.cover || s.cover, 342), alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })),
      h('div.detail-text',
        h('h1', info.name || s.name),
        h('div.meta-row', [info.releaseDate?.slice(0, 4) || s.year, info.genre || s.genre, `${sNums.length} season${sNums.length === 1 ? '' : 's'}`, s.rating ? '★ ' + (+s.rating).toFixed(1) : ''].filter(Boolean).map((x) => h('span', x)), h('span.watched-count', { hidden: !watchedCount }, `${watchedCount}/${flat.length} watched`)),
        h('p.plot', info.plot || s.plot || ''),
        info.cast && h('p.muted.small', h('b', 'Cast '), info.cast),
        h('div.row.gap.wrap.actions',
          contEp && h('button.btn.primary', { 'data-autofocus': true, onclick: () => playEp(cont.ep, lib.resume[cont.ep.id]?.pos || 0), html: icon('play') + `<span>${cont.label} S${contEp.season} E${contEp.episode}</span>` }),
          favBtn))),
    sNums.length ? tabs : h('p.muted', 'No episodes found'),
    sNums.length ? h('p.ep-hint.muted.small', { html: '<b>Hold OK</b> (or press <kbd>Menu</kbd>) on an episode to mark it watched / unwatched' }) : null,
    epList);
  const actions = body.querySelector('.actions');
  if (actions && sNums.length) actions.__keys = (k) => { if (k === 'down') { tabBtns.get(season)?.focus(); return true; } return false; };
  setTimeout(() => nav.focusFirst(md.el), 20);
}
