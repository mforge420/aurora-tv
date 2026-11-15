// Remote management: pairs this TV with the owner's portal (Cloudflare Worker),
// applies playlists/commands from it and reports status back. Polls every 30 s.
import { lib } from './library.js';
import { store, Emitter } from './util.js';
import { isNative, nativeApi } from './native.js';
import { player } from './player.js';

export const DEFAULT_PORTAL = 'https://lumora-tv.dforge.workers.dev'; // can be changed in Settings

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
      await this.#sendCategories();
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
    // playlists merged on the website keep their old id as an alias: relink instead of reloading
    for (const src of lib.sources) {
      if (!src.remoteId || ids.has(src.remoteId)) continue;
      const to = list.find((p) => (p.aliases || []).includes(src.remoteId));
      if (to && !lib.sources.some((s) => s.remoteId === to.id)) { src.remoteId = to.id; src.remoteUpdated = 0; changed = true; }
    }
    for (const src of [...lib.sources]) {
      if (src.remoteId && !ids.has(src.remoteId)) { await lib.removeSource(src.id); changed = true; }
    }
    for (const p of list) {
      const hidden = { live: p.hidden?.live || [], movies: p.hidden?.movies || [], series: p.hidden?.series || [] };
      const order = { live: p.order?.live || [], movies: p.order?.movies || [], series: p.order?.series || [] };
      const def = p.type === 'xtream'
        ? { type: 'xtream', name: p.name || hostOf(p.server), server: p.server, user: p.user, pass: p.pass || '', epgUrl: p.epgUrl || '', hidden, order }
        : { type: 'm3u', name: p.name || hostOf(p.url), url: p.url, epgUrl: p.epgUrl || '', hidden, order };
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
        // compare logins loosely: "http://host:8080/" and "host:8080" are the same server
        const norm = (k, v) => (k === 'server' ? String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '') : String(v || '').trim());
        const credsChanged = ['type', 'server', 'user', 'pass', 'url'].some((k) => norm(k, src[k]) !== norm(k, def[k]));
        // Only a guide URL typed on the website counts. An empty one means "detect it", so the URL the
        // TV detected itself is kept (wiping it used to throw the guide away on every website edit).
        const prevRemoteEpg = 'remoteEpg' in src ? src.remoteEpg : (def.epgUrl ? '' : src.epgUrl || '');
        const epgChanged = (def.epgUrl || '') !== (prevRemoteEpg || '') && !(!def.epgUrl && !credsChanged);
        const keepEpg = src.epgUrl;
        Object.assign(src, def, { remoteUpdated: p.updated, remoteEpg: def.epgUrl || '' });
        if (!def.epgUrl && !credsChanged) src.epgUrl = keepEpg;
        if (credsChanged) {
          if (!p.epgUrl) src.epgUrl = '';
          try { await lib.refreshSource(src); delete this.s.failed?.[p.id]; } catch (e) { (this.s.failed ||= {})[p.id] = { updated: p.updated, error: e.message }; }
          src.epgUpdated = 0;
        } else if (epgChanged) src.epgUpdated = 0;
        lib.saveSources(); this.#save(); changed = true;
      }
      // repair guides lost to the old bug: Xtream playlists can always re-detect their guide URL
      const s2 = lib.sources.find((s) => s.remoteId === p.id);
      if (s2 && !s2.epgUrl && s2.type === 'xtream') { try { s2.epgUrl = lib.xtream(s2).epgUrl(); s2.epgUpdated = 0; lib.saveSources(); changed = true; } catch {} }
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
      else if (c.type === 'activate') {
        const id = c.payload === 'all' ? 'all' : lib.sources.find((s) => s.remoteId === c.payload)?.id;
        if (id) { lib.setActive(id); toast(`Now watching: ${lib.activeName()}`, { icon: 'check' }); }
      }
      else if (c.type === 'reload') { this.#done.push(c.id); await this.#report(); location.reload(); return; }
    } catch {}
    this.#done.push(c.id);
  }

  /** Send the category names of each website playlist once per load (the website can't always reach providers) */
  async #sendCategories() {
    for (const src of lib.sources) {
      const c = src._cat;
      if (!src.remoteId || !c || !src.updated || src.catsSent === src.updated) continue;
      const names = (list) => [...new Set(list.map((x) => x.group).filter(Boolean))];
      const order = c.groupOrder || {};
      const pick = (k, list) => { const seen = names(list); const ord = (order[k] || []).filter((g) => seen.includes(g)); return [...ord, ...seen.filter((g) => !ord.includes(g))]; };
      const categories = { live: pick('live', c.live || []), movies: pick('movies', c.movies || []), series: pick('series', c.series || []) };
      try {
        const r = await fetch(this.s.url + '/api/device/categories', { method: 'POST', headers: { ...this.#auth(), 'content-type': 'application/json' }, body: JSON.stringify({ id: src.remoteId, categories }) });
        if (r.ok || r.status === 404) { src.catsSent = src.updated; lib.saveSources(); }
      } catch {}
    }
  }

  async #report() {
    const playlists = lib.sources.filter((s) => s.remoteId).map((s) => ({
      remoteId: s.remoteId, name: s.name, counts: s.counts, updated: s.updated, epgUpdated: s.epgUpdated,
      epgError: s.epgError || undefined, expires: s.account?.exp || undefined,
    }));
    for (const [id, f] of Object.entries(this.s.failed || {})) if (!playlists.some((p) => p.remoteId === id)) playlists.push({ remoteId: id, error: f.error });
    const local = lib.sources.filter((s) => !s.remoteId).map((s) => ({ name: s.name, type: s.local ? 'file' : s.type }));
    const a = lib.activeId();
    const active = a === 'all' ? 'all' : (lib.source(a)?.remoteId || 'local');
    const nowPlaying = player.mode !== 'hidden' && player.item ? player.item.name : '';
    const done = this.#done.splice(0);
    await fetch(this.s.url + '/api/device/report', {
      method: 'POST', headers: { ...this.#auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ ...this.#info(), nowPlaying, report: { playlists, local, active, activeName: lib.activeName(), diag: lib.diag }, done }),
    }).catch(() => { this.#done.unshift(...done); });
  }
}
const hostOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'http://' + u).hostname; } catch { return 'Playlist'; } };

export const remote = new Remote();
lib.on('active', () => { if (remote.enabled && remote.s?.claimed) setTimeout(() => remote.sync(), 500); });
