import { idb } from './db.js';
import { store, Emitter, uid, normName } from './util.js';
import { settings } from './settings.js';
import { fetchText, fetchRemote, hasProxy } from './net.js';
import { isNative } from './native.js';
import { parseM3U, groupEpisodes } from './m3u.js';
import { Xtream } from './xtream.js';

export const FAV_GROUP = '★ Favorites';
export const RECENT_GROUP = '⟲ Recently watched';
export const ALL_GROUP = 'All channels';

class Library extends Emitter {
  sources = store.get('sources', []);
  live = []; movies = []; series = [];
  byId = new Map();
  liveGroups = []; movieGroups = []; seriesGroups = [];
  favs = new Set(store.get('favs', []));
  recents = store.get('recents', []);
  resume = store.get('resume', {});
  watched = store.get('watched', {});        // movie/episode id -> time it was finished
  seriesProg = store.get('seriesProg', {});  // series id -> { ep, label, t } last episode started
  reminders = store.get('reminders', []);
  // EPG
  epg = { channels: {}, progs: {} };
  epgIndex = new Map(); // channel.id -> programme array
  epgLoading = false;
  #xtreams = new Map();

  /** Only small metadata goes to localStorage; catalogs (_cat) live in IndexedDB. */
  saveSources() {
    const ok = store.set('sources', this.sources.map(({ _cat, content, ...meta }) => meta));
    if (!ok) console.error('Could not save playlists to local storage');
  }
  xtream(src) {
    if (!src || src.type !== 'xtream') return null;
    let x = this.#xtreams.get(src.id);
    if (!x) { x = new Xtream(src); this.#xtreams.set(src.id, x); }
    return x;
  }
  source(id) { return this.sources.find((s) => s.id === id); }

  // ---------------- loading ----------------
  async init() {
    for (const s of this.sources) {
      const cat = await idb.get('cat:' + s.id);
      if (cat) s._cat = cat;
    }
    this.rebuild();
    await this.loadEpgFromCache();
    this.backgroundRefresh();
  }

  async addSource(def, onStep, { activate = false } = {}) {
    const src = { id: uid(), name: def.name || 'Playlist', ...def, added: Date.now() };
    await this.refreshSource(src, onStep);
    this.sources.push(src);
    this.saveSources();
    if (activate || this.sources.length === 1) settings.set('activeSource', src.id);
    this.rebuild();
    if (activate) this.emit('active');
    this.refreshEpg().catch(() => {});
    return src;
  }

  async removeSource(id) {
    const wasActive = this.activeId() === id;
    this.sources = this.sources.filter((s) => s.id !== id);
    if (wasActive) settings.set('activeSource', this.sources[0]?.id || 'all');
    this.saveSources();
    await idb.del('cat:' + id); await idb.del('epg:' + id);
    this.#xtreams.delete(id);
    this.rebuild();
    await this.loadEpgFromCache();
  }

  async refreshSource(src, onStep = () => {}) {
    let cat;
    if (src.type === 'xtream') {
      this.#xtreams.delete(src.id);
      const x = this.xtream(src);
      cat = await x.load(src.id, onStep);
      if (!src.epgUrl) src.epgUrl = x.epgUrl();
      src.account = cat.account;
    } else {
      onStep('Downloading playlist');
      const text = src.content ?? await fetchText(src.url, {
        onProgress: (l) => onStep(`Downloading playlist · ${(l / 1048576).toFixed(1)} MB`),
      });
      onStep('Parsing');
      if (!/#EXTINF|#EXTM3U/.test(text.slice(0, 5000))) throw new Error('This does not look like an M3U playlist');
      const p = parseM3U(text, src.id);
      cat = { live: p.live, movies: p.movies, series: groupEpisodes(p.episodes, src.id) };
      if (!src.epgUrl && p.epgUrl) src.epgUrl = p.epgUrl;
      delete src.content;
    }
    if (!cat.live.length && !cat.movies.length && !cat.series.length) throw new Error('Playlist is empty');
    src.updated = Date.now();
    src.counts = { live: cat.live.length, movies: cat.movies.length, series: cat.series.length };
    src._cat = cat;
    await idb.set('cat:' + src.id, cat);
    this.saveSources();
    return src;
  }

  async refreshAll(onStep) {
    for (const s of this.sources) {
      if (s.local) continue;
      try { await this.refreshSource(s, onStep); } catch (e) { console.warn('refresh failed', s.name, e); }
    }
    this.rebuild();
    await this.refreshEpg(true);
  }

  backgroundRefresh() {
    const h = settings.get('playlistAutoRefreshHours');
    const stale = this.sources.filter((s) => !s.local && h > 0 && Date.now() - (s.updated || 0) > h * 3600e3);
    (async () => {
      for (const s of stale) {
        try { await this.refreshSource(s); this.rebuild(); } catch {}
      }
      const eh = settings.get('epgAutoRefreshHours');
      const epgStale = this.sources.some((s) => s.epgUrl && (!s.epgUpdated || Date.now() - s.epgUpdated > eh * 3600e3));
      if (epgStale || stale.length) this.refreshEpg().catch(() => {});
    })();
  }

  // ---------------- active playlist ----------------
  /** id of the playlist being watched, or 'all' for every playlist combined */
  activeId() {
    const a = settings.get('activeSource');
    if (a === 'all' && this.sources.length > 1) return 'all';
    return this.sources.some((s) => s.id === a) ? a : (this.sources[0]?.id || 'all');
  }
  activeSources() { const a = this.activeId(); return a === 'all' ? this.sources : this.sources.filter((s) => s.id === a); }
  activeName() { const a = this.activeId(); return a === 'all' ? 'All playlists' : this.source(a)?.name || ''; }
  // ---- structure-only diagnostics (sent to the owner's portal when remote management is on)
  diag = {};
  noteSeriesDiag(r) {
    try {
      const eps = r?.episodes;
      const first = Array.isArray(eps) ? eps.flat()[0] : Object.values(eps || {})[0]?.[0] || Object.values(Object.values(eps || {})[0] || {})[0];
      let info = first?.info;
      if (typeof info === 'string') { try { info = JSON.parse(info); } catch {} }
      const short = (v) => (typeof v === 'string' ? v.slice(0, 90) : v === undefined ? undefined : typeof v);
      this.diag.series = {
        at: Date.now(), topKeys: Object.keys(r || {}), episodesType: Array.isArray(eps) ? 'array' : typeof eps,
        seasonKeys: eps && !Array.isArray(eps) ? Object.keys(eps).slice(0, 10) : undefined,
        episodeKeys: first ? Object.keys(first) : [], infoType: (typeof first?.info === 'string' ? 'string→' : '') + (Array.isArray(info) ? 'array' : typeof info),
        infoKeys: info && typeof info === 'object' ? Object.keys(info) : [],
        sample: first ? { movie_image: short(info?.movie_image ?? first.movie_image), cover_big: short(info?.cover_big), plot: short(info?.plot ?? first.plot), description: short(info?.description) } : null,
      };
      this.diag.images = { ok: 0, failed: 0 };
    } catch {}
  }
  noteImg(ok, url) {
    const d = (this.diag.images ||= { ok: 0, failed: 0 });
    ok ? d.ok++ : (d.failed++, d.failedExample ||= String(url).slice(0, 120));
  }

  findChannel(id) { return this.byId.get(id) || this.allById?.get(id) || null; }
  recentChannels(n = 20) { return this.recents.map((id) => this.findChannel(id)).filter((c) => c && c.num !== undefined).slice(0, n); }
  /** Live channels of any playlist (active or not), e.g. for multi-view */
  channelsOf(srcId) {
    const hidden = new Set(settings.get('hiddenGroups'));
    return (this.source(srcId)?._cat?.live || []).filter((c) => !hidden.has(c.group));
  }
  /** How many streams this playlist may play at once (provider info, user override, else 1) */
  maxStreams(src) {
    if (!src) return 1;
    return Number(src.maxConn) || Number(src.account?.maxConn) || 1;
  }
  setActive(id) {
    if (id === this.activeId()) return;
    settings.set('activeSource', id);
    this.rebuild();
    this.emit('active', id);
  }

  rebuild() {
    const hidden = new Set(settings.get('hiddenGroups'));
    this.live = []; this.movies = []; this.series = [];
    this.byId.clear();
    const lg = new Map(), mg = new Map(), sg = new Map();
    const multi = this.sources.length > 1;
    for (const s of this.activeSources()) {
      const c = s._cat; if (!c) continue;
      const pre = (g) => (multi ? `${g}` : g);
      const order = c.groupOrder || {};
      for (const g of order.live || []) if (!lg.has(pre(g))) lg.set(pre(g), 0);
      for (const g of order.movies || []) if (!mg.has(pre(g))) mg.set(pre(g), 0);
      for (const g of order.series || []) if (!sg.has(pre(g))) sg.set(pre(g), 0);
      for (const ch of c.live) {
        this.byId.set(ch.id, ch);
        if (hidden.has(ch.group)) continue;
        this.live.push(ch); lg.set(ch.group, (lg.get(ch.group) || 0) + 1);
      }
      for (const m of c.movies) { this.byId.set(m.id, m); if (hidden.has(m.group)) continue; this.movies.push(m); mg.set(m.group, (mg.get(m.group) || 0) + 1); }
      for (const m of c.series) { this.byId.set(m.id, m); if (hidden.has(m.group)) continue; this.series.push(m); sg.set(m.group, (sg.get(m.group) || 0) + 1); }
    }
    const toList = (m) => [...m].filter(([, n]) => n > 0).map(([name, count]) => ({ name, count }));
    this.liveGroups = toList(lg);
    this.movieGroups = toList(mg);
    this.seriesGroups = toList(sg);
    // every playlist's channels by id (recent channels can come from any playlist)
    this.allById = new Map();
    for (const s of this.sources) for (const ch of s._cat?.live || []) this.allById.set(ch.id, ch);
    this.allLiveGroups = [...new Set(this.sources.flatMap((s) => (s._cat?.live || []).map((c) => c.group)))];
    this.allVodGroups = [...new Set(this.sources.flatMap((s) => [...(s._cat?.movies || []), ...(s._cat?.series || [])].map((c) => c.group)))];
    this.buildEpgIndex();
    this.emit('change');
  }

  channelsIn(group) {
    if (group === FAV_GROUP) return this.live.filter((c) => this.favs.has(c.id));
    if (group === RECENT_GROUP) return this.recentChannels(40);
    if (group === ALL_GROUP || !group) return this.live;
    return this.live.filter((c) => c.group === group);
  }
  isLocked(group) { return !!settings.get('parentalPin') && settings.get('lockedGroups').includes(group); }

  // ---------------- favourites / history ----------------
  toggleFav(id) {
    this.favs.has(id) ? this.favs.delete(id) : this.favs.add(id);
    store.set('favs', [...this.favs]);
    this.emit('favs');
    return this.favs.has(id);
  }
  isFav(id) { return this.favs.has(id); }
  addRecent(id) {
    this.recents = [id, ...this.recents.filter((x) => x !== id)].slice(0, 40);
    store.set('recents', this.recents);
    store.set('lastChannel', id);
  }
  setResume(id, pos, dur, meta) {
    if (!dur || !isFinite(dur) || dur < 120) return;
    // reaching the credits counts as watched
    if (pos > dur - Math.min(180, dur * 0.05) || pos / dur > 0.95) { this.markWatched(id, true); return; }
    if (pos < 30 || pos > dur - 60) delete this.resume[id];
    else this.resume[id] = { pos, dur, t: Date.now(), meta: meta || this.resume[id]?.meta };
    store.set('resume', this.resume);
  }
  markWatched(id, on = true) {
    if (on) { this.watched[id] = Date.now(); delete this.resume[id]; store.set('resume', this.resume); }
    else delete this.watched[id];
    store.set('watched', this.watched);
    this.emit('watched');
  }
  isWatched(id) { return !!this.watched[id]; }
  noteSeries(seriesId, ep) {
    this.seriesProg[seriesId] = { ep: ep.id, label: `S${ep.season} E${ep.episode}`, t: Date.now() };
    store.set('seriesProg', this.seriesProg);
  }
  continueWatching() {
    return Object.entries(this.resume).sort((a, b) => b[1].t - a[1].t).map(([id, r]) => ({ item: this.byId.get(id) || this.resume[id].meta, r, id })).filter((x) => x.item);
  }

  // ---------------- reminders ----------------
  toggleReminder(ch, p) {
    const key = ch.id + '@' + p[0];
    const i = this.reminders.findIndex((r) => r.key === key);
    if (i > -1) this.reminders.splice(i, 1);
    else this.reminders.push({ key, ch: ch.id, start: p[0], title: p[2] });
    this.reminders = this.reminders.filter((r) => r.start > Date.now() - 600e3);
    store.set('reminders', this.reminders);
    return i === -1;
  }
  hasReminder(ch, start) { return this.reminders.some((r) => r.key === ch.id + '@' + start); }

  // ---------------- EPG ----------------
  async loadEpgFromCache() {
    const merged = { channels: {}, progs: {} };
    for (const s of this.sources) {
      const e = await idb.get('epg:' + s.id);
      if (e) { Object.assign(merged.channels, e.channels); Object.assign(merged.progs, e.progs); }
    }
    this.epg = merged;
    this.buildEpgIndex();
    this.emit('epg');
  }

  async refreshEpg(force = false, onProgress) {
    if (this.epgLoading) return;
    this.epgLoading = true;
    this.emit('epg-status', { loading: true });
    try {
      for (const s of this.sources) {
        if (!s.epgUrl) continue;
        const eh = settings.get('epgAutoRefreshHours');
        if (!force && s.epgUpdated && Date.now() - s.epgUpdated < eh * 3600e3) continue;
        try {
          const data = await this.#parseEpg(s.epgUrl, (p) => { onProgress?.(p, s); this.emit('epg-status', { loading: true, ...p, source: s.name }); }, s);
          if (!Object.keys(data.progs).length) throw new Error('The guide downloaded but had no programmes for your channels');
          await idb.set('epg:' + s.id, data);
          s.epgUpdated = Date.now(); s.epgCount = Object.keys(data.progs).length;
          s.epgError = '';
        } catch (e) {
          s.epgError = e.message;
          console.warn('EPG failed', e);
          import('./ui.js').then(({ toast }) => toast(`TV guide failed (${s.name}): ${e.message}`, { type: 'error', icon: 'guide', ms: 9000 }));
        }
        this.saveSources();
      }
      await this.loadEpgFromCache();
    } finally {
      this.epgLoading = false;
      this.emit('epg-status', { loading: false });
    }
  }

  async #parseEpg(url, onProgress, src) {
    // Only keep programmes for channels in this playlist, and only the window we
    // actually show: big provider guides otherwise exhaust memory on TV boxes.
    const chans = src?._cat?.live || [];
    const wanted = chans.length ? {
      ids: [...new Set(chans.map((c) => (c.epgId || '').toLowerCase()).filter(Boolean))],
      names: [...new Set(chans.map((c) => normName(c.tvgName || c.name)).filter(Boolean))],
    } : null;
    const catchupDays = Math.min(7, Math.max(0, ...chans.map((c) => c.catchup?.days || 0)));
    const now = Date.now();
    const from = now - Math.max(0.25, catchupDays) * 864e5, to = now + 3.5 * 864e5;
    const w = new Worker(new URL('./epg-worker.js', import.meta.url));
    const done = new Promise((resolve, reject) => {
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d.type === 'progress') onProgress?.(d);
        else if (d.type === 'done') { w.terminate(); resolve({ channels: d.channels, progs: d.progs }); }
        else if (d.type === 'error') { w.terminate(); reject(new Error(d.message)); }
      };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'EPG worker error')); };
    });
    const base = { from, to, wanted, uaHeader: settings.get('userAgent') };
    if (isNative) {
      // Page fetches (through the app's native proxy) and feeds the worker chunk by chunk
      w.postMessage({ ...base, streamed: true });
      let r;
      try { r = await fetchRemote(url); } catch (e) { w.terminate(); throw e; }
      const reader = r.body.getReader();
      try {
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          const buf = value.buffer.byteLength === value.byteLength ? value.buffer : value.slice().buffer;
          w.postMessage({ type: 'chunk', buf }, [buf]);
        }
        w.postMessage({ type: 'end' });
      } catch (e) { w.postMessage({ type: 'abort', message: e.message }); }
    } else {
      const fetchUrl = hasProxy() && settings.get('proxyMode') !== 'never' ? '/api/fetch?url=' + encodeURIComponent(url) : url;
      w.postMessage({ ...base, fetchUrl });
    }
    return done;
  }

  buildEpgIndex() {
    this.epgIndex.clear();
    const progs = this.epg.progs;
    const keys = Object.keys(progs);
    if (!keys.length) return;
    const lower = new Map(keys.map((k) => [k.toLowerCase(), k]));
    const byName = new Map();
    for (const [id, c] of Object.entries(this.epg.channels)) if (progs[id]) byName.set(normName(c.n), id);
    for (const k of keys) if (!byName.has(normName(k))) byName.set(normName(k.replace(/\.[a-z]{2,3}$/i, '')), k);
    for (const s of this.sources) for (const ch of s._cat?.live || []) {
      let k = ch.epgId && (progs[ch.epgId] ? ch.epgId : lower.get(ch.epgId.toLowerCase()));
      if (!k) k = byName.get(normName(ch.tvgName || ch.name));
      if (k) {
        this.epgIndex.set(ch.id, progs[k]);
        // Many providers only put channel logos in the guide data
        const icon = this.epg.channels[k]?.i;
        if (icon && (!ch.logo || ch.epgLogo)) ch.logo = ch.epgLogo = icon;
      }
    }
  }

  shift() { return (settings.get('epgTimeShift') || 0) * 3600e3; }

  /** Programme rows for a channel as objects in [from,to] */
  programmes(ch, from = -Infinity, to = Infinity) {
    const a = this.epgIndex.get(ch.id);
    if (!a) return [];
    const sh = this.shift(), out = [];
    for (let i = 0; i < a.length; i += 6) {
      const s = a[i] + sh, e = a[i + 1] + sh;
      if (e <= from) continue;
      if (s >= to) break;
      out.push({ start: s, stop: e, title: a[i + 2], desc: a[i + 3], cat: a[i + 4], ep: a[i + 5] });
    }
    return out;
  }
  /** Current & next programme (binary search) */
  nowNext(ch, t = Date.now()) {
    const a = this.epgIndex.get(ch.id);
    if (!a) return [null, null];
    const sh = this.shift();
    let lo = 0, hi = a.length / 6 - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, s = a[mid * 6] + sh;
      if (s <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const row = (i) => i >= 0 && i * 6 < a.length ? { start: a[i * 6] + sh, stop: a[i * 6 + 1] + sh, title: a[i * 6 + 2], desc: a[i * 6 + 3], cat: a[i * 6 + 4], ep: a[i * 6 + 5] } : null;
    let now = row(found);
    if (now && now.stop <= t) now = null;
    return [now, row(found + 1)];
  }

  // ---------------- playback URLs ----------------
  catchupUrl(ch, p) {
    const src = this.source(ch.src);
    if (!ch.catchup) return null;
    const dur = (p.stop - p.start) / 60000;
    if (src?.type === 'xtream') return this.xtream(src).catchupUrl(ch.xid, p.start - this.shift(), dur);
    const start = Math.floor((p.start - this.shift()) / 1000), end = Math.floor((p.stop - this.shift()) / 1000);
    const tpl = ch.catchup.source;
    const fill = (t) => t
      .replace(/\{utc\}|\$\{start\}/g, start).replace(/\{utcend\}|\$\{end\}/g, end)
      .replace(/\{lutc\}|\$\{now\}/g, Math.floor(Date.now() / 1000))
      .replace(/\{duration\}|\$\{duration\}/g, end - start)
      .replace(/\{offset:(\d+)\}/g, (_, d) => Math.floor((Date.now() / 1000 - start) / Number(d)))
      .replace(/\{(Y|m|d|H|M|S)\}/g, (_, k) => {
        const d = new Date(start * 1000);
        return String({ Y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds() }[k]).padStart(2, '0');
      });
    if (tpl) return /^https?:/.test(tpl) ? fill(tpl) : ch.url + fill(tpl);
    if (ch.catchup.type === 'flussonic' || ch.catchup.type === 'fs') {
      return ch.url.replace(/\/[^/]*?(index|mpegts|video)[^/]*\.(m3u8|ts)/, `/$1-${start}-${end - start}.$2`);
    }
    // "default"/"shift"/"append": utc query params
    return ch.url + (ch.url.includes('?') ? '&' : '?') + `utc=${start}&lutc=${Math.floor(Date.now() / 1000)}`;
  }
  canCatchup(ch, p) {
    return !!ch.catchup && p.stop < Date.now() + 60e3 && p.start > Date.now() - ch.catchup.days * 864e5;
  }
  movieUrl(m) {
    const src = this.source(m.src);
    return src?.type === 'xtream' ? this.xtream(src).movieUrl(m.xid, m.ext) : m.url;
  }
  liveUrl(ch) {
    const src = this.source(ch.src);
    return src?.type === 'xtream' ? this.xtream(src).liveUrl(ch.xid) : ch.url;
  }
}

export const lib = new Library();
