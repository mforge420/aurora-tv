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
  const h = location.hash || '#/';
  let state;
  try { state = await api('/api/auth/state'); } catch { $app.innerHTML = '<div class="center"><p class="muted">Can\'t reach the server.</p></div>'; return; }
  nav(state.loggedIn);
  if (state.setup) return setupView();
  if (!state.loggedIn) return loginView();
  const m = h.match(/^#\/device\/([\w-]+)/);
  if (m) return deviceView(m[1]);
  return devicesView();
}
window.addEventListener('hashchange', route);
function nav(loggedIn) {
  document.getElementById('topnav').innerHTML = loggedIn ? '<button class="btn ghost sm" id="logout">Sign out</button>' : '';
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
        <section class="card sec"><div class="head" style="margin-bottom:6px"><h2>Playlists</h2><button class="btn sm primary" id="addpl">${I.plus}Add playlist</button></div>
          ${x.playlists.length ? x.playlists.map((p) => plRow(p, rep.get(p.id))).join('') : '<p class="muted" style="padding:14px 0">No playlists managed from here yet.</p>'}
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
    document.getElementById('addpl').onclick = () => playlistDialog(id);
    for (const b of document.querySelectorAll('[data-edit]')) b.onclick = () => playlistDialog(id, x.playlists.find((p) => p.id === b.dataset.edit));
    for (const b of document.querySelectorAll('[data-del]')) b.onclick = async () => {
      const p = x.playlists.find((v) => v.id === b.dataset.del);
      if (!confirm(`Remove “${p.name || 'this playlist'}” from ${x.name}?`)) return;
      await api('/api/playlists/' + p.id, { method: 'DELETE' }); toast('Removed — the TV updates in a few seconds'); draw(await load());
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
function plRow(p, r) {
  const where = p.type === 'xtream' ? `${esc(p.server)} · ${esc(p.user)}` : esc(p.url);
  const stats = r && !r.error && r.counts ? `<span class="pill">${fmt(r.counts.live)} channels</span><span class="pill">${fmt(r.counts.movies)} movies</span><span class="pill">${fmt(r.counts.series)} series</span>` : '';
  const state = !r ? '<span class="pill">Waiting for the TV</span>' : r.error ? `<span class="pill bad">${esc(r.error)}</span>` : '<span class="pill ok">Loaded</span>';
  const exp = r?.expires ? `<span class="pill">Expires ${new Date(r.expires).toLocaleDateString()}</span>` : '';
  return `<div class="pl"><div class="pl-main"><b>${esc(p.name || (p.type === 'xtream' ? p.server : 'Playlist'))}</b><div class="small muted">${p.type === 'xtream' ? 'Xtream Codes' : 'M3U'} · ${where}</div>
    <div class="pl-stats">${state}${stats}${exp}${r?.epgError ? `<span class="pill bad">Guide: ${esc(r.epgError)}</span>` : ''}</div></div>
    <button class="btn sm" data-edit="${esc(p.id)}">Edit</button><button class="btn sm ghost" data-del="${esc(p.id)}" aria-label="Remove">✕</button></div>`;
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
function playlistDialog(deviceId, p) {
  let type = p?.type || 'xtream';
  const d = dialog(`<form id="f"><h2>${p ? 'Edit playlist' : 'Add playlist'}</h2>
    <div class="tabs"><button type="button" data-t="xtream">Xtream Codes</button><button type="button" data-t="m3u">M3U link</button></div>
    <label class="f"><span>Name</span><input class="in" name="name" value="${esc(p?.name)}" placeholder="My provider"></label>
    <div data-for="xtream"><label class="f"><span>Server URL</span><input class="in" name="server" value="${esc(p?.server)}" placeholder="http://provider.example:8080" autocapitalize="off" spellcheck="false"></label>
      <div class="row"><label class="f"><span>Username</span><input class="in" name="user" value="${esc(p?.user)}" autocapitalize="off" spellcheck="false"></label>
      <label class="f"><span>Password</span><div class="pw"><input class="in" name="pass" type="password" value="${esc(p?.pass)}" autocapitalize="off"><button type="button" id="show">Show</button></div></label></div></div>
    <div data-for="m3u"><label class="f"><span>Playlist URL</span><input class="in" name="url" value="${esc(p?.url)}" placeholder="https://…/playlist.m3u" autocapitalize="off" spellcheck="false"></label></div>
    <label class="f"><span>TV guide (XMLTV) URL <span class="muted">— optional</span></span><input class="in" name="epgUrl" value="${esc(p?.epgUrl)}" placeholder="Detected automatically" autocapitalize="off" spellcheck="false"></label>
    <div class="err" id="e"></div><div class="row end"><button type="button" class="btn ghost" id="cancel">Cancel</button><button class="btn primary">${p ? 'Save' : 'Add'}</button></div></form>`);
  const f = d.querySelector('form');
  const setType = (t) => { type = t; d.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); d.querySelectorAll('[data-for]').forEach((x) => (x.hidden = x.dataset.for !== t)); };
  d.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => setType(b.dataset.t)));
  setType(type);
  d.querySelector('#show').onclick = (ev) => { const i = f.pass; i.type = i.type === 'password' ? 'text' : 'password'; ev.target.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
  d.querySelector('#cancel').onclick = () => d.close();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const b = { type, name: f.name.value, server: f.server.value, user: f.user.value, pass: f.pass.value, url: f.url.value, epgUrl: f.epgUrl.value };
    try {
      if (p) await api('/api/playlists/' + p.id, { method: 'PUT', body: b });
      else await api(`/api/devices/${deviceId}/playlists`, { method: 'POST', body: b });
      d.close(); toast(p ? 'Saved — the TV updates in a few seconds' : 'Added — the TV loads it in a few seconds');
      route();
    } catch (e) { d.querySelector('#e').textContent = e.message; }
  };
}

route();
