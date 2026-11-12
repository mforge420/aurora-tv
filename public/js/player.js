// The persistent player layer: morphs between an inline preview slot and fullscreen.
import { h, fmtClock, fmtDuration, logoEl, clamp, esc, store, rem } from './util.js';
import { Engine } from './engine.js';
import { isNative, NativeVideo, NativeEngine } from './native.js';
import { nav } from './nav.js';
import { lib } from './library.js';
import { settings } from './settings.js';
import { icon, iconEl, toast, choose, modal } from './ui.js';
import { VList } from './vlist.js';

const ASPECTS = [['contain', 'Fit'], ['cover', 'Fill / Zoom'], ['fill', 'Stretch']];

class Player {
  mode = 'hidden';
  item = null; kind = null; list = [];
  history = [];
  init() {
    this.layer = document.getElementById('player');
    if (isNative) {
      this.video = new NativeVideo();
      this.engine = new NativeEngine(this.video);
    } else {
      this.video = h('video', { playsinline: true, preload: 'auto' });
      this.video.setAttribute('playsinline', '');
      this.engine = new Engine(this.video);
    }
    this.status = h('div.p-status');
    this.osd = h('div.p-osd');
    this.side = h('div.p-side');
    this.numEl = h('div.p-num');
    this.statsEl = h('div.p-stats');
    this.layer.append(...(isNative ? [] : [this.video]), this.status, this.osd, this.side, this.numEl, this.statsEl);
    this.video.style.objectFit = store.get('aspect', 'contain');

    this.engine.on('state', (s) => this.#state(s));
    this.engine.on('fatal', (e) => this.#state('error', e));
    this.engine.on('muted-autoplay', () => { if (this.mode === 'full') toast('Autoplay blocked — playing muted. Press M to unmute.', { icon: 'mute' }); });
    this.engine.on('started', () => { if (this.kind === 'movie' || this.kind === 'episode') this.#vodTick(); });
    this.video.addEventListener('timeupdate', () => this.#onTime());
    this.video.addEventListener('ended', () => this.#onEnded());
    this.video.addEventListener('volumechange', () => store.set('volume', { v: this.video.volume, m: this.video.muted }));
    const vol = store.get('volume'); if (vol && !isNative) { this.video.volume = vol.v; }

    this.layer.addEventListener('click', (e) => {
      if (this.mode === 'preview') { this.fullscreen(); return; }
      if (e.target === this.video || e.target === this.osd) this.#toggleOsd();
    });
    this.layer.addEventListener('dblclick', () => { if (this.mode === 'full') this.#toggleNativeFs(); });
    this.layer.addEventListener('mousemove', () => { if (this.mode === 'full') this.#showOsd(); });
    window.addEventListener('resize', () => this.#reposition());
    setInterval(() => { if (this.mode === 'full' && this.osdVisible) this.#renderOsd(); if (this.showStats) this.#renderStats(); }, 1000);
  }

  // ---------------- public API ----------------
  /** Play a live channel. opts: { list, preview } */
  playChannel(ch, { list, preview = false } = {}) {
    if (!ch) return;
    if (lib.isLocked(ch.group) && !this.unlocked?.has(ch.group)) {
      import('./ui.js').then(async ({ pinDialog }) => {
        const pin = await pinDialog('Locked group · Enter PIN');
        if (pin === settings.get('parentalPin')) { (this.unlocked ||= new Set()).add(ch.group); this.playChannel(ch, { list, preview }); }
        else if (pin) toast('Wrong PIN', { type: 'error' });
      });
      return;
    }
    if (list) this.list = list;
    const same = this.item?.id === ch.id && this.kind === 'live' && this.engine.token && this.state !== 'error';
    if (this.item && this.kind === 'live' && this.item.id !== ch.id) this.prevChannel = this.item;
    this.item = ch; this.kind = 'live'; this.prog = null;
    if (!same) {
      this.video.muted = preview && settings.get('previewMuted') ? true : !!store.get('volume')?.m;
      this.engine.load(lib.liveUrl(ch), { live: true, ua: ch.ua, ref: ch.ref, preview });
      lib.addRecent(ch.id);
    }
    this.emitChange();
    if (!preview) this.fullscreen(); else if (this.mode !== 'full') this.#setMode('preview');
    this.#renderOsd();
    if (this.mode === 'full') this.#showOsd();
  }

  /** Play catch-up programme */
  playCatchup(ch, prog) {
    const url = lib.catchupUrl(ch, prog);
    if (!url) return toast('Catch-up not available', { type: 'error' });
    this.item = ch; this.kind = 'catchup'; this.prog = prog;
    this.engine.load(url, { live: false, ua: ch.ua, ref: ch.ref });
    this.fullscreen(); this.#renderOsd(); this.#showOsd();
  }

  /** VOD: item {id,name,url,logo,...}, opts: {kind:'movie'|'episode', startAt, next: fn->item|null, subtitle} */
  playVod(item, url, { kind = 'movie', startAt = 0, next = null, subtitle = '' } = {}) {
    this.item = item; this.kind = kind; this.prog = null; this.vodNext = next; this.vodSub = subtitle;
    this.video.muted = !!store.get('volume')?.m;
    this.engine.load(url, { live: false, startAt });
    this.fullscreen(); this.#renderOsd(); this.#showOsd();
    this.emitChange();
  }

  /** Attach the preview to a slot element (or null to detach) */
  attachPreview(slot) {
    this.slot = slot;
    if (this.mode === 'full') return;
    if (slot && this.item && this.kind === 'live') this.#setMode('preview');
    else if (!slot && this.mode === 'preview') this.stop();
  }
  fullscreen() {
    if (!this.item) return;
    this.#setMode('full');
    if (!this.unbindKeys) this.unbindKeys = nav.push((k, e) => this.#keys(k, e));
    this.#renderOsd(); this.#showOsd();
  }
  exitFullscreen() {
    this.unbindKeys?.(); this.unbindKeys = null;
    this.#closeSide();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (this.kind !== 'live' || !this.slot?.isConnected) { this.stop(); }
    else this.#setMode('preview');
    this.onExit?.();
  }
  stop() {
    if ((this.kind === 'movie' || this.kind === 'episode') && this.item) lib.setResume(this.item.id, this.video.currentTime, this.video.duration);
    this.engine.stop();
    this.#setMode('hidden');
    this.unbindKeys?.(); this.unbindKeys = null;
    this.item = null; this.kind = null;
    this.emitChange();
  }
  emitChange() { window.dispatchEvent(new CustomEvent('player-change', { detail: { item: this.item, kind: this.kind } })); }
  isPlaying(id) { return this.item?.id === id && this.mode !== 'hidden'; }

  // ---------------- layout ----------------
  #setMode(m) {
    this.mode = m;
    this.layer.dataset.mode = m;
    document.body.classList.toggle('player-full', m === 'full');
    document.body.classList.toggle('has-video', m !== 'hidden');
    this.layer.inert = m === 'hidden';
    document.getElementById('app').inert = m === 'full';
    if (m === 'hidden') { this.osd.innerHTML = ''; this.status.innerHTML = ''; this.osdKey = null; }
    this.#reposition();
  }
  #reposition() {
    const L = this.layer.style;
    if (this.mode === 'preview' && this.slot?.isConnected) {
      const r = this.slot.getBoundingClientRect();
      Object.assign(L, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
      this.engine.setRect?.('preview', r);
    } else if (this.mode === 'full') {
      Object.assign(L, { top: '0px', left: '0px', width: '100vw', height: '100vh' });
      this.engine.setRect?.('full');
    } else this.engine.setRect?.('hidden');
  }
  reposition() { this.#reposition(); }

  #state(s, err) {
    if (s === this.state && s !== 'error') return;
    this.state = s;
    this.layer.dataset.state = s;
    if (s === 'loading' || s === 'buffering' || s === 'reconnecting') {
      this.status.innerHTML = `<div class="spinner"></div>${s === 'reconnecting' ? '<span>Reconnecting…</span>' : ''}`;
    } else if (s === 'error') {
      this.status.innerHTML = `<div class="p-error">${icon('tv')}<b>Stream unavailable</b><span>${esc(err?.message || 'The channel could not be played')}</span></div>`;
    } else this.status.innerHTML = '';
    if (this.mode === 'full') this.#renderOsd();
  }

  // ---------------- OSD ----------------
  #showOsd(ms = 4500) {
    this.osdVisible = true;
    this.layer.classList.add('osd-on');
    this.#renderOsd();
    clearTimeout(this.osdT);
    if (ms) this.osdT = setTimeout(() => { if (!this.video.paused || this.kind === 'live') this.#hideOsd(); }, ms);
  }
  #hideOsd() { this.osdVisible = false; this.layer.classList.remove('osd-on'); }
  #toggleOsd() { this.osdVisible ? this.#hideOsd() : this.#showOsd(); }

  /**
   * The OSD is built once per channel/programme and afterwards only its changing
   * bits (clock, progress, times) are patched — rebuilding it on every player
   * event restarted animations and reloaded the logo, which made it flicker.
   */
  #renderOsd() {
    if (this.mode !== 'full' || !this.item) return;
    const it = this.item;
    const clock = fmtClock(Date.now(), { h12: !settings.get('clock24') });
    if (this.kind === 'live') {
      const [now, next] = lib.nowNext(it);
      const fav = lib.isFav(it.id);
      const key = `L|${it.id}|${now?.start}|${next?.start}|${fav}`;
      if (key !== this.osdKey) {
        this.osdKey = key;
        this.osd.innerHTML = `
        <div class="osd-top"><div class="osd-clock"></div></div>
        <div class="osd-bottom glass">
          <div class="osd-ch">
            <div class="osd-logo"></div>
            <div class="osd-chmeta">
              <div class="osd-num">${settings.get('showChannelNumbers') ? it.num : ''} ${fav ? `<span class="fav-dot">${icon('star')}</span>` : ''}</div>
              <div class="osd-name">${esc(it.name)}</div>
              <div class="osd-group">${esc(it.group)}</div>
            </div>
          </div>
          <div class="osd-prog">
            ${now ? `<div class="osd-now"><span class="live-pill">LIVE</span><b>${esc(now.title)}</b>${now.ep ? `<span class="ep">${esc(now.ep)}</span>` : ''}</div>
              <div class="osd-times"><span>${fmtClock(now.start)}</span><div class="bar"><i></i></div><span>${fmtClock(now.stop)}</span></div>
              ${now.desc ? `<p class="osd-desc">${esc(now.desc)}</p>` : ''}` : `<div class="osd-now"><span class="live-pill">LIVE</span><b>${esc(it.name)}</b></div><div class="muted">No programme information</div>`}
            ${next ? `<div class="osd-next"><span>Next</span> ${fmtClock(next.start)} · ${esc(next.title)}</div>` : ''}
          </div>
          <div class="osd-hints">
            <span><kbd>▲▼</kbd> Zap</span><span><kbd>◀</kbd> Channels</span><span><kbd>▶</kbd> Options</span><span><kbd>G</kbd> Guide</span>
          </div>
        </div>`;
        this.osd.querySelector('.osd-logo').append(this.#logo(it));
      }
      const pct = now ? clamp((Date.now() - now.start) / (now.stop - now.start), 0, 1) * 100 : 0;
      const bar = this.osd.querySelector('.osd-times .bar i');
      if (bar) bar.style.width = pct + '%';
    } else {
      const v = this.video, dur = this.kind === 'catchup' ? (this.prog.stop - this.prog.start) / 1000 : v.duration;
      const key = `V|${it.id}|${this.kind}|${this.prog?.start}`;
      if (key !== this.osdKey) {
        this.osdKey = key;
        const title = this.kind === 'catchup' ? this.prog.title : it.name;
        const sub = this.kind === 'catchup' ? `${esc(it.name)} · ${fmtClock(this.prog.start)} – ${fmtClock(this.prog.stop)}` : esc(this.vodSub || it.group || '');
        this.osd.innerHTML = `
        <div class="osd-top"><div class="osd-title-top">${this.kind === 'catchup' ? '<span class="cu-pill">CATCH-UP</span>' : ''}</div><div class="osd-clock"></div></div>
        <div class="osd-center"><div class="big-play">${icon('play')}</div></div>
        <div class="osd-bottom glass vod">
          <div class="osd-vodtitle"><b>${esc(title)}</b><span class="muted">${sub}</span></div>
          <div class="osd-seek"><span class="t-pos"></span><div class="bar seek"><i></i><em></em></div><span class="t-left"></span></div>
          <div class="osd-hints"><span><kbd>OK</kbd> Play/Pause</span><span><kbd>◀▶</kbd> Seek</span><span><kbd>▼</kbd> Options</span>${this.vodNext ? '<span><kbd>⏭</kbd> Next episode</span>' : ''}</div>
        </div>`;
        const bar = this.osd.querySelector('.bar.seek');
        bar.onclick = (e) => { const r = bar.getBoundingClientRect(); const d = this.kind === 'catchup' ? (this.prog.stop - this.prog.start) / 1000 : this.video.duration; if (d) this.video.currentTime = (e.clientX - r.left) / r.width * d; };
      }
      const pos = this.seekPreview ?? v.currentTime;
      const pct = dur ? clamp(pos / dur, 0, 1) * 100 : 0;
      this.osd.querySelector('.bar.seek i').style.width = pct + '%';
      this.osd.querySelector('.bar.seek em').style.left = pct + '%';
      this.osd.querySelector('.t-pos').textContent = fmtDuration(pos);
      this.osd.querySelector('.t-left').textContent = dur && isFinite(dur) ? '-' + fmtDuration(dur - pos) : '--:--';
      this.osd.querySelector('.big-play').style.visibility = v.paused && this.state !== 'loading' ? 'visible' : 'hidden';
    }
    const c = this.osd.querySelector('.osd-clock');
    if (c && c.textContent !== clock) c.textContent = clock;
  }

  /** One logo element per channel, reused so the image never reloads while zapping. */
  #logoCache = new Map();
  #logo(it) {
    let el = this.#logoCache.get(it.id);
    if (!el) {
      el = logoEl(it.logo, it.name, 'logo xl');
      this.#logoCache.set(it.id, el);
      if (this.#logoCache.size > 60) this.#logoCache.delete(this.#logoCache.keys().next().value);
    }
    return el;
  }

  #renderStats() {
    const s = this.engine.stats();
    this.statsEl.innerHTML = Object.entries(s).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  }

  // ---------------- keys ----------------
  #keys(k, e) {
    if (this.mode !== 'full') return false;
    if (this.sideOpen) {
      if (k === 'back' || (k === 'right' && this.sideKind === 'channels') || (k === 'left' && this.sideKind === 'options')) { this.#closeSide(); return true; }
      return false; // let side panel components handle
    }
    if (k === 'digit') return this.#digit(e.key);
    if (k === 'back') {
      if (this.numBuf) { this.numBuf = ''; this.numEl.classList.remove('on'); return true; }
      if (this.osdVisible && this.kind === 'live') { this.#hideOsd(); return true; }
      this.exitFullscreen(); return true;
    }
    if (k === 'mute') { this.video.muted = !this.video.muted; toast(this.video.muted ? 'Muted' : 'Sound on', { icon: this.video.muted ? 'mute' : 'audio', ms: 1200 }); return true; }
    if (k === 'fullscreen') { this.#toggleNativeFs(); return true; }
    if (k === 'menu') { this.#openOptions(); return true; }
    if (k === 'guide') { this.exitFullscreen(); window.dispatchEvent(new CustomEvent('go', { detail: 'guide' })); return true; }
    if (k === 'info') { this.#toggleOsd(); return true; }
    if (this.kind === 'live') {
      if (k === 'up' || k === 'chup') { this.zap(-1); return true; }
      if (k === 'down' || k === 'chdown') { this.zap(1); return true; }
      if (k === 'left') { this.#openChannels(); return true; }
      if (k === 'right') { this.#openOptions(); return true; }
      if (k === 'ok') { this.osdVisible ? this.#hideOsd() : this.#showOsd(8000); return true; }
      if (k === 'prev') { this.lastChannel(); return true; }
      return true;
    }
    // VOD / catch-up
    const v = this.video;
    if (k === 'ok' || k === 'space' || k === 'playpause') { v.paused ? v.play() : v.pause(); this.#showOsd(); return true; }
    if (k === 'play') { v.play(); return true; }
    if (k === 'pause') { v.pause(); this.#showOsd(0); return true; }
    if (k === 'left' || k === 'right' || k === 'rw' || k === 'ff') { this.#seekStep(k === 'left' || k === 'rw' ? -1 : 1); return true; }
    if (k === 'down') { this.#openOptions(); return true; }
    if (k === 'up') { this.#showOsd(); return true; }
    if (k === 'next' && this.vodNext) { this.#playNext(); return true; }
    return true;
  }

  #seekStep(dir) {
    const v = this.video;
    const now = performance.now();
    this.seekStreak = now - (this.lastSeek || 0) < 600 ? (this.seekStreak || 0) + 1 : 0;
    this.lastSeek = now;
    const step = this.seekStreak > 12 ? 120 : this.seekStreak > 6 ? 60 : this.seekStreak > 2 ? 30 : 10;
    const base = this.seekPreview ?? v.currentTime;
    this.seekPreview = clamp(base + dir * step, 0, (v.duration || 1e9) - 1);
    this.#showOsd();
    clearTimeout(this.seekT);
    this.seekT = setTimeout(() => { v.currentTime = this.seekPreview; this.seekPreview = null; this.#renderOsd(); }, 450);
  }

  zap(d) {
    const list = this.list.length ? this.list : lib.live;
    const i = list.findIndex((c) => c.id === this.item?.id);
    const next = list[(i + d + list.length) % list.length];
    if (next) this.playChannel(next, { list });
  }
  lastChannel() { if (this.prevChannel) this.playChannel(this.prevChannel, { list: this.list }); }

  #digit(d) {
    this.numBuf = (this.numBuf || '') + d;
    this.numEl.textContent = this.numBuf;
    this.numEl.classList.add('on');
    clearTimeout(this.numT);
    const go = () => {
      const n = parseInt(this.numBuf, 10); this.numBuf = ''; this.numEl.classList.remove('on');
      const ch = lib.live.find((c) => c.num === n);
      if (ch) this.playChannel(ch, { list: this.list.includes(ch) ? this.list : lib.live });
      else toast(`No channel ${n}`, { ms: 1500 });
    };
    this.numT = setTimeout(go, this.numBuf.length >= 4 ? 0 : 1600);
    return true;
  }

  #onTime() {
    if (this.kind === 'movie' || this.kind === 'episode') {
      if (this.osdVisible && !this.seekPreview) this.#renderOsdThrottled();
    } else if (this.kind === 'catchup' && this.osdVisible) this.#renderOsdThrottled();
  }
  #lastR = 0;
  #renderOsdThrottled() { const n = performance.now(); if (n - this.#lastR > 500) { this.#lastR = n; this.#renderOsd(); } }
  #vodTick() {
    clearInterval(this.resumeT);
    this.resumeT = setInterval(() => {
      if ((this.kind === 'movie' || this.kind === 'episode') && this.item && !this.video.paused) {
        lib.setResume(this.item.id, this.video.currentTime, this.video.duration,
          { id: this.item.id, name: this.item.name, logo: this.item.logo || this.item.cover, kind: this.kind, url: this.engine.url, sub: this.vodSub });
      }
    }, 5000);
  }
  #onEnded() {
    if (this.kind === 'episode' && this.vodNext && settings.get('autoplayNextEpisode')) return this.#playNext();
    if (this.kind === 'movie' || this.kind === 'episode') { lib.setResume(this.item.id, 0, this.video.duration); this.exitFullscreen(); }
  }
  #playNext() {
    const n = this.vodNext?.();
    if (n) { toast('Up next: ' + n.item.name, { icon: 'skip' }); this.playVod(n.item, n.url, n.opts); }
  }

  #toggleNativeFs() {
    if (isNative) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // ---------------- side panels ----------------
  #openSide(kind, build) {
    this.#closeSide();
    this.sideOpen = true; this.sideKind = kind;
    this.side.className = 'p-side glass ' + kind;
    this.side.replaceChildren(...build());
    requestAnimationFrame(() => this.side.classList.add('open'));
    this.#hideOsd();
  }
  #closeSide() {
    if (!this.sideOpen) return;
    this.sideOpen = false;
    this.side.classList.remove('open');
    const el = this.side; setTimeout(() => { if (!this.sideOpen) el.replaceChildren(); }, 250);
    document.activeElement?.blur();
  }

  #openChannels() {
    const list = this.list.length ? this.list : lib.live;
    const vl = new VList({
      rowHeight: rem(4.25), className: 'side-list',
      render: (ch, i, el) => {
        const [now] = lib.nowNext(ch);
        const pct = now ? clamp((Date.now() - now.start) / (now.stop - now.start), 0, 1) * 100 : 0;
        el.className = 'vrow chrow' + (ch.id === this.item?.id ? ' playing' : '') + (i === vl.index ? ' current' : '');
        el.innerHTML = `<span class="num">${settings.get('showChannelNumbers') ? ch.num : ''}</span><span class="lg"></span><span class="meta"><b>${esc(ch.name)}</b><small>${now ? esc(now.title) : '&nbsp;'}</small>${now ? `<span class="mini-bar"><i style="width:${pct}%"></i></span>` : ''}</span>`;
        el.querySelector('.lg').append(logoEl(ch.logo, ch.name));
      },
      onActivate: (ch) => { this.#closeSide(); this.playChannel(ch, { list }); },
    });
    this.#openSide('channels', () => [h('div.side-title', iconEl('list'), h('span', this.list.length && this.list !== lib.live ? (this.item?.group || 'Channels') : 'All channels')), vl.el]);
    requestAnimationFrame(() => { vl.setItems(list, Math.max(0, list.findIndex((c) => c.id === this.item?.id))); vl.focus(); });
  }

  #openOptions() {
    const e = this.engine;
    const opts = [];
    const add = (ic, label, value, fn) => opts.push(h('button.opt', { onclick: fn }, h('span', { html: icon(ic) }), h('span.opt-l', label), value != null && h('span.opt-v', value)));
    if (this.kind === 'live') {
      const fav = lib.isFav(this.item.id);
      add('star', fav ? 'Remove from favorites' : 'Add to favorites', null, () => { const on = lib.toggleFav(this.item.id); toast(on ? 'Added to favorites' : 'Removed from favorites', { icon: 'star' }); this.#closeSide(); this.#renderOsd(); });
      if (this.prevChannel) add('history', 'Previous channel', this.prevChannel.name, () => { this.#closeSide(); this.lastChannel(); });
      add('grid', 'Multi-view', 'Watch up to 4', () => { this.#closeSide(); const ch = this.item; this.exitFullscreen(); window.dispatchEvent(new CustomEvent('multiview', { detail: ch })); });
    }
    const at = e.audioTracks();
    if (at.length > 1) add('audio', 'Audio track', at.find((t) => t.active)?.label, async () => { const c = await choose('Audio track', at); if (c) e.setAudio(c.id); });
    const st = e.subtitleTracks();
    if (st.length) add('cc', 'Subtitles', st.find((t) => t.active)?.label, async () => { const c = await choose('Subtitles', st); if (c) e.setSubtitle(c.id); });
    const q = e.qualities();
    if (q.length) add('hd', 'Quality', q.find((t) => t.active)?.label.split(' ·')[0] || 'Auto', async () => { const c = await choose('Quality', q); if (c) e.setQuality(c.id); });
    const asp = this.video.style.objectFit || 'contain';
    add('aspect', 'Aspect ratio', ASPECTS.find((a) => a[0] === asp)?.[1], () => {
      const i = (ASPECTS.findIndex((a) => a[0] === asp) + 1) % ASPECTS.length;
      this.video.style.objectFit = ASPECTS[i][0]; store.set('aspect', ASPECTS[i][0]); toast('Aspect: ' + ASPECTS[i][1], { icon: 'aspect', ms: 1200 }); this.#openOptions();
    });
    if (document.pictureInPictureEnabled && !isNative) add('pip', 'Picture-in-picture', null, () => { this.#closeSide(); this.video.requestPictureInPicture().catch(() => toast('PiP unavailable')); });
    add('moon', 'Sleep timer', this.sleepAt ? `${Math.ceil((this.sleepAt - Date.now()) / 60000)} min left` : 'Off', async () => {
      const c = await choose('Sleep timer', [0, 15, 30, 60, 90, 120].map((m) => ({ id: m, label: m ? `${m} minutes` : 'Off' })));
      if (!c) return;
      clearTimeout(this.sleepT); this.sleepAt = 0;
      if (c.id) { this.sleepAt = Date.now() + c.id * 60e3; this.sleepT = setTimeout(() => { this.stop(); toast('Sleep timer: playback stopped', { icon: 'moon' }); }, c.id * 60e3); toast(`Stopping in ${c.id} minutes`, { icon: 'moon' }); }
      this.#closeSide();
    });
    add('stats', 'Stream info', this.showStats ? 'On' : 'Off', () => { this.showStats = !this.showStats; this.statsEl.classList.toggle('on', this.showStats); this.#renderStats(); this.#openOptions(); });
    add('refresh', 'Reload stream', null, () => { this.#closeSide(); this.engine.load(this.engine.url, this.engine.opts); });
    this.#openSide('options', () => [h('div.side-title', iconEl('settings'), h('span', 'Options')), h('div.opts', opts)]);
    setTimeout(() => this.side.querySelector('.opt')?.focus(), 30);
  }
}

export const player = new Player();
