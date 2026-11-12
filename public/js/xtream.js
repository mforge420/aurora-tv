import { fetchJSON } from './net.js';
import { settings } from './settings.js';

export class Xtream {
  constructor({ server, user, pass }) {
    this.server = server.replace(/\/+$/, '');
    if (!/^https?:\/\//.test(this.server)) this.server = 'http://' + this.server;
    this.user = user; this.pass = pass;
  }
  api(action, extra = {}) {
    const q = new URLSearchParams({ username: this.user, password: this.pass, ...(action ? { action } : {}), ...extra });
    return fetchJSON(`${this.server}/player_api.php?${q}`);
  }
  async login() {
    const r = await this.api();
    if (!r?.user_info || String(r.user_info.auth) === '0') throw new Error('Login failed – check server, username and password');
    return r;
  }
  epgUrl() { return `${this.server}/xmltv.php?username=${encodeURIComponent(this.user)}&password=${encodeURIComponent(this.pass)}`; }
  liveUrl(id) {
    const ext = settings.get('xtreamFormat') === 'ts' ? 'ts' : 'm3u8';
    return `${this.server}/live/${enc(this.user)}/${enc(this.pass)}/${id}.${ext}`;
  }
  movieUrl(id, ext = 'mp4') { return `${this.server}/movie/${enc(this.user)}/${enc(this.pass)}/${id}.${ext || 'mp4'}`; }
  episodeUrl(id, ext = 'mp4') { return `${this.server}/series/${enc(this.user)}/${enc(this.pass)}/${id}.${ext || 'mp4'}`; }
  catchupUrl(streamId, startMs, durationMin) {
    const d = new Date(startMs);
    const p = (n) => String(n).padStart(2, '0');
    const start = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}:${p(d.getHours())}-${p(d.getMinutes())}`;
    return `${this.server}/timeshift/${enc(this.user)}/${enc(this.pass)}/${Math.ceil(durationMin)}/${start}/${streamId}.ts`;
  }

  /** Full catalog load. onStep(label) for progress. */
  async load(sourceId, onStep = () => {}) {
    onStep('Signing in');
    const info = await this.login();
    onStep('Loading live categories');
    const [lc, ls] = await Promise.all([this.api('get_live_categories'), this.api('get_live_streams')]);
    onStep('Loading movies');
    const [vc, vs] = await Promise.all([this.api('get_vod_categories').catch(() => []), this.api('get_vod_streams').catch(() => [])]);
    onStep('Loading series');
    const [sc, ss] = await Promise.all([this.api('get_series_categories').catch(() => []), this.api('get_series').catch(() => [])]);
    const cat = (list) => new Map((Array.isArray(list) ? list : []).map((c) => [String(c.category_id), c.category_name]));
    const lcm = cat(lc), vcm = cat(vc), scm = cat(sc);
    const live = (Array.isArray(ls) ? ls : []).map((s, i) => ({
      id: `${sourceId}:l${s.stream_id}`, src: sourceId, xid: s.stream_id,
      name: s.name || 'Channel', num: Number(s.num) || i + 1, logo: s.stream_icon || '',
      group: lcm.get(String(s.category_id)) || 'Uncategorized', epgId: s.epg_channel_id || '',
      catchup: Number(s.tv_archive) ? { type: 'xtream', days: Number(s.tv_archive_duration) || 3 } : undefined,
      adult: Number(s.is_adult) === 1 || undefined,
    }));
    const movies = (Array.isArray(vs) ? vs : []).map((s) => ({
      id: `${sourceId}:m${s.stream_id}`, src: sourceId, xid: s.stream_id, name: s.name || 'Movie',
      logo: s.stream_icon || '', group: vcm.get(String(s.category_id)) || 'Uncategorized',
      ext: s.container_extension || 'mp4', rating: Number(s.rating_5based) || Number(s.rating) / 2 || 0,
      added: Number(s.added) || 0, year: s.year || '',
    }));
    const series = (Array.isArray(ss) ? ss : []).map((s) => ({
      id: `${sourceId}:s${s.series_id}`, src: sourceId, xid: s.series_id, name: s.name || 'Series',
      cover: s.cover || '', group: scm.get(String(s.category_category_id ?? s.category_id)) || 'Uncategorized',
      plot: s.plot || '', rating: Number(s.rating_5based) || Number(s.rating) / 2 || 0,
      year: (s.releaseDate || s.release_date || '').slice(0, 4), genre: s.genre || '',
      added: Number(s.last_modified) || 0, backdrop: Array.isArray(s.backdrop_path) ? s.backdrop_path[0] : '',
    }));
    return {
      live, movies, series,
      groupOrder: { live: [...lcm.values()], movies: [...vcm.values()], series: [...scm.values()] },
      account: { exp: Number(info.user_info.exp_date) * 1000 || 0, maxConn: info.user_info.max_connections, status: info.user_info.status },
    };
  }
}
const enc = encodeURIComponent;
