import { store, Emitter } from './util.js';

const DEFAULTS = {
  accent: 'aurora',          // aurora | ocean | sunset | emerald | rose | mono
  clock24: true,
  proxyMode: 'auto',         // auto | always | never
  xtreamFormat: 'm3u8',      // m3u8 | ts
  previewAutoplay: true,
  previewMuted: false,
  showChannelNumbers: true,
  epgTimeShift: 0,           // hours
  guideHours: 2.5,           // visible hours in guide
  epgAutoRefreshHours: 12,
  playlistAutoRefreshHours: 24,
  lowLatency: false,
  bufferSeconds: 30,
  userAgent: '',
  lastView: 'live',
  parentalPin: '',
  lockedGroups: [],
  hiddenGroups: [],
  startOnLastChannel: false,
  autoplayNextEpisode: true,
};

class Settings extends Emitter {
  constructor() {
    super();
    this.v = { ...DEFAULTS, ...store.get('settings', {}) };
  }
  get(k) { return this.v[k]; }
  set(k, val) {
    this.v[k] = val;
    store.set('settings', this.v);
    this.emit('change', k, val);
    this.emit('change:' + k, val);
  }
  all() { return { ...this.v }; }
  replace(obj) { this.v = { ...DEFAULTS, ...obj }; store.set('settings', this.v); this.emit('change', '*'); }
}
export const settings = new Settings();
