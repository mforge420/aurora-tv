// Remote management: pairs this TV with the owner's portal (Cloudflare Worker),
// applies playlists/commands from it and reports status back. Polls every 30 s.
import { lib } from './library.js';
import { store, Emitter } from './util.js';
import { isNative, nativeApi } from './native.js';
import { player } from './player.js';

export const DEFAULT_PORTAL = ''; // set at deploy time (portal URL); can be changed in Settings

class Remote extends Emitter {
  s = store.get('remote', null); // { url, token, claimed, name, failed: {remoteId: {updated, error}} }
  status = { state: 'off' };
  #timer = 0; #busy = false; #done = [];

  get enabled() { return !!this.s?.token; }
  get portal() { return this.s?.url || store.get('portalUrl', DEFAULT_PORTAL); }
  #save() { store.set('remote', this.s); }
  #set(st) { this.status = st; this.emit('status', st); }

  async enable(url) {
    url = String(url || this.portal || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) throw new Error('Enter your portal address (https://…)');
    store.set('portalUrl', url);
    const r = await fetch(url + '/api/device/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.#info()) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not reach the portal');
    this.s = { url, token: j.token, claimed: false, failed: {} };
    this.#save();
    this.#set({ state: 'pairing', code: j.code, expires: j.expires });
    this.start();
  }
  disable() {
    clearTimeout(this.#timer);
    this.s = null; store.del('remote');
    // playlists stay on the TV; they're simply no longer linked to the portal
    for (const src of lib.sources) { delete src.remoteId; delete src.remoteUpdated; }
    lib.saveSources();
    this.#set({ state: 'off' });
  }
  start() {
    clearTimeout(this.#timer);
    if (!this.enabled) return;
    const loop = async () => { await this.sync(); this.#timer = setTimeout(loop, document.hidden ? 120e3 : 30e3); };
    loop();
    if (!this.visHooked) { this.visHooked = true; document.addEventListener('visibilitychange', () => { if (!document.hidden && this.enabled) this.start(); }); }
  }

  #info() {
    let version = 'web', model = navigator.userAgent.includes('Android') ? 'Android' : 'Browser';
    if (isNative) {
      try { version = JSON.parse(nativeApi.appVersion()).name; } catch {}
      try { model = nativeApi.deviceModel() || model; } catch {}
    }
    return { version, model };
  }
  #auth() { return { authorization: 'Bearer ' + this.s.token }; }

  async sync() {
    if (!this.enabled || this.#busy) return;
    this.#busy = true;
    try {
      const r = await fetch(this.s.url + '/api/device/sync', { headers: this.#auth(), cache: 'no-store' });
      if (r.status === 401) { this.disable(); this.#set({ state: 'off', note: 'This TV was unpaired from the portal' }); return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Portal error ' + r.status);
      if (!j.claimed) { this.#set({ state: 'pairing', code: j.code, expires: j.expires }); return; }
      if (!this.s.claimed) { this.s.claimed = true; this.#save(); await this.#adopt(); }
      if (this.s.name !== j.name) { this.s.name = j.name; this.#save(); }
      this.#set({ state: 'paired', name: j.name, lastSync: Date.now() });
      await this.#apply(j.playlists || []);
      for (const c of j.commands || []) await this.#run(c);
      await this.#report();
    } catch (e) {
      this.#set({ ...this.status, error: e.message || 'Offline' });
    } finally { this.#busy = false; }
  }

  /** First sync after pairing: hand existing playlists to the portal so they can be managed there */
  async #adopt() {
    const mine = lib.sources.filter((s) => !s.remoteId && !s.local);
    if (!mine.length) return;
    const playlists = mine.map((s) => ({ localId: s.id, name: s.name, type: s.type, server: s.server, user: s.user, pass: s.pass, url: s.url, epgUrl: s.epgUrl }));
    const r = await fetch(this.s.url + '/api/device/adopt', { method: 'POST', headers: { ...this.#auth(), 'content-type': 'application/json' }, body: JSON.stringify({ playlists }) });
    const j = await r.json().catch(() => ({}));
    for (const l of j.linked || []) {
      const src = lib.source(l.localId);
      if (src) { src.remoteId = l.id; src.remoteUpdated = Date.now(); }
    }
    lib.saveSources();
  }

  /** Make this TV's playlists match the portal */
  async #apply(list) {
    const ids = new Set(list.map((p) => p.id));
    let changed = false;
    for (const src of [...lib.sources]) {
      if (src.remoteId && !ids.has(src.remoteId)) { await lib.removeSource(src.id); changed = true; }
    }
    for (const p of list) {
      const def = p.type === 'xtream'
        ? { type: 'xtream', name: p.name || hostOf(p.server), server: p.server, user: p.user, pass: p.pass || '', epgUrl: p.epgUrl || '' }
        : { type: 'm3u', name: p.name || hostOf(p.url), url: p.url, epgUrl: p.epgUrl || '' };
      const src = lib.sources.find((s) => s.remoteId === p.id);
      const failed = this.s.failed?.[p.id];
      if (!src) {
        if (failed && failed.updated === p.updated) continue; // same details failed before; wait for an edit
        try {
          await lib.addSource({ ...def, remoteId: p.id, remoteUpdated: p.updated });
          delete this.s.failed?.[p.id]; changed = true;
        } catch (e) { (this.s.failed ||= {})[p.id] = { updated: p.updated, error: e.message }; }
        this.#save();
      } else if (p.updated > (src.remoteUpdated || 0)) {
        const credsChanged = ['type', 'server', 'user', 'pass', 'url'].some((k) => (src[k] || '') !== (def[k] || ''));
        const epgChanged = (src.epgUrl || '') !== (def.epgUrl || '') && (def.epgUrl || !credsChanged);
        Object.assign(src, def, { remoteUpdated: p.updated });
        if (credsChanged) {
          if (!p.epgUrl) src.epgUrl = '';
          try { await lib.refreshSource(src); delete this.s.failed?.[p.id]; } catch (e) { (this.s.failed ||= {})[p.id] = { updated: p.updated, error: e.message }; }
          src.epgUpdated = 0;
        } else if (epgChanged) src.epgUpdated = 0;
        lib.saveSources(); this.#save(); changed = true;
      }
    }
    if (changed) { lib.rebuild(); lib.refreshEpg().catch(() => {}); }
  }

  async #run(c) {
    const { toast } = await import('./ui.js');
    try {
      if (c.type === 'refresh') { toast('Refreshing playlists…', { icon: 'refresh' }); await lib.refreshAll(); }
      else if (c.type === 'refreshEpg') { toast('Updating the TV guide…', { icon: 'guide' }); await lib.refreshEpg(true); }
      else if (c.type === 'checkUpdate') { const { manualCheck } = await import('./updater.js'); if (isNative) manualCheck(); }
      else if (c.type === 'message') toast(c.payload || '', { icon: 'info', ms: 15000 });
      else if (c.type === 'reload') { this.#done.push(c.id); await this.#report(); location.reload(); return; }
    } catch {}
    this.#done.push(c.id);
  }

  async #report() {
    const playlists = lib.sources.filter((s) => s.remoteId).map((s) => ({
      remoteId: s.remoteId, name: s.name, counts: s.counts, updated: s.updated, epgUpdated: s.epgUpdated,
      epgError: s.epgError || undefined, expires: s.account?.exp || undefined,
    }));
    for (const [id, f] of Object.entries(this.s.failed || {})) if (!playlists.some((p) => p.remoteId === id)) playlists.push({ remoteId: id, error: f.error });
    const local = lib.sources.filter((s) => !s.remoteId).map((s) => ({ name: s.name, type: s.local ? 'file' : s.type }));
    const nowPlaying = player.mode !== 'hidden' && player.item ? player.item.name : '';
    const done = this.#done.splice(0);
    await fetch(this.s.url + '/api/device/report', {
      method: 'POST', headers: { ...this.#auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ ...this.#info(), nowPlaying, report: { playlists, local }, done }),
    }).catch(() => { this.#done.unshift(...done); });
  }
}
const hostOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'http://' + u).hostname; } catch { return 'Playlist'; } };

export const remote = new Remote();
