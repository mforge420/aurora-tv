import { h } from '../util.js';
import { modal, icon, toast } from '../ui.js';
import { lib } from '../library.js';
import { isNative, nativeApi, onNative } from '../native.js';

let qrP;
const loadQr = () => (window.qrcode ? Promise.resolve(window.qrcode) : (qrP ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = '/vendor/qrcode.js'; s.onload = () => res(window.qrcode); s.onerror = rej; document.head.append(s);
})));

/** Opens the "Add playlist" dialog. Resolves with the new source or null. */
export function addSourceDialog({ tab: startTab } = {}) {
  return new Promise((resolve) => {
    // In the TV app, typing on a phone is the easiest way in
    let tab = startTab || (isNative ? 'phone' : 'xtream'), busy = false, result = null;
    const status = h('div.form-status');
    const field = (label, input, hint) => h('label.field', h('span', label), input, hint && h('small.muted', hint));
    const inp = (name, ph, type = 'text') => h('input', { name, placeholder: ph, type, autocomplete: 'off', spellcheck: false, autocapitalize: 'off', 'data-enter': 'nav' });
    const forms = {
      xtream: h('div.form', field('Name', inp('name', 'My provider')), field('Server URL', inp('server', 'http://provider.example:8080')),
        h('div.row.gap', field('Username', inp('user', 'username')), field('Password', inp('pass', 'password', 'password')))),
      m3u: h('div.form', field('Name', inp('name', 'My playlist')), field('Playlist URL', inp('url', 'https://…/playlist.m3u')),
        field('EPG (XMLTV) URL', inp('epg', 'Optional — auto-detected from the playlist'), 'Supports .xml and .xml.gz')),
      file: h('div.form', field('Name', inp('name', 'Local playlist')),
        h('label.drop', { html: `${icon('upload')}<b>Choose an .m3u file</b><span class="muted">or drop it here</span>` }, h('input', { type: 'file', name: 'file', accept: '.m3u,.m3u8,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl', hidden: true })),
        field('EPG (XMLTV) URL', inp('epg', 'Optional'))),
    };
    // ---- "From phone": QR code to a page served by the TV on the home network
    const phonePanel = h('div.phone-panel');
    if (isNative) forms.phone = phonePanel;
    let offRemote = null;
    async function startPhone() {
      let info;
      try { info = JSON.parse(nativeApi.remoteStart()); } catch { info = { error: 'Not available' }; }
      if (info.error) { phonePanel.replaceChildren(h('p.form-status.error', info.error)); return; }
      const link = `${info.url}?pin=${info.pin}`;
      const qrBox = h('div.qr');
      phonePanel.replaceChildren(
        h('div.phone-grid', qrBox,
          h('div.phone-steps',
            h('h3', 'Use your phone'),
            h('ol', h('li', 'Connect your phone to the same Wi-Fi as this TV'), h('li', 'Scan the code with your camera'), h('li', 'Enter your playlist details and tap ', h('b', 'Send to TV'))),
            h('p.muted.small', 'Or open ', h('b.mono', info.url), ' and enter code'),
            h('div.phone-pin', info.pin))));
      try {
        const qr = (await loadQr())(0, 'M');
        qr.addData(link); qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      } catch { qrBox.textContent = info.url; }
      offRemote?.();
      offRemote = onNative((type, data) => {
        if (type !== 'remote-add') return;
        let d; try { d = JSON.parse(data); } catch { return; }
        const def = d.type === 'xtream'
          ? { type: 'xtream', name: d.name || hostOf(d.server), server: d.server, user: d.user, pass: d.pass || '' }
          : { type: 'm3u', name: d.name || hostOf(d.url), url: d.url, epgUrl: d.epgUrl || '' };
        addDef(def, (msg) => nativeApi.remoteResult(JSON.stringify(msg)));
      });
    }
    const stopPhone = () => { offRemote?.(); offRemote = null; if (isNative) try { nativeApi.remoteStop(); } catch {} };

    const fileInput = forms.file.querySelector('input[type=file]');
    const drop = forms.file.querySelector('.drop');
    fileInput.onchange = () => { if (fileInput.files[0]) drop.querySelector('b').textContent = fileInput.files[0].name; };
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); fileInput.files = e.dataTransfer.files; fileInput.onchange(); });

    const tabs = h('div.tabs', [...(isNative ? [['phone', 'From phone', 'link']] : []), ['xtream', 'Xtream Codes', 'server'], ['m3u', 'M3U URL', 'link'], ['file', 'File', 'upload']].map(([k, l, ic]) =>
      h('button.tab' + (k === tab ? '.active' : ''), { dataset: { tab: k }, onclick: () => setTab(k), html: icon(ic) + `<span>${l}</span>` })));
    const body = h('div.form-body', forms[tab]);
    function setTab(k) {
      tab = k; body.replaceChildren(forms[k]);
      tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === k));
      submit.hidden = k === 'phone';
      status.textContent = ''; status.className = 'form-status';
      if (k === 'phone') startPhone(); else stopPhone();
    }
    const val = (n) => forms[tab].querySelector(`[name=${n}]`)?.value.trim() || '';
    const submit = h('button.btn.primary.wide', { onclick: save, html: `${icon('plus')}<span>Add playlist</span>` });

    async function save() {
      if (busy) return;
      let def;
      try {
        if (tab === 'xtream') {
          if (!val('server') || !val('user')) throw new Error('Server and username are required');
          def = { type: 'xtream', name: val('name') || hostOf(val('server')), server: val('server'), user: val('user'), pass: val('pass') };
        } else if (tab === 'm3u') {
          if (!/^https?:\/\//i.test(val('url'))) throw new Error('Enter a valid http(s) playlist URL');
          def = { type: 'm3u', name: val('name') || hostOf(val('url')), url: val('url'), epgUrl: val('epg') };
        } else {
          const f = fileInput.files[0];
          if (!f) throw new Error('Choose a playlist file');
          def = { type: 'm3u', name: val('name') || f.name.replace(/\.\w+$/, ''), content: await f.text(), epgUrl: val('epg'), local: true };
        }
      } catch (e) { status.className = 'form-status error'; status.textContent = e.message; return; }
      addDef(def);
    }

    /** Loads a playlist definition; `report` mirrors progress to the phone */
    async function addDef(def, report = () => {}) {
      if (busy) { report({ state: 'error', message: 'The TV is already adding a playlist' }); return; }
      busy = true; submit.disabled = true;
      status.className = 'form-status busy';
      try {
        result = await lib.addSource(def, (s) => { status.innerHTML = `<div class="spinner sm"></div><span>${s}…</span>`; report({ state: 'adding', message: s }); });
        const c = result.counts;
        const summary = `${c.live.toLocaleString()} channels, ${c.movies.toLocaleString()} movies, ${c.series.toLocaleString()} series`;
        report({ state: 'done', message: `Added “${result.name}”: ${summary}` });
        toast(`Added “${result.name}” · ${summary}`, { icon: 'check', type: 'ok', ms: 5000 });
        setTimeout(() => m.close(), 400);
      } catch (e) {
        const msg = e.message || 'Failed to load playlist';
        report({ state: 'error', message: msg });
        status.className = 'form-status error'; status.textContent = msg;
      } finally { busy = false; submit.disabled = false; }
    }

    const m = modal([
      h('div.modal-head', h('h2', 'Add a playlist'), h('p.muted', 'Your credentials stay on this device.')),
      tabs, body, status, submit,
    ], { className: 'add-source', onClose: () => { setTimeout(stopPhone, 2500); resolve(result); } });
    setTab(tab);
  });
}
const hostOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'http://' + u).hostname; } catch { return 'Playlist'; } };
