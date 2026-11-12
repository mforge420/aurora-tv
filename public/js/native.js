// Bridge to the Android app (ExoPlayer + native proxy). Only active inside the APK.
import { Emitter } from './util.js';
import { settings } from './settings.js';

const N = window.AuroraNative;
export const isNative = !!N;

const listeners = new Set();
if (isNative) {
  document.documentElement.classList.add('native');
  window.__auroraNative = (type, data) => listeners.forEach((fn) => fn(type, data));
  // Tell the app when a text field has focus, so OK opens the on-screen keyboard there
  const isText = (el) => el && ((el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|file)$/i.test(el.type)) || el.tagName === 'TEXTAREA' || el.isContentEditable);
  document.addEventListener('focusin', (e) => { try { N.setTextFocus(!!isText(e.target)); } catch {} });
  document.addEventListener('focusout', () => { try { N.setTextFocus(false); } catch {} });
  // Remote buttons forwarded by the activity as DOM key events
  window.__auroraKey = (key) => {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    const map = { Escape: 27, PageUp: 33, PageDown: 34 };
    for (const t of ['keydown', 'keyup']) {
      const ev = new KeyboardEvent(t, { key, bubbles: true, cancelable: true });
      if (map[key]) Object.defineProperty(ev, 'keyCode', { get: () => map[key] });
      target.dispatchEvent(ev);
    }
  };
}

/** Looks enough like an HTMLVideoElement for player.js */
export class NativeVideo extends EventTarget {
  paused = true; _t = 0; _at = 0; duration = NaN; _muted = false; _vol = 1; readyState = 0;
  videoWidth = 0; videoHeight = 0; buffered = { length: 0 }; textTracks = [];
  constructor() {
    super();
    const self = this;
    this.style = { _fit: 'contain', get objectFit() { return this._fit; }, set objectFit(v) { this._fit = v || 'contain'; N.setResize(this._fit); } };
    listeners.add((type, data) => self._on(type, data));
  }
  _on(type, data) {
    if (type === 'time') {
      const d = JSON.parse(data);
      this._t = d.pos; this._at = performance.now();
      this.duration = d.dur >= 0 ? d.dur : Infinity;
      this.paused = !d.playing;
      this._buf = d.buf;
      this.dispatchEvent(new Event('timeupdate'));
    } else if (type === 'state') {
      if (data === 'playing') { this.paused = false; this.readyState = 4; this.dispatchEvent(new Event('playing')); }
      if (data === 'paused') { this.paused = true; this.dispatchEvent(new Event('pause')); }
      if (data === 'buffering') this.dispatchEvent(new Event('waiting'));
      if (data === 'ended') { this.paused = true; this.dispatchEvent(new Event('ended')); }
      if (data === 'idle') { this.paused = true; this.readyState = 0; this._t = 0; this.duration = NaN; }
    }
  }
  get currentTime() { return this.paused ? this._t : this._t + (performance.now() - this._at) / 1000; }
  set currentTime(v) { this._t = v; this._at = performance.now(); N.seek(v); }
  get muted() { return this._muted; }
  set muted(v) { this._muted = !!v; N.setVolume(this._muted ? 0 : this._vol); this.dispatchEvent(new Event('volumechange')); }
  get volume() { return this._vol; }
  set volume(v) { this._vol = v; if (!this._muted) N.setVolume(v); }
  play() { N.resume(); this.paused = false; return Promise.resolve(); }
  pause() { N.pause(); this.paused = true; this.dispatchEvent(new Event('pause')); }
  requestPictureInPicture() { return Promise.reject(new Error('unsupported')); }
  getAttribute() { return null; } removeAttribute() {} setAttribute() {} load() {}
}

/** Same surface as engine.js Engine, backed by ExoPlayer */
export class NativeEngine extends Emitter {
  constructor(video) {
    super();
    this.video = video; this.token = 0; this.started = false;
    listeners.add((type, data) => {
      if (!this.token) return;
      if (type === 'state') {
        if (data === 'idle' || data === 'ended') return;
        this.emit('state', data === 'playing' || data === 'paused' ? data : data);
      } else if (type === 'started') {
        this.started = true; this.current = { engine: 'exo-' + data, route: 'native' };
        this.emit('started', this.current);
      } else if (type === 'error') {
        this.emit('state', 'error'); this.emit('fatal', new Error(data || 'This stream could not be played'));
      } else if (type === 'tracks') this.emit('tracks');
      else if (type === 'warning') import('./ui.js').then(({ toast }) => toast(data, { type: 'error', icon: 'tv', ms: 7000 }));
    });
  }
  load(url, opts = {}) {
    this.token++;
    this.url = url; this.opts = opts; this.started = false;
    this.emit('state', 'loading');
    N.play(JSON.stringify({ url, live: opts.live !== false, ua: opts.ua || settings.get('userAgent') || '', ref: opts.ref || '', startAt: opts.startAt || 0 }));
  }
  stop() { this.token++; this.started = false; N.stop(); this.emit('state', 'idle'); this.token = 0; }
  destroy() { this.stop(); }
  setRect(mode, r) { N.setRect(mode, r?.left || 0, r?.top || 0, r?.width || 0, r?.height || 0, window.innerWidth); }
  #tracks() { try { return JSON.parse(N.getTracks()); } catch { return { audio: [], text: [], video: [] }; } }
  audioTracks() { return this.#tracks().audio; }
  setAudio(id) { N.selectTrack('audio', String(id)); }
  subtitleTracks() {
    const t = this.#tracks();
    return t.text.length ? [{ id: 'off', label: 'Off', active: !t.textOn }, ...t.text] : [];
  }
  setSubtitle(id) { N.selectTrack('text', String(id)); }
  qualities() {
    const t = this.#tracks();
    if (t.video.length < 2) return [];
    return [{ id: 'auto', label: 'Auto', active: t.videoAuto }, ...t.video.sort((a, b) => b.h - a.h).map((v) => ({ ...v, active: !t.videoAuto && v.active }))];
  }
  setQuality(id) { N.selectTrack('video', String(id)); }
  stats() { try { return JSON.parse(N.getStats()); } catch { return {}; } }
}

export const nativeApi = N;
/** Subscribe to raw events from the Android app; returns an unsubscribe function. */
export function onNative(fn) { listeners.add(fn); return () => listeners.delete(fn); }
