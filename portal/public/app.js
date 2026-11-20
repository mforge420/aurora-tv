// Lumora TV device portal (vanilla JS, hash routing)
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const I = {
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="3"/><path d="m17 2-5 5-5-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
  guide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  guide2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/></svg>',
};

async function api(path, opts = {}) {
  const r = await fetch(path, { method: opts.method || 'GET', headers: opts.body ? { 'content-type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/api/auth/')) { location.hash = '#/login'; throw new Error('Signed out'); }
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2600); }
const ago = (t, now = Date.now()) => { if (!t) return 'never'; const s = Math.round((now - t) / 1000); if (s < 60) return 'just now'; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 48) return `${h} h ago`; return `${Math.round(h / 24)} days ago`; };
const online = (d, now) => d.lastSeen && now - d.lastSeen < 90e3;
const fmt = (n) => (n || 0).toLocaleString();

// ------------------------------------------------------------------ routing
let timer = null;
async function route() {
  clearInterval(timer);
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  const h = location.hash || '#/';
  let state;
  try { state = await api('/api/auth/state'); } catch { $app.innerHTML = '<div class="center"><p class="muted">Can\'t reach the server.</p></div>'; return; }
  nav(state.loggedIn);
  if (state.setup) return setupView();
  if (!state.loggedIn) return loginView();
  setTab(h.startsWith('#/playlist') ? 'playlists' : 'tvs');
  const m = h.match(/^#\/device\/([\w-]+)/);
  if (m) return deviceView(m[1]);
  const c = h.match(/^#\/playlist\/([\w-]+)/);
  if (c) return categoriesView(c[1]);
  if (h.startsWith('#/playlists')) return libraryView();
  return devicesView();
}
window.addEventListener('hashchange', route);
function setTab(t) { for (const a of document.querySelectorAll('.tab-link')) a.classList.toggle('on', a.dataset.tab === t); }
function nav(loggedIn) {
  document.getElementById('topnav').innerHTML = loggedIn ? `<a class="tab-link" data-tab="tvs" href="#/">${I.tv}<span>TVs</span></a><a class="tab-link" data-tab="playlists" href="#/playlists">${I.list}<span>Playlists</span></a><button class="btn ghost sm" id="logout">Sign out</button>` : '';
  document.getElementById('logout')?.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.hash = '#/'; route(); });
}

// ------------------------------------------------------------------ auth views
function setupView() {
  $app.innerHTML = `<form class="card auth" id="f"><img src="/icon.svg" alt=""><h1>Welcome</h1><p class="muted">Create the password you'll use to manage your TVs.</p>
    <label class="f"><span>Setup key</span><input class="in" name="setupKey" autocomplete="off" required></label>
    <label class="f"><span>New password (10+ characters)</span><input class="in" name="password" type="password" autocomplete="new-password" minlength="10" required></label>
    <label class="f"><span>Repeat password</span><input class="in" name="password2" type="password" autocomplete="new-password" required></label>
    <div class="err" id="e"></div><button class="btn primary" style="width:100%;margin-top:8px">Create password</button></form>`;
  const f = document.getElementById('f');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (f.password.value !== f.password2.value) return (document.getElementById('e').textContent = 'The passwords don\'t match');
    try { await api('/api/auth/setup', { method: 'POST', body: { setupKey: f.setupKey.value.trim(), password: f.password.value } }); location.hash = '#/'; route(); }
    catch (e) { document.getElementById('e').textContent = e.message; }
  };
}
function loginView() {
  $app.innerHTML = `<form class="card auth" id="f"><img src="/icon.svg" alt=""><h1>Sign in</h1><p class="muted">Manage your Lumora TV devices.</p>
    <label class="f"><span>Password</span><input class="in" name="password" type="password" autocomplete="current-password" required autofocus></label>
    <div class="err" id="e"></div><button class="btn primary" style="width:100%;margin-top:8px">Sign in</button></form>`;
  const f = document.getElementById('f');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('/api/auth/login', { method: 'POST', body: { password: f.password.value } }); route(); }
    catch (e) { document.getElementById('e').textContent = e.message; }
  };
}

// ------------------------------------------------------------------ devices
let cache = null;
async function load() { cache = await api('/api/devices'); return cache; }

async function devicesView() {
  const draw = (d) => {
    const devs = d.devices;
    $app.innerHTML = `<div class="head"><div><h1>Your TVs</h1><p class="muted">${devs.length ? `${devs.filter((x) => online(x, d.now)).length} of ${devs.length} online` : 'Pair a TV to get started'}</p></div>
      <button class="btn primary" id="add">${I.plus}Add a TV</button></div>
      ${devs.length ? `<div class="grid">${devs.map((x) => devCard(x, d.now)).join('')}</div>` : `<div class="card empty">${I.tv}<h2>No TVs yet</h2><p class="muted" style="margin-top:6px">On the TV, open Lumora → Settings → Remote management and turn it on.<br>Then click <b>Add a TV</b> and enter the code it shows.</p></div>`}`;
    document.getElementById('add').onclick = pairDialog;
    for (const el of document.querySelectorAll('.dev')) el.onclick = () => (location.hash = '#/device/' + el.dataset.id);
  };
  draw(await load());
  timer = setInterval(async () => { if (!document.querySelector('dialog[open]')) draw(await load().catch(() => cache)); }, 10e3);
}
function devCard(x, now) {
  const on = online(x, now);
  const errs = (x.report?.playlists || []).filter((p) => p.error).length;
  return `<div class="card dev" data-id="${esc(x.id)}">
    <div class="dev-top"><div class="tv-ico">${I.tv}</div><div style="min-width:0"><div class="dev-name">${esc(x.name)}</div>
      <span class="status ${on ? 'on' : ''}"><i></i>${on ? 'Online' : 'Offline · seen ' + ago(x.lastSeen, now)}</span></div></div>
    <dl class="kv"><dt>Watching</dt><dd>${on && x.nowPlaying ? esc(x.nowPlaying) : '—'}</dd>
      <dt>Playlists</dt><dd>${x.playlists.length}${errs ? ` <span class="pill bad">${errs} problem${errs > 1 ? 's' : ''}</span>` : ''}</dd>
      <dt>App</dt><dd>${esc(x.appVersion || '?')}${x.model ? ' · ' + esc(x.model) : ''}</dd></dl></div>`;
}

async function deviceView(id) {
  const draw = (d) => {
    const x = d.devices.find((v) => v.id === id);
    if (!x) { location.hash = '#/'; return; }
    const on = online(x, d.now);
    const rep = new Map((x.report?.playlists || []).map((p) => [p.remoteId, p]));
    const local = x.report?.local || [];
    $app.innerHTML = `<a class="back" href="#/">${I.back} All TVs</a>
      <div class="head"><div class="title-edit"><h1>${esc(x.name)}</h1><button class="btn sm" id="rename">Rename</button></div>
        <span class="status ${on ? 'on' : ''}"><i></i>${on ? 'Online' + (x.nowPlaying ? ' · watching ' + esc(x.nowPlaying) : '') : 'Offline · last seen ' + ago(x.lastSeen, d.now) + ' — changes apply when it\'s turned on'}</span></div>
      <div class="cols"><div>
        <section class="card sec"><div class="head" style="margin-bottom:6px"><h2>Playlists</h2><button class="btn sm primary" id="addpl">${I.list}Choose playlists</button></div>
          ${x.playlists.length ? x.playlists.map((p) => plRow(p, rep.get(p.id), x)).join('') : '<p class="muted" style="padding:14px 0">No playlists on this TV yet. Click <b>Choose playlists</b>.</p>'}
          ${x.playlists.length > 1 ? `<p class="small muted" style="margin-top:10px">${x.report?.active === 'all' ? 'The TV shows <b>all playlists combined</b>.' : 'The TV shows one playlist at a time.'} <button class="btn sm ghost" data-activate="all" ${x.report?.active === 'all' ? 'disabled' : ''}>Combine all</button></p>` : ''}
          ${local.length ? `<p class="muted small" style="margin-top:12px">Also on this TV (added from a file, can't be edited here): ${local.map((l) => esc(l.name)).join(', ')}</p>` : ''}
        </section>
      </div>
      <aside class="card sec"><h3>Actions</h3><div class="actions">
        <button class="btn" data-cmd="refresh">${I.refresh}Refresh playlists</button>
        <button class="btn" data-cmd="refreshEpg">${I.guide}Update TV guide</button>
        <button class="btn" data-cmd="checkUpdate">${I.up}Offer app update</button>
        <button class="btn" data-cmd="message">${I.msg}Show a message</button>
        <button class="btn" data-cmd="reload">${I.power}Restart the app</button>
      </div>
      <h3 style="margin-top:22px">Details</h3><dl class="kv"><dt>App</dt><dd>${esc(x.appVersion || '?')}</dd><dt>Device</dt><dd>${esc(x.model || '?')}</dd><dt>Last seen</dt><dd>${ago(x.lastSeen, d.now)}</dd></dl>
      <button class="btn danger sm" id="unpair" style="margin-top:20px;width:100%">Unpair this TV</button></aside></div>`;
    document.getElementById('rename').onclick = async () => {
      const name = prompt('Name for this TV', x.name); if (!name) return;
      await api('/api/devices/' + id, { method: 'PATCH', body: { name } }); draw(await load());
    };
    document.getElementById('addpl').onclick = () => choosePlaylistsDialog(x);
    for (const b of document.querySelectorAll('[data-edit]')) b.onclick = () => playlistDialog(x.playlists.find((p) => p.id === b.dataset.edit));
    for (const b of document.querySelectorAll('[data-cats]')) b.onclick = () => (location.hash = '#/playlist/' + b.dataset.cats);
    for (const b of document.querySelectorAll('[data-guide]')) b.onclick = () => guideFileDialog(x.playlists.find((p) => p.id === b.dataset.guide));
    for (const b of document.querySelectorAll('[data-del]')) b.onclick = async () => {
      const p = x.playlists.find((v) => v.id === b.dataset.del);
      if (!confirm(`Take “${p.name || 'this playlist'}” off ${x.name}? It stays in your playlists for other TVs.`)) return;
      await api(`/api/devices/${id}/playlists`, { method: 'PUT', body: { ids: x.playlists.filter((v) => v.id !== p.id).map((v) => v.id) } });
      toast('Removed — the TV updates within a minute'); draw(await load());
    };
    for (const b of document.querySelectorAll('[data-activate]')) b.onclick = async () => {
      await api(`/api/devices/${id}/commands`, { method: 'POST', body: { type: 'activate', payload: b.dataset.activate } });
      toast(on ? 'Switching — the TV changes within 30 seconds' : 'Queued — it switches when the TV is next on');
      b.disabled = true;
    };
    for (const b of document.querySelectorAll('[data-cmd]')) b.onclick = async () => {
      let payload = '';
      if (b.dataset.cmd === 'message') { payload = prompt('Message to show on the TV'); if (!payload) return; }
      if (b.dataset.cmd === 'reload' && !confirm('Restart Lumora on this TV? Whatever is playing will stop.')) return;
      await api(`/api/devices/${id}/commands`, { method: 'POST', body: { type: b.dataset.cmd, payload } });
      toast(on ? 'Sent — the TV picks it up within 30 seconds' : 'Queued — it runs when the TV is next on');
    };
    document.getElementById('unpair').onclick = async () => {
      if (!confirm(`Unpair ${x.name}? Its playlists stay on the TV, but you won't be able to manage it until it's paired again.`)) return;
      await api('/api/devices/' + id, { method: 'DELETE' }); location.hash = '#/';
    };
  };
  draw(await load());
  timer = setInterval(async () => { if (!document.querySelector('dialog[open]')) draw(await load().catch(() => cache)); }, 10e3);
}
function plRow(p, r, x) {
  const isActive = x?.report?.active === p.id;
  const activeEl = x && x.playlists.length > 1 && r && !r.error
    ? (isActive ? '<span class="pill ok">● Active on TV</span>' : `<button class="btn sm" data-activate="${esc(p.id)}">Make active</button>`) : '';
  const where = p.type === 'xtream' ? `${esc(p.server)} · ${esc(p.user)}` : esc(p.url);
  const stats = r && !r.error && r.counts ? `<span class="pill">${fmt(r.counts.live)} channels</span><span class="pill">${fmt(r.counts.movies)} movies</span><span class="pill">${fmt(r.counts.series)} series</span>` : '';
  const state = !r ? '<span class="pill">Waiting for the TV</span>' : r.error ? `<span class="pill bad">${esc(r.error)}</span>` : '<span class="pill ok">Loaded</span>';
  const exp = r?.expires ? `<span class="pill">Expires ${new Date(r.expires).toLocaleDateString()}</span>` : '';
  return `<div class="pl"><div class="pl-main"><b>${esc(p.name || (p.type === 'xtream' ? p.server : 'Playlist'))}</b><div class="small muted">${p.type === 'xtream' ? 'Xtream Codes' : 'M3U'} · ${where}</div>
    <div class="pl-stats">${state}${stats}${exp}${hiddenPill(p)}${guidePill(p)}${r?.epgError ? `<span class="pill bad">Guide: ${esc(r.epgError)}</span>` : ''}</div></div>
    ${activeEl}<button class="btn sm" data-guide="${esc(p.id)}">Guide file</button><button class="btn sm" data-cats="${esc(p.id)}">Categories</button><button class="btn sm" data-edit="${esc(p.id)}">Edit</button><button class="btn sm ghost" data-del="${esc(p.id)}" aria-label="Take off this TV" title="Take off this TV">✕</button></div>`;
}

// ------------------------------------------------------------------ dialogs
function dialog(html) {
  const d = document.createElement('dialog');
  d.innerHTML = html;
  document.getElementById('dialogs').append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}
function pairDialog() {
  const d = dialog(`<form method="dialog" id="f"><h2>Add a TV</h2><p class="muted small" style="margin-top:6px">On the TV: Lumora → Settings → Remote management → Turn on. Enter the code it shows.</p>
    <label class="f"><span>Code on the TV</span><input class="in code-in" name="code" maxlength="8" autocomplete="off" autocapitalize="characters" required></label>
    <label class="f"><span>Name</span><input class="in" name="name" placeholder="e.g. Mum's living room" required></label>
    <div class="err" id="e"></div><div class="row end"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn primary" id="go">Pair</button></div></form>`);
  const f = d.querySelector('form');
  d.querySelector('#go').onclick = async (ev) => {
    ev.preventDefault();
    if (!f.reportValidity()) return;
    try { const r = await api('/api/devices/claim', { method: 'POST', body: { code: f.code.value, name: f.name.value } }); d.close(); toast('Paired!'); location.hash = '#/device/' + r.id; }
    catch (e) { d.querySelector('#e').textContent = e.message; }
  };
}
const hiddenOf = (p) => (p.hidden?.live?.length || 0) + (p.hidden?.movies?.length || 0) + (p.hidden?.series?.length || 0);
const fmtWhen = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtMB = (n) => (n / 1048576).toFixed(1) + ' MB';
function guidePill(p) {
  const f = p.epgFile; if (!f) return '';
  if (!String(p.epgUrl || '').includes('/f/epg/')) return '<span class="pill">Guide file not in use</span>';
  if (f.to && f.to < Date.now()) return '<span class="pill bad">Guide file ran out — upload a new one</span>';
  if (f.to && f.to < Date.now() + 24 * 3600e3) return `<span class="pill warn">Guide file ends ${esc(fmtWhen(f.to))}</span>`;
  return `<span class="pill ok">Guide file${f.to ? ' until ' + esc(fmtWhen(f.to)) : ''}</span>`;
}
const hiddenPill = (p) => (hiddenOf(p) ? `<span class="pill">${hiddenOf(p)} categor${hiddenOf(p) > 1 ? 'ies' : 'y'} hidden</span>` : '');

/** Add or edit a shared playlist; tick the TVs that get it */
async function playlistDialog(p, { devices, preselect = [] } = {}) {
  let type = p?.type || 'xtream';
  if (!devices) devices = (await api('/api/library')).devices;
  const libp = p && (await api('/api/library')).playlists.find((v) => v.id === p.id);
  const assigned = new Set(libp ? libp.devices : preselect);
  const d = dialog(`<form id="f"><h2>${p ? 'Edit playlist' : 'Add playlist'}</h2>
    <div class="tabs"><button type="button" data-t="xtream">Xtream Codes</button><button type="button" data-t="m3u">M3U link</button></div>
    <label class="f"><span>Name</span><input class="in" name="name" value="${esc(p?.name)}" placeholder="My provider"></label>
    <div data-for="xtream"><label class="f"><span>Server URL</span><input class="in" name="server" value="${esc(p?.server)}" placeholder="http://provider.example:8080" autocapitalize="off" spellcheck="false"></label>
      <div class="row"><label class="f"><span>Username</span><input class="in" name="user" value="${esc(p?.user)}" autocapitalize="off" spellcheck="false"></label>
      <label class="f"><span>Password</span><div class="pw"><input class="in" name="pass" type="password" value="${esc(p?.pass)}" autocapitalize="off"><button type="button" id="show">Show</button></div></label></div></div>
    <div data-for="m3u"><label class="f"><span>Playlist URL</span><input class="in" name="url" value="${esc(p?.url)}" placeholder="https://…/playlist.m3u" autocapitalize="off" spellcheck="false"></label></div>
    <label class="f"><span>TV guide (XMLTV) URL <span class="muted">— optional</span></span><input class="in" name="epgUrl" value="${esc(p?.epgUrl)}" placeholder="Detected automatically" autocapitalize="off" spellcheck="false"></label>
    <div class="f"><span class="flabel">Use on these TVs</span>${devices.length ? `<div class="checks">${devices.map((v) => `<label class="check"><input type="checkbox" name="dev" value="${esc(v.id)}" ${assigned.has(v.id) ? 'checked' : ''}><span>${esc(v.name)}</span></label>`).join('')}</div>` : '<p class="muted small">No TVs paired yet — you can tick them later.</p>'}</div>
    ${p && assigned.size > 1 ? `<p class="small muted" style="margin-top:10px">Changes apply to all ${assigned.size} TVs using it.</p>` : ''}
    <div class="err" id="e"></div><div class="row end"><button type="button" class="btn ghost" id="cancel">Cancel</button><button class="btn primary">${p ? 'Save' : 'Add'}</button></div></form>`);
  const f = d.querySelector('form');
  const setType = (t) => { type = t; d.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); d.querySelectorAll('[data-for]').forEach((x) => (x.hidden = x.dataset.for !== t)); };
  d.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => setType(b.dataset.t)));
  setType(type);
  d.querySelector('#show').onclick = (ev) => { const i = f.pass; i.type = i.type === 'password' ? 'text' : 'password'; ev.target.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
  d.querySelector('#cancel').onclick = () => d.close();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const devs = [...f.querySelectorAll('input[name=dev]:checked')].map((i) => i.value);
    const b = { type, name: f.name.value, server: f.server.value, user: f.user.value, pass: f.pass.value, url: f.url.value, epgUrl: f.epgUrl.value, devices: devs };
    try {
      if (p) await api('/api/library/' + p.id, { method: 'PUT', body: b });
      else await api('/api/library', { method: 'POST', body: b });
      d.close(); toast(devs.length ? 'Saved — the TVs update within a minute' : 'Saved');
      route();
    } catch (e) { d.querySelector('#e').textContent = e.message; }
  };
}

/** Tick which library playlists a TV gets */
async function choosePlaylistsDialog(x) {
  const lib = await api('/api/library');
  const mine = new Set(x.playlists.map((p) => p.id));
  const d = dialog(`<form id="f"><h2>Playlists on ${esc(x.name)}</h2>
    ${lib.playlists.length ? `<div class="checks col">${lib.playlists.map((p) => `<label class="check"><input type="checkbox" value="${esc(p.id)}" ${mine.has(p.id) ? 'checked' : ''}><span><b>${esc(p.name || 'Playlist')}</b><small class="muted">${p.type === 'xtream' ? 'Xtream · ' + esc(p.server) : 'M3U'} · on ${p.devices.length} TV${p.devices.length === 1 ? '' : 's'}</small></span></label>`).join('')}</div>` : '<p class="muted" style="margin-top:12px">You have no playlists yet.</p>'}
    <button type="button" class="btn sm ghost" id="new" style="margin-top:12px">${I.plus}New playlist</button>
    <div class="err" id="e"></div><div class="row end"><button type="button" class="btn ghost" id="cancel">Cancel</button><button class="btn primary">Save</button></div></form>`);
  const f = d.querySelector('form');
  d.querySelector('#cancel').onclick = () => d.close();
  d.querySelector('#new').onclick = () => { d.close(); playlistDialog(null, { devices: lib.devices, preselect: [x.id] }); };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const ids = [...f.querySelectorAll('input:checked')].map((i) => i.value);
    try { await api(`/api/devices/${x.id}/playlists`, { method: 'PUT', body: { ids } }); d.close(); toast('Saved — the TV updates within a minute'); route(); }
    catch (e) { d.querySelector('#e').textContent = e.message; }
  };
}

/** Read an XMLTV file in the browser: channel count + first/last programme time. Returns a gzip Blob to upload. */
async function inspectGuide(file, onProgress) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  let stream = file.stream();
  if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let tail = '', channels = 0, from = Infinity, to = -Infinity, read = 0, total = gz ? file.size * 7 : file.size, first = true;
  const re = /<channel\s|start="(\d{14})\s*([+-]\d{4})?/g;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (first) { if (!value.trimStart().startsWith('<')) throw new Error("That doesn't look like a TV guide file."); first = false; }
    read += value.length; onProgress?.(Math.min(99, Math.round((read / total) * 100)));
    const text = tail + value;
    let m; re.lastIndex = 0;
    const seen = tail.length; // matches lying wholly inside the carried-over tail were counted last time
    while ((m = re.exec(text))) {
      if (m.index + m[0].length <= seen) continue;
      if (!m[1]) { channels++; continue; }
      const d = m[1], z = m[2] || '+0000';
      const t = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10), +d.slice(10, 12)) - (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3)) * 60e3;
      if (t < from) from = t; if (t > to) to = t;
    }
    tail = text.slice(-40); // a tag cut between chunks is completed by the next chunk
  }
  if (!Number.isFinite(from)) throw new Error('No programmes found in this file.');
  const blob = gz ? file : await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { blob, channels, from, to, gz: true };
}

async function guideFileDialog(p) {
  const L = await api('/api/library');
  p = L.playlists.find((x) => x.id === p.id) || p;
  const f = p.epgFile;
  const inUse = String(p.epgUrl || '').includes('/f/epg/');
  const d = dialog(`<div><h2>TV guide file · ${esc(p.name || 'Playlist')}</h2>
    <p class="muted small" style="margin-top:6px">Upload a guide file (.xml.gz or .xml, up to 25 MB), e.g. from myepg.top. The TVs using this playlist download it automatically. Guide files only cover a few days, so upload a fresh one before it runs out.</p>
    ${f ? `<div class="card gf"><b>${esc(f.name)}</b><span class="small muted">${fmtMB(f.size)} · uploaded ${ago(f.at)}${f.channels ? ` · ${f.channels.toLocaleString()} channels` : ''}</span>
      ${f.from ? `<span class="small">Covers <b>${esc(fmtWhen(f.from))}</b> → <b>${esc(fmtWhen(f.to))}</b></span>` : ''}
      <div class="pl-stats">${guidePill(p)}</div></div>` : ''}
    <label class="drop" id="drop"><input type="file" id="file" accept=".gz,.xml,.xmltv,application/gzip,application/xml,text/xml" hidden>
      ${I.guide2}<b>${f ? 'Upload a newer file' : 'Choose a guide file'}</b><span class="small muted">or drop it here</span></label>
    <div class="small" id="st" style="min-height:20px;margin-top:10px"></div>
    <div class="row end">${f ? '<button class="btn ghost danger" id="rm">Remove file</button>' : ''}<button class="btn ghost" id="close">Close</button></div></div>`);
  const st = d.querySelector('#st'), input = d.querySelector('#file'), drop = d.querySelector('#drop');
  const say = (t, bad) => { st.textContent = t; st.style.color = bad ? 'var(--bad)' : 'var(--t2)'; };
  d.querySelector('#close').onclick = () => d.close();
  d.querySelector('#rm')?.addEventListener('click', async () => {
    if (!confirm(`Remove the guide file from “${p.name}”?${inUse ? ' The playlist goes back to the guide it used before.' : ''}`)) return;
    try { await api(`/api/library/${p.id}/epgfile`, { method: 'DELETE' }); d.close(); toast('Guide file removed'); route(); } catch (e) { say(e.message, true); }
  });
  const upload = async (file) => {
    if (!file) return;
    drop.classList.add('busy');
    try {
      say('Reading the file…');
      const info = await inspectGuide(file, (pc) => say(`Reading the file… ${pc}%`));
      if (info.blob.size > 25 * 1048576) throw new Error(`Even compressed the file is ${fmtMB(info.blob.size)}; the limit is 25 MB.`);
      if (info.to < Date.now()) throw new Error(`This file ended ${fmtWhen(info.to)}, so it has no current programmes. Download a fresh one.`);
      await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('PUT', `/api/library/${p.id}/epgfile`);
        x.setRequestHeader('content-type', 'application/octet-stream');
        x.setRequestHeader('x-name', file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 100));
        x.setRequestHeader('x-channels', String(info.channels)); x.setRequestHeader('x-from', String(info.from)); x.setRequestHeader('x-to', String(info.to));
        x.upload.onprogress = (e) => e.lengthComputable && say(`Uploading… ${Math.round((e.loaded / e.total) * 100)}%`);
        x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(j) : reject(new Error(j.error || 'Upload failed (' + x.status + ')')); };
        x.onerror = () => reject(new Error('Upload failed — check your connection'));
        x.send(info.blob);
      });
      d.close();
      toast(`Guide uploaded · ${info.channels.toLocaleString()} channels until ${fmtWhen(info.to)} — the TVs load it within a minute`);
      route();
    } catch (e) { say(e.message, true); drop.classList.remove('busy'); }
  };
  input.onchange = () => upload(input.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); };
}

// ------------------------------------------------------------------ playlist library
async function libraryView() {
  const L = await api('/api/library');
  const devName = new Map(L.devices.map((d) => [d.id, d.name]));
  $app.innerHTML = `<div class="head"><div><h1>Playlists</h1><p class="muted">Add a playlist once, then tick the TVs that should have it.</p></div>
    <button class="btn primary" id="add">${I.plus}Add playlist</button></div>
    ${L.playlists.length ? `<div class="card sec">${L.playlists.map((p) => `<div class="pl">
      <div class="pl-main"><b>${esc(p.name || 'Playlist')}</b><div class="small muted">${p.type === 'xtream' ? `Xtream Codes · ${esc(p.server)} · ${esc(p.user)}` : 'M3U · ' + esc(p.url)}</div>
        <div class="pl-stats">${p.devices.length ? p.devices.map((id) => `<span class="pill tv">${I.tv}${esc(devName.get(id) || 'TV')}</span>`).join('') : '<span class="pill bad">Not on any TV</span>'}${hiddenPill(p)}${guidePill(p)}</div></div>
      <button class="btn sm" data-guide="${esc(p.id)}">Guide file</button><button class="btn sm" data-cats="${esc(p.id)}">Categories</button><button class="btn sm" data-edit="${esc(p.id)}">Edit</button><button class="btn sm ghost" data-del="${esc(p.id)}" title="Delete">✕</button></div>`).join('')}</div>`
    : `<div class="card empty">${I.list}<h2>No playlists yet</h2><p class="muted" style="margin-top:6px">Click <b>Add playlist</b> to add your first one.</p></div>`}`;
  document.getElementById('add').onclick = () => playlistDialog(null, { devices: L.devices });
  for (const b of document.querySelectorAll('[data-guide]')) b.onclick = () => guideFileDialog(L.playlists.find((p) => p.id === b.dataset.guide));
  for (const b of document.querySelectorAll('[data-cats]')) b.onclick = () => (location.hash = '#/playlist/' + b.dataset.cats);
  for (const b of document.querySelectorAll('[data-edit]')) b.onclick = () => playlistDialog(L.playlists.find((p) => p.id === b.dataset.edit), { devices: L.devices });
  for (const b of document.querySelectorAll('[data-del]')) b.onclick = async () => {
    const p = L.playlists.find((v) => v.id === b.dataset.del);
    if (!confirm(`Delete “${p.name || 'this playlist'}”?${p.devices.length ? ` It will be removed from ${p.devices.length} TV${p.devices.length > 1 ? 's' : ''}.` : ''}`)) return;
    await api('/api/library/' + p.id, { method: 'DELETE' }); toast('Deleted'); libraryView();
  };
}

// ------------------------------------------------------------------ categories editor
async function categoriesView(id) {
  let C = await api(`/api/library/${id}/categories`);
  let kind = 'live', q = '';
  let show = (() => { try { return localStorage.getItem('lt-cat-filter') || 'all'; } catch { return 'all'; } })(); // all | on | off
  const KINDS = [['live', 'Live TV'], ['movies', 'Movies'], ['series', 'Series']];
  const hidden = {}, order = {};
  for (const [k] of KINDS) { hidden[k] = new Set(C.hidden?.[k] || []); order[k] = [...(C.order?.[k] || [])]; }

  // ---- saving (debounced; hidden + order are separate calls)
  const timers = {};
  const status = (t, ok = true) => { const el = document.getElementById('savestate'); if (el) { el.textContent = t; el.style.color = ok ? 'var(--ok)' : 'var(--bad)'; } };
  const saveLater = (what) => {
    clearTimeout(timers[what]); status('Saving…');
    timers[what] = setTimeout(async () => {
      try {
        if (what === 'hidden') await api(`/api/library/${id}/hidden`, { method: 'PUT', body: { hidden: { live: [...hidden.live], movies: [...hidden.movies], series: [...hidden.series] } } });
        else await api(`/api/library/${id}/order`, { method: 'PUT', body: { order } });
        status('Saved · the TVs update within a minute');
      } catch (e) { status('Not saved: ' + e.message, false); }
    }, 700);
  };

  // categories in display order: saved order first, then any new ones in provider order;
  // hidden names the provider no longer sends stay listed so they can be switched back on
  const provider = (k) => C.categories?.[k] || [];
  const ordered = (k) => {
    const prov = provider(k), extra = [...hidden[k]].filter((n) => !prov.includes(n));
    const all = [...prov, ...extra];
    const set = new Set(all);
    const first = order[k].filter((n) => set.has(n));
    const seen = new Set(first);
    return [...first, ...all.filter((n) => !seen.has(n))];
  };
  const setOrder = (names) => { order[kind] = names; saveLater('order'); };
  const isCustom = (k) => order[k].length > 0 && ordered(k).some((n, i) => n !== [...provider(k), ...[...hidden[k]].filter((x) => !provider(k).includes(x))][i]);

  const countText = () => {
    const total = provider(kind).length;
    if (!total) return '';
    const shown = total - [...hidden[kind]].filter((n) => provider(kind).includes(n)).length;
    return `${shown} of ${total} shown` + (q ? ` · ${visible().length} match` : '');
  };
  const visible = () => {
    const ql = q.toLowerCase();
    return ordered(kind).filter((n) => (!ql || n.toLowerCase().includes(ql)) && (show === 'all' || (show === 'on') !== hidden[kind].has(n)));
  };
  /** a new order for the visible (filtered) categories, merged back into the full list:
      the visible ones fill their own slots, everything else keeps its place */
  const mergeVisible = (newVisible) => {
    const vis = new Set(newVisible), it = newVisible[Symbol.iterator]();
    return ordered(kind).map((n) => (vis.has(n) ? it.next().value : n));
  };

  const drawList = () => {
    const box = document.getElementById('cats');
    const names = visible(), canMove = true, full = ordered(kind);
    drawSeg();
    box.innerHTML = names.length ? names.map((n, i) => `<div class="cat ${hidden[kind].has(n) ? 'off' : ''}" data-n="${esc(n)}">
        ${canMove ? `<span class="grip" title="Drag to move" aria-hidden="true">⋮⋮</span>` : ''}<span class="num">${full.indexOf(n) + 1}</span>
        <span class="cname">${esc(n)}</span>
        ${canMove ? `<button class="mv" data-mv="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button class="mv" data-mv="1" title="Move down" ${i === names.length - 1 ? 'disabled' : ''}>▼</button>` : ''}
        <input type="checkbox" class="sw" title="Show on TVs" ${hidden[kind].has(n) ? '' : 'checked'}></div>`).join('')
      : `<p class="muted" style="padding:18px 4px">${q ? 'No categories match.' : show === 'off' ? 'Nothing is hidden here.' : show === 'on' ? 'Every category here is hidden.' : 'No categories of this kind.'}</p>`;
    document.getElementById('count').textContent = countText();
    document.getElementById('sortstate').textContent = isCustom(kind) ? 'Custom order' : 'Provider order';
    for (const row of box.querySelectorAll('.cat')) {
      const n = row.dataset.n;
      const sw = row.querySelector('.sw');
      sw.onchange = () => {
        sw.checked ? hidden[kind].delete(n) : hidden[kind].add(n); row.classList.toggle('off', !sw.checked); saveLater('hidden'); drawTabs(); drawSeg();
        document.getElementById('count').textContent = countText();
        // in the Shown / Hidden views the row leaves the list (after a short beat so the switch is seen)
        if (show !== 'all') { row.classList.add('leaving'); setTimeout(drawList, 350); }
      };
      for (const b of row.querySelectorAll('.mv')) b.onclick = () => {
        const list = visible(), i = list.indexOf(n), j = i + Number(b.dataset.mv);
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]]; setOrder(mergeVisible(list)); drawList();
        box.querySelector(`.cat[data-n="${CSS.escape(n)}"] .mv[data-mv="${b.dataset.mv}"]`)?.focus();
      };
      const grip = row.querySelector('.grip');
      if (grip) grip.onpointerdown = (e) => startDrag(e, row, box);
    }
  };
  // pointer-based drag (works with mouse and touch)
  const startDrag = (e, row, box) => {
    e.preventDefault();
    row.classList.add('dragging'); box.classList.add('is-dragging');
    const move = (ev) => {
      const y = ev.clientY;
      const rows = [...box.querySelectorAll('.cat:not(.dragging)')];
      const after = rows.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
      after ? box.insertBefore(row, after) : box.append(row);
      // auto-scroll near the window edges
      if (y < 70) window.scrollBy(0, -12); else if (y > innerHeight - 70) window.scrollBy(0, 12);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      row.classList.remove('dragging'); box.classList.remove('is-dragging');
      const names = mergeVisible([...box.querySelectorAll('.cat')].map((r) => r.dataset.n));
      if (names.join('\n') !== ordered(kind).join('\n')) setOrder(names);
      drawList();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  const drawSeg = () => {
    const el = document.getElementById('seg'); if (!el) return;
    const all = ordered(kind), off = all.filter((n) => hidden[kind].has(n)).length;
    const opts = [['all', 'All', all.length], ['on', 'Shown', all.length - off], ['off', 'Hidden', off]];
    el.innerHTML = opts.map(([k, l, n]) => `<button type="button" data-show="${k}" class="${k === show ? 'on' : ''}">${l} <b>${n}</b></button>`).join('');
    for (const b of el.querySelectorAll('button')) b.onclick = () => { show = b.dataset.show; try { localStorage.setItem('lt-cat-filter', show); } catch {} drawList(); };
  };
  const drawTabs = () => { for (const [k] of KINDS) { const el = document.querySelector(`[data-k="${k}"] em`); if (el) el.textContent = hidden[k].size ? `${hidden[k].size} hidden` : ''; } };
  const src = () => !C.categories ? '' : C.source === 'provider' ? `From the provider · ${ago(C.at)}` : `Read from ${esc(String(C.source || '').replace(/^tv:/, ''))} · ${ago(C.at)}`;

  const draw = () => {
    $app.innerHTML = `<a class="back" href="#/playlists">${I.back} Playlists</a>
      <div class="head"><div><h1>${esc(C.name || 'Playlist')}</h1><p class="muted">Switch off categories you don't want and drag them into the order you like. Changes apply to every TV that uses this playlist.</p></div>
        <button class="btn sm" id="reload">${I.refresh}Reload categories</button></div>
      <div class="card sec">
        <div class="tabs cat-tabs">${KINDS.map(([k, l]) => `<button type="button" data-k="${k}" class="${k === kind ? 'on' : ''}">${l} <em></em></button>`).join('')}</div>
        ${C.categories ? `<div class="cat-tools"><input class="in" id="q" placeholder="Search categories" value="${esc(q)}"><button class="btn sm" id="all">Show all</button><button class="btn sm" id="none">Hide all</button></div>
          <div class="cat-tools"><span class="small muted">Show:</span><div class="seg" id="seg"></div></div>
          <div class="cat-tools sort"><span class="small muted">Sort:</span><button class="btn sm ghost" id="az">A → Z</button><button class="btn sm ghost" id="za">Z → A</button><button class="btn sm ghost" id="prov">Provider order</button><span class="small muted" id="sortstate"></span></div>
          <div class="cat-meta"><span id="count" class="small muted"></span><span class="small muted">${src()}</span></div>
          <p class="small muted hint-move">Drag <b>⋮⋮</b> or use ▲ ▼ to move a category.</p>
          <div id="cats" class="cats"></div>`
        : `<div class="empty" id="nocats">${I.list}<h2>Loading categories…</h2><p class="muted" id="nocatsmsg" style="margin-top:6px"></p></div>`}
        <p class="small" id="savestate" style="margin-top:12px;color:var(--ok)"></p>
      </div>`;
    drawTabs();
    for (const b of document.querySelectorAll('[data-k]')) b.onclick = () => { kind = b.dataset.k; draw(); };
    document.getElementById('reload').onclick = () => fetchCats(true);
    if (!C.categories) return;
    const qi = document.getElementById('q');
    qi.oninput = () => { q = qi.value; drawList(); };
    const bulk = (show) => { for (const n of visible()) show ? hidden[kind].delete(n) : hidden[kind].add(n); drawList(); drawTabs(); saveLater('hidden'); };
    document.getElementById('all').onclick = () => bulk(true);
    document.getElementById('none').onclick = () => { if (confirm(q ? `Hide the ${visible().length} matching categories?` : `Hide every ${KINDS.find((k) => k[0] === kind)[1]} category?`)) bulk(false); };
    const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    document.getElementById('az').onclick = () => { setOrder(ordered(kind).sort(coll.compare)); drawList(); };
    document.getElementById('za').onclick = () => { setOrder(ordered(kind).sort(coll.compare).reverse()); drawList(); };
    document.getElementById('prov').onclick = () => { setOrder([]); drawList(); };
    drawList();
  };
  const fetchCats = async (manual) => {
    const btn = document.getElementById('reload'); if (btn) btn.disabled = true;
    try {
      const r = await api(`/api/library/${id}/categories/fetch`, { method: 'POST' });
      C = { ...C, categories: r.categories, source: r.source, at: r.at };
      if (manual) toast('Categories reloaded');
      draw();
    } catch (e) {
      if (btn) btn.disabled = false;
      const m = document.getElementById('nocatsmsg');
      if (m) { m.textContent = e.message; m.previousElementSibling.textContent = 'Categories not loaded yet'; }
      else toast(e.message);
    }
  };
  draw();
  if (!C.categories) fetchCats(false);
}

route();
