// Playback engine: picks hls.js / mpegts.js / native, with automatic fallback,
// proxy retry (CORS / mixed content) and live auto-reconnect.
import { Emitter } from './util.js';
import { settings } from './settings.js';
import { hasProxy } from './net.js';

let mpegtsP;
const hostRoute = new Map(); // remembers hosts that need the proxy (CORS) for faster zapping
const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
function loadMpegts() {
  if (window.mpegts) return Promise.resolve(window.mpegts);
  return (mpegtsP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/vendor/mpegts.js'; s.onload = () => res(window.mpegts); s.onerror = () => rej(new Error('mpegts.js failed to load'));
    document.head.append(s);
  }));
}

function guessType(url) {
  const p = url.split('?')[0].toLowerCase();
  if (/\.m3u8?$/.test(p) || /mpegurl|\/hls\//.test(url)) return 'hls';
  if (/\.(ts|mpegts)$/.test(p)) return 'ts';
  if (/\.(mp4|m4v|webm|mov|mkv|ogv|mp3|aac|m4a)$/.test(p)) return 'native';
  if (/\.flv$/.test(p)) return 'flv';
  return 'unknown';
}

function proxyUrl(url, { ua, ref } = {}) {
  const q = new URLSearchParams({ url });
  const gua = ua || settings.get('userAgent');
  if (gua) q.set('ua', gua);
  if (ref) q.set('ref', ref);
  return '/api/stream?' + q;
}

export class Engine extends Emitter {
  constructor(video) {
    super();
    this.video = video;
    this.hls = null; this.mts = null;
    this.token = 0;
    this.retries = 0;
    this.lastProgress = 0;
    this.#watch();
  }

  /** opts: { live, ua, ref, startAt } */
  async load(url, opts = {}) {
    const tok = ++this.token;
    this.url = url; this.opts = opts; this.retries = 0; this.started = false;
    const type = guessType(url);
    const mode = settings.get('proxyMode');
    const needProxy = (opts.ua || opts.ref || mode === 'always' || (location.protocol === 'https:' && url.startsWith('http:'))) && hasProxy() && mode !== 'never';
    let routes = needProxy ? ['proxy'] : (hasProxy() && mode !== 'never' ? ['direct', 'proxy'] : ['direct']);
    if (routes.length === 2 && hostRoute.get(hostOf(url)) === 'proxy') routes = ['proxy', 'direct'];
    let engines;
    if (type === 'hls') engines = ['hls'];
    else if (type === 'ts') engines = opts.live === false ? ['ts', 'native'] : ['ts', 'hls'];
    else if (type === 'flv') engines = ['flv'];
    else if (type === 'native') engines = ['native'];
    else engines = opts.live === false ? ['native', 'ts'] : ['ts', 'hls', 'native'];
    // Native HLS (Safari/iOS/Tizen) when MSE is unavailable
    if (!window.Hls?.isSupported() && engines.includes('hls')) engines = engines.map((e) => (e === 'hls' ? 'native' : e));
    this.attempts = [];
    for (const r of routes) for (const e of engines) this.attempts.push({ engine: e, route: r });
    this.attemptIdx = -1;
    this.emit('state', 'loading');
    return this.#next(tok);
  }

  async #next(tok, err) {
    if (tok !== this.token) return;
    this.attemptIdx++;
    const a = this.attempts[this.attemptIdx];
    if (!a) { this.emit('state', 'error'); this.emit('fatal', err || new Error('This stream could not be played')); return; }
    this.#teardown();
    const src = a.route === 'proxy' ? proxyUrl(this.url, this.opts) : this.url;
    this.current = a;
    try { await this.#start(a.engine, src, tok); }
    catch (e) { this.#fail(tok, e); }
  }

  #fail(tok, e) {
    if (tok !== this.token) return;
    console.warn('[engine] attempt failed', this.current, e?.message || e);
    if (!this.started) return this.#next(tok, e);
    // already playing: reconnect same attempt (live) with backoff
    if (this.retries < 6) {
      this.retries++;
      this.emit('state', 'reconnecting');
      const t = tok;
      setTimeout(() => { if (t === this.token) { this.attemptIdx--; this.started = false; this.#next(t, e); } }, Math.min(8000, 800 * this.retries));
    } else { this.emit('state', 'error'); this.emit('fatal', e); }
  }

  async #start(engine, src, tok) {
    const v = this.video;
    const onStarted = () => {
      if (tok !== this.token) return;
      if (!this.started) { this.started = true; this.retries = 0; hostRoute.set(hostOf(this.url), this.current.route); this.emit('started', this.current); }
    };
    v.addEventListener('playing', onStarted, { once: true });
    if (engine === 'hls') {
      const Hls = window.Hls;
      const live = this.opts.live !== false;
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: settings.get('lowLatency'),
        maxBufferLength: settings.get('bufferSeconds'),
        backBufferLength: live ? 30 : 90,
        liveSyncDurationCount: 3,
        manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 4,
        startPosition: this.opts.startAt || -1,
        capLevelToPlayerSize: !!this.opts.preview,
      });
      this.hls = hls;
      let mediaRecover = 0;
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecover++ < 2) return hls.recoverMediaError();
        this.#fail(tok, new Error(d.details || 'HLS error'));
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { this.emit('tracks'); this.#play(); });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.emit('tracks'));
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.emit('tracks'));
      hls.on(Hls.Events.LEVEL_SWITCHED, () => this.emit('level'));
      hls.loadSource(src);
      hls.attachMedia(v);
    } else if (engine === 'ts' || engine === 'flv') {
      const mpegts = await loadMpegts();
      if (tok !== this.token) return;
      if (!mpegts.isSupported()) throw new Error('MSE unsupported');
      const p = mpegts.createPlayer(
        { type: engine === 'flv' ? 'flv' : 'mpegts', isLive: this.opts.live !== false, url: new URL(src, location.href).href },
        { enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: this.opts.live !== false, liveBufferLatencyMaxLatency: 6, liveBufferLatencyMinRemain: 1.5, autoCleanupSourceBuffer: true },
      );
      this.mts = p;
      p.on(mpegts.Events.ERROR, (type, detail) => this.#fail(tok, new Error(`${type}: ${detail}`)));
      p.on(mpegts.Events.MEDIA_INFO, () => this.emit('tracks'));
      p.attachMediaElement(v);
      p.load();
      this.#play();
      // mpegts can stall silently on non-TS data: give up if nothing arrives
      setTimeout(() => { if (tok === this.token && !this.started && this.current?.engine === engine && v.readyState < 2) this.#fail(tok, new Error('No data')); }, 9000);
    } else {
      v.src = src;
      v.onerror = () => this.#fail(tok, new Error(v.error?.message || 'Media error ' + v.error?.code));
      if (this.opts.startAt) v.addEventListener('loadedmetadata', () => { v.currentTime = this.opts.startAt; }, { once: true });
      this.#play();
    }
  }

  async #play() {
    try { await this.video.play(); }
    catch (e) {
      if (e.name === 'NotAllowedError') { // autoplay policy: retry muted
        this.video.muted = true; this.emit('muted-autoplay');
        try { await this.video.play(); } catch {}
      }
    }
  }

  #watch() {
    const v = this.video;
    v.addEventListener('timeupdate', () => { this.lastProgress = performance.now(); });
    v.addEventListener('waiting', () => this.emit('state', 'buffering'));
    v.addEventListener('playing', () => this.emit('state', 'playing'));
    v.addEventListener('pause', () => this.emit('state', 'paused'));
    // live stall watchdog
    this.watchdog = setInterval(() => {
      if (!this.started || v.paused || this.opts?.live === false) return;
      if (performance.now() - this.lastProgress > 15000) { this.lastProgress = performance.now(); this.#fail(this.token, new Error('Stalled')); }
    }, 3000);
  }

  #teardown() {
    const v = this.video;
    v.onerror = null;
    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
    if (this.mts) { try { this.mts.pause(); this.mts.unload(); this.mts.detachMediaElement(); this.mts.destroy(); } catch {} this.mts = null; }
    if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
  }
  stop() { this.token++; this.started = false; this.#teardown(); this.emit('state', 'idle'); }
  destroy() { this.stop(); clearInterval(this.watchdog); }

  // ---- tracks / info ----
  audioTracks() {
    if (this.hls) return this.hls.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Track ${i + 1}`, active: i === this.hls.audioTrack }));
    const at = this.video.audioTracks;
    if (at?.length) return [...at].map((t, i) => ({ id: i, label: t.label || t.language || `Track ${i + 1}`, active: t.enabled }));
    return [];
  }
  setAudio(id) {
    if (this.hls) this.hls.audioTrack = id;
    else if (this.video.audioTracks) [...this.video.audioTracks].forEach((t, i) => { t.enabled = i === id; });
  }
  subtitleTracks() {
    if (this.hls) return [{ id: -1, label: 'Off', active: this.hls.subtitleTrack === -1 }, ...this.hls.subtitleTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Sub ${i + 1}`, active: i === this.hls.subtitleTrack }))];
    const tt = [...this.video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
    if (!tt.length) return [];
    return [{ id: -1, label: 'Off', active: tt.every((t) => t.mode !== 'showing') }, ...tt.map((t, i) => ({ id: i, label: t.label || t.language || `Sub ${i + 1}`, active: t.mode === 'showing' }))];
  }
  setSubtitle(id) {
    if (this.hls) { this.hls.subtitleTrack = id; this.hls.subtitleDisplay = id >= 0; return; }
    [...this.video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions').forEach((t, i) => { t.mode = i === id ? 'showing' : 'disabled'; });
  }
  qualities() {
    if (!this.hls || this.hls.levels.length < 2) return [];
    return [{ id: -1, label: 'Auto', active: this.hls.autoLevelEnabled }, ...this.hls.levels.map((l, i) => ({ id: i, label: (l.height ? l.height + 'p' : 'Level ' + (i + 1)) + (l.bitrate ? ` · ${(l.bitrate / 1e6).toFixed(1)} Mbps` : ''), active: !this.hls.autoLevelEnabled && this.hls.currentLevel === i })).reverse()];
  }
  setQuality(id) { if (this.hls) this.hls.currentLevel = id; }
  stats() {
    const v = this.video;
    const s = { engine: this.current ? `${this.current.engine}${this.current.route === 'proxy' ? ' · proxy' : ''}` : '', res: v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '' };
    if (this.hls && this.hls.currentLevel >= 0) { const l = this.hls.levels[this.hls.currentLevel]; if (l?.bitrate) s.bitrate = (l.bitrate / 1e6).toFixed(1) + ' Mbps'; }
    if (this.hls?.bandwidthEstimate) s.bw = (this.hls.bandwidthEstimate / 1e6).toFixed(1) + ' Mbps';
    if (this.mts?.statisticsInfo?.speed) s.bw = (this.mts.statisticsInfo.speed * 8 / 1000).toFixed(1) + ' Mbps';
    const b = v.buffered;
    if (b.length) s.buffer = Math.max(0, b.end(b.length - 1) - v.currentTime).toFixed(1) + 's';
    const q = v.getVideoPlaybackQuality?.();
    if (q) s.dropped = q.droppedVideoFrames;
    return s;
  }
}
