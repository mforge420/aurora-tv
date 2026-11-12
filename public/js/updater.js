// In-app updates for the Android build: compares against version.json on GitHub.
import { h, store, esc } from './util.js';
import { isNative, nativeApi, onNative } from './native.js';
import { fetchJSON } from './net.js';
import { modal, icon, toast } from './ui.js';

export const UPDATE_URL = 'https://github.com/mforge420/aurora-tv/raw/main/android/version.json';

export function currentVersion() {
  try { return JSON.parse(nativeApi.appVersion()); } catch { return { code: 0, name: '?' }; }
}

export async function checkForUpdate() {
  const cur = currentVersion();
  const latest = await fetchJSON(`${UPDATE_URL}?t=${Date.now()}`);
  return { cur, latest, available: Number(latest.versionCode) > Number(cur.code) };
}

/** Quiet check at startup, at most every 6 hours */
export async function autoCheck() {
  if (!isNative) return;
  const last = store.get('updateCheck', 0);
  if (Date.now() - last < 6 * 3600e3) return;
  try {
    const r = await checkForUpdate();
    store.set('updateCheck', Date.now());
    if (r.available && store.get('skipVersion') !== r.latest.versionCode) showUpdateDialog(r);
  } catch { /* offline etc. — try again next start */ }
}

/** Manual check from Settings */
export async function manualCheck() {
  try {
    const r = await checkForUpdate();
    store.set('updateCheck', Date.now());
    if (r.available) showUpdateDialog(r);
    else toast(`You're up to date (v${r.cur.name})`, { type: 'ok', icon: 'check' });
  } catch (e) { toast('Could not check for updates: ' + e.message, { type: 'error' }); }
}

export function showUpdateDialog({ cur, latest }) {
  const status = h('div.upd-status');
  const bar = h('div.bar.upd-bar', { hidden: true }, h('i', { style: { width: '0%' } }));
  const installBtn = h('button.btn.primary', { 'data-autofocus': true, onclick: install, html: icon('upload') + '<span>Install update</span>' });
  const laterBtn = h('button.btn.ghost', { onclick: () => m.close() }, 'Later');
  const skipBtn = h('button.btn.ghost', { onclick: () => { store.set('skipVersion', latest.versionCode); m.close(); } }, 'Skip this version');
  const notes = (latest.notes || []).map((n) => h('li', n));
  let off = null;
  const m = modal([
    h('div.upd-head', h('span.upd-icon', { html: icon('sparkle') }), h('div', h('h2', 'Update available'), h('p.muted', `Version ${esc(latest.versionName)} · you have ${esc(cur.name)}`))),
    notes.length ? h('ul.upd-notes', notes) : null,
    bar, status,
    h('div.row.end', skipBtn, laterBtn, installBtn),
  ], { className: 'small update', onClose: () => off?.() });

  function install() {
    if (!nativeApi.canInstall()) {
      status.className = 'upd-status warn';
      status.textContent = 'Allow “Install unknown apps” for Lumora TV on the screen that just opened, then come back and press Install update again.';
      nativeApi.openInstallPermission();
      return;
    }
    installBtn.disabled = true; skipBtn.hidden = true;
    bar.hidden = false;
    status.className = 'upd-status';
    status.textContent = 'Downloading…';
    off?.();
    off = onNative((type, data) => {
      if (type !== 'update') return;
      const d = JSON.parse(data);
      if (d.state === 'downloading') {
        bar.firstChild.style.width = Math.max(0, d.pct) + '%';
        status.textContent = d.pct >= 0 ? `Downloading… ${d.pct}%` : 'Downloading…';
      } else if (d.state === 'installing') {
        bar.firstChild.style.width = '100%';
        status.textContent = 'Confirm the install on the screen that opened. Lumora TV restarts with the new version and keeps your playlists.';
        installBtn.disabled = false; installBtn.lastChild.textContent = 'Open installer again';
      } else if (d.state === 'error') {
        status.className = 'upd-status error';
        status.textContent = d.message;
        installBtn.disabled = false;
      }
    });
    nativeApi.installUpdate(latest.url);
  }
}
