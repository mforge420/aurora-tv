import { h, esc, store } from '../util.js';
import { lib } from '../library.js';
import { settings } from '../settings.js';
import { icon, toast, confirmDialog, choose, pinDialog, modal } from '../ui.js';
import { addSourceDialog } from './addsource.js';
import { nav } from '../nav.js';
import { isNative, nativeApi } from '../native.js';

const SECTIONS = [
  ['playlists', 'Playlists', 'list'], ['appearance', 'Appearance', 'sparkle'], ['player', 'Playback', 'play'],
  ['guide', 'TV Guide', 'guide'], ['groups', 'Groups & parental', 'lock'], ['backup', 'Backup', 'upload'], ['about', 'About', 'info'],
];
const ACCENTS = [['aurora', 'Aurora'], ['ocean', 'Ocean'], ['emerald', 'Emerald'], ['sunset', 'Sunset'], ['rose', 'Rose'], ['mono', 'Mono']];

export default function settingsView(root, { go }) {
  let sec = 'playlists';
  const side = h('nav.set-nav', { 'data-navgroup': '' });
  const content = h('div.set-content', { 'data-navgroup': '' });
  root.append(h('div.settings-layout', h('div.set-side', h('h1', 'Settings'), side), content));

  function drawNav() {
    side.replaceChildren(...SECTIONS.map(([k, l, ic]) => h('button.set-tab' + (k === sec ? '.active' : ''), { onclick: () => { sec = k; draw(); nav.focusFirst(content); }, onfocus: () => { if (sec !== k) { sec = k; draw(); } }, html: icon(ic) + `<span>${l}</span>` })));
  }
  function draw() {
    drawNav();
    content.replaceChildren(...(SECTION_RENDER[sec]?.() || []));
  }

  // ---------- helpers ----------
  const row = (title, desc, control) => h('div.set-row', h('div.set-text', h('b', title), desc && h('small.muted', desc)), control);
  const toggle = (k, onChange) => {
    const b = h('button.switch' + (settings.get(k) ? '.on' : ''), { role: 'switch', 'aria-checked': String(!!settings.get(k)), onclick: () => { settings.set(k, !settings.get(k)); b.classList.toggle('on', settings.get(k)); b.setAttribute('aria-checked', String(settings.get(k))); onChange?.(); } }, h('i'));
    return b;
  };
  const select = (k, options, onChange) => {
    const label = () => options.find((o) => o[0] === settings.get(k))?.[1] ?? settings.get(k);
    const b = h('button.select', { onclick: async () => { const c = await choose('', options.map(([id, l]) => ({ id, label: l, active: id === settings.get(k) }))); if (c) { settings.set(k, c.id); b.firstChild.textContent = label(); onChange?.(); } } }, h('span', label()), h('span', { html: icon('fwd') }));
    return b;
  };
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

  const SECTION_RENDER = {
    playlists: () => [
      h('div.sec-head', h('h2', 'Playlists'), h('button.btn.primary', { onclick: async () => { if (await addSourceDialog()) draw(); }, html: icon('plus') + '<span>Add playlist</span>' })),
      ...(lib.sources.length ? lib.sources.map((s) => {
        const c = s.counts || { live: 0, movies: 0, series: 0 };
        const exp = s.account?.exp ? new Date(s.account.exp).toLocaleDateString() : null;
        return h('div.source-card',
          h('div.src-icon', { html: icon(s.type === 'xtream' ? 'server' : s.local ? 'upload' : 'link') }),
          h('div.src-main',
            h('b', s.name), h('small.muted', s.type === 'xtream' ? `Xtream · ${s.server}` : s.local ? 'Local file' : s.url),
            h('div.src-stats', h('span', `${c.live.toLocaleString()} channels`), h('span', `${c.movies.toLocaleString()} movies`), h('span', `${c.series.toLocaleString()} series`),
              h('span', `Updated ${ago(s.updated)}`), exp && h('span', `Expires ${exp}`)),
            h('div.src-stats', h('span', s.epgUrl ? `Guide: ${s.epgCount ? s.epgCount.toLocaleString() + ' channels · ' : ''}${ago(s.epgUpdated)}` : 'No guide URL'), s.epgError && h('span.err', 'Guide error: ' + s.epgError))),
          h('div.src-actions',
            !s.local && h('button.icon-btn', { title: 'Refresh playlist', onclick: async (e) => { const b = e.currentTarget; b.classList.add('spin'); try { await lib.refreshSource(s); lib.rebuild(); toast('Playlist refreshed', { type: 'ok', icon: 'check' }); } catch (er) { toast(er.message, { type: 'error' }); } b.classList.remove('spin'); draw(); }, html: icon('refresh') }),
            h('button.icon-btn', { title: 'Edit guide URL', onclick: () => editEpg(s), html: icon('guide') }),
            h('button.icon-btn.danger', { title: 'Remove', onclick: async () => { if (await confirmDialog('Remove playlist?', `“${s.name}” and its guide data will be removed from this device.`, { ok: 'Remove', danger: true })) { await lib.removeSource(s.id); draw(); } }, html: icon('trash') })));
      }) : [h('div.empty-state', { html: `${icon('list')}<span>No playlists yet</span>` })]),
      row('Refresh everything', 'Reload all playlists and guide data now', h('button.btn.ghost', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; b.lastChild.textContent = 'Refreshing…'; await lib.refreshAll(); b.disabled = false; draw(); toast('All sources refreshed', { type: 'ok', icon: 'check' }); }, html: icon('refresh') + '<span>Refresh</span>' })),
      row('Auto-refresh playlists', null, select('playlistAutoRefreshHours', [[0, 'Never'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Daily'], [72, 'Every 3 days']])),
    ],
    appearance: () => [
      h('h2', 'Appearance'),
      row('Accent', 'Colour used for focus and highlights', h('div.swatches', ACCENTS.map(([k, l]) => h('button.swatch' + (settings.get('accent') === k ? '.on' : ''), { title: l, dataset: { accent: k }, onclick: () => { settings.set('accent', k); draw(); } })))),
      row('24-hour clock', null, toggle('clock24')),
      row('Show channel numbers', null, toggle('showChannelNumbers')),
    ],
    player: () => [
      h('h2', 'Playback'),
      row('Preview on focus', 'Play channels in the preview window while browsing', toggle('previewAutoplay')),
      row('Mute previews', null, toggle('previewMuted')),
      row('Resume last channel on start', null, toggle('startOnLastChannel')),
      row('Auto-play next episode', null, toggle('autoplayNextEpisode')),
      row('Xtream live format', 'HLS works everywhere; MPEG-TS often starts faster', select('xtreamFormat', [['m3u8', 'HLS (.m3u8)'], ['ts', 'MPEG-TS (.ts)']], () => lib.rebuild())),
      row('Low-latency mode', 'Stay closer to the live edge (may rebuffer more)', toggle('lowLatency')),
      row('Buffer size', null, select('bufferSeconds', [[10, '10 seconds'], [30, '30 seconds'], [60, '60 seconds'], [120, '2 minutes']])),
      row('Network proxy', 'Routes requests through the Aurora server to bypass CORS and set custom User-Agents', select('proxyMode', [['auto', 'Automatic'], ['always', 'Always'], ['never', 'Never']])),
      row('User-Agent', 'Some providers require a specific player identity', (() => { const i = h('input.text', { value: settings.get('userAgent'), placeholder: 'Default', 'data-enter': 'nav', onchange: () => settings.set('userAgent', i.value.trim()) }); return i; })()),
    ],
    guide: () => [
      h('h2', 'TV Guide'),
      row('Update guide now', lib.epgLoading ? 'Updating…' : `${Object.keys(lib.epg.progs).length.toLocaleString()} channels with programme data · ${lib.epgIndex.size.toLocaleString()} matched`, h('button.btn.ghost', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; await lib.refreshEpg(true, (p) => { b.lastChild.textContent = `${(p.loaded / 1048576).toFixed(1)} MB · ${p.count.toLocaleString()}`; }); draw(); toast('Guide updated', { type: 'ok', icon: 'check' }); }, html: icon('refresh') + '<span>Update</span>' })),
      row('Auto-update guide', null, select('epgAutoRefreshHours', [[6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Daily']])),
      row('Time shift', 'Correct providers whose guide is off by some hours', select('epgTimeShift', [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((n) => [n, (n > 0 ? '+' : '') + n + ' h']), () => lib.emit('epg'))),
      row('Visible hours', 'How much time the guide grid shows at once', select('guideHours', [[1.5, '1.5 hours'], [2, '2 hours'], [2.5, '2.5 hours'], [3, '3 hours'], [4, '4 hours']])),
    ],
    groups: () => {
      const hidden = new Set(settings.get('hiddenGroups'));
      const locked = new Set(settings.get('lockedGroups'));
      const pin = settings.get('parentalPin');
      const groups = lib.allLiveGroups || [];
      return [
        h('h2', 'Groups & parental control'),
        row('Parental PIN', pin ? 'PIN is set — locked groups require it' : 'Set a 4-digit PIN to lock groups', h('button.btn.ghost', { onclick: async () => {
          if (pin) { const p = await pinDialog('Current PIN'); if (p !== pin) return p && toast('Wrong PIN', { type: 'error' }); settings.set('parentalPin', ''); toast('PIN removed'); }
          else { const p = await pinDialog('New PIN'); if (!p) return; const p2 = await pinDialog('Confirm PIN'); if (p !== p2) return toast('PINs did not match', { type: 'error' }); settings.set('parentalPin', p); toast('PIN set', { type: 'ok', icon: 'lock' }); }
          draw();
        }, html: icon('lock') + `<span>${pin ? 'Remove PIN' : 'Set PIN'}</span>` })),
        h('p.muted.small', `${groups.length} live groups · ${hidden.size} hidden${pin ? ` · ${locked.size} locked` : ''}`),
        h('div.group-table', groups.map((g) => h('div.group-row',
          h('span.gname', g),
          h('button.icon-btn' + (hidden.has(g) ? '.off' : ''), { title: hidden.has(g) ? 'Show' : 'Hide', onclick: () => { hidden.has(g) ? hidden.delete(g) : hidden.add(g); settings.set('hiddenGroups', [...hidden]); lib.rebuild(); const f = document.activeElement; draw(); refocus(f); }, html: icon(hidden.has(g) ? 'eyeoff' : 'eye') }),
          pin && h('button.icon-btn' + (locked.has(g) ? '.on' : ''), { title: locked.has(g) ? 'Unlock' : 'Lock', onclick: async () => { if (locked.has(g)) { const p = await pinDialog(); if (p !== pin) return; locked.delete(g); } else locked.add(g); settings.set('lockedGroups', [...locked]); draw(); }, html: icon('lock') }))))];
    },
    backup: () => [
      h('h2', 'Backup & restore'),
      h('p.muted', 'Export your playlists, favourites and settings to move them to another device.'),
      row('Export', 'Download a backup file (contains your provider credentials)', h('button.btn.ghost', { onclick: exportBackup, html: icon('upload') + '<span>Export</span>' })),
      row('Import', 'Restore from a backup file', h('label.btn.ghost', { html: icon('refresh') + '<span>Import</span>' }, h('input', { type: 'file', accept: '.json', hidden: true, onchange: (e) => importBackup(e.target.files[0]) }))),
      row('Reset app', 'Remove all playlists and settings from this device', h('button.btn.danger', { onclick: async () => { if (await confirmDialog('Reset Aurora TV?', 'Everything stored on this device will be erased.', { ok: 'Erase', danger: true })) { localStorage.clear(); indexedDB.deleteDatabase('aurora-tv'); location.reload(); } }, html: icon('trash') + '<span>Reset</span>' })),
    ],
    about: () => [
      h('div.about', h('img', { src: '/icons/icon.svg', alt: '' }), h('h2', 'Aurora TV'), h('p.muted', 'A fast, remote-friendly IPTV player for M3U and Xtream Codes playlists with XMLTV guide, catch-up and multi-view.'),
        h('div.kbd-help', h('h3', 'Shortcuts'),
          ...[['▲ ▼ / PgUp PgDn', 'Change channel (fullscreen)'], ['◀', 'Channel list (fullscreen)'], ['▶ / Menu', 'Player options'], ['0–9', 'Jump to channel number'], ['G', 'TV guide'], ['/', 'Search'], ['M', 'Mute'], ['F', 'Fullscreen window'], ['I', 'Info'], ['Esc / Back', 'Back']].map(([k, d]) => h('div', h('kbd', k), h('span', d)))),
        h('p.muted.small', 'Aurora TV does not provide any content. Only use playlists you are entitled to.')),
    ],
  };
  const refocus = (f) => requestAnimationFrame(() => { if (!f?.isConnected) nav.focusFirst(content); });

  function editEpg(s) {
    const i = h('input.text', { value: s.epgUrl || '', placeholder: 'https://…/epg.xml.gz', 'data-enter': 'nav' });
    const m = modal([h('h2', 'Guide (XMLTV) URL'), h('p.muted', s.name), i, h('div.row.end', h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => { s.epgUrl = i.value.trim(); s.epgUpdated = 0; lib.saveSources(); m.close(); toast('Updating guide…', { icon: 'guide' }); await lib.refreshEpg(true); draw(); } }, 'Save'))], { className: 'small' });
  }
  function exportBackup() {
    const data = { app: 'aurora-tv', v: 1, at: Date.now(), settings: settings.all(), sources: lib.sources.map(({ _cat, ...s }) => s), favs: [...lib.favs], recents: lib.recents, resume: lib.resume };
    const fname = `aurora-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (isNative) { const where = nativeApi.saveFile(fname, JSON.stringify(data, null, 1)); toast(where ? 'Saved to ' + where : 'Could not save backup', { type: where ? 'ok' : 'error' }); return; }
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: fname });
    document.body.append(a); a.click(); a.remove();
  }
  async function importBackup(f) {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'aurora-tv') throw new Error('Not an Aurora TV backup');
      settings.replace(d.settings || {});
      store.set('favs', d.favs || []); store.set('recents', d.recents || []); store.set('resume', d.resume || {});
      store.set('sources', (d.sources || []).map((s) => ({ ...s, updated: 0, epgUpdated: 0 })));
      toast('Backup restored — reloading…', { type: 'ok' });
      setTimeout(() => location.reload(), 900);
    } catch (e) { toast(e.message, { type: 'error' }); }
  }

  draw();
  const off = lib.on('change', () => { if (sec === 'playlists') draw(); });
  return { focus: () => nav.focus(side.querySelector('.active')), destroy: off, back: () => { if (content.contains(document.activeElement)) { side.querySelector('.active')?.focus(); return true; } return false; } };
}
