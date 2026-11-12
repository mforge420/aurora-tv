// Streaming XMLTV parser running in a Web Worker.
// Input: { url, fetchUrl, window: {from, to}, wanted: [ids] | null }
// Output: { channels: {id:{n,i}}, progs: {id: [start, stop, title, desc, category, episode, ...flat]} }

function parseTime(s) {
  // 20240101123000 +0100
  if (!s) return 0;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}):?(\d{2})?/.exec(s.trim());
  if (!m) return 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    t -= sign * (Math.abs(+m[7]) * 60 + +(m[8] || 0)) * 60000;
  }
  return t;
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}
const attr = (tag, name) => {
  const i = tag.indexOf(name + '="');
  if (i === -1) {
    const j = tag.indexOf(name + "='");
    if (j === -1) return '';
    const s = j + name.length + 2;
    return tag.slice(s, tag.indexOf("'", s));
  }
  const s = i + name.length + 2;
  return tag.slice(s, tag.indexOf('"', s));
};
const inner = (block, tag) => {
  const i = block.indexOf('<' + tag);
  if (i === -1) return '';
  const gt = block.indexOf('>', i);
  if (block[gt - 1] === '/') return '';
  const end = block.indexOf('</' + tag + '>', gt);
  if (end === -1) return '';
  let v = block.slice(gt + 1, end);
  if (v.startsWith('<![CDATA[')) v = v.slice(9, -3);
  return decode(v.trim());
};

self.onmessage = async (ev) => {
  const { fetchUrl, from, to, uaHeader } = ev.data;
  try {
    let stream = ev.data.stream, total = ev.data.total || 0;
    if (!stream) {
      const res = await fetch(fetchUrl, { headers: uaHeader ? { 'x-aurora-ua': uaHeader } : {} });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      total = Number(res.headers.get('content-length')) || 0;
      stream = res.body;
    }
    const reader0 = stream.getReader();
    const first = await reader0.read();
    const gz = first.value && first.value[0] === 0x1f && first.value[1] === 0x8b;
    let loaded = 0;
    stream = new ReadableStream({
      start(c) { if (first.done) c.close(); else { loaded += first.value.length; c.enqueue(first.value); } },
      async pull(c) { const x = await reader0.read(); if (x.done) c.close(); else { loaded += x.value.length; c.enqueue(x.value); } },
    });
    if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();

    const channels = {}, progs = {};
    let buf = '', count = 0, lastPost = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += value;
      // process complete elements
      let idx = 0;
      for (;;) {
        const lt = buf.indexOf('<', idx);
        if (lt === -1) { idx = buf.length; break; }
        if (buf.startsWith('<programme', lt)) {
          const end = buf.indexOf('</programme>', lt);
          if (end === -1) { idx = lt; break; }
          const block = buf.slice(lt, end);
          const tagEnd = block.indexOf('>');
          const tag = block.slice(0, tagEnd);
          const start = parseTime(attr(tag, 'start')), stop = parseTime(attr(tag, 'stop'));
          if (stop > from && start < to) {
            const ch = decode(attr(tag, 'channel'));
            const arr = progs[ch] || (progs[ch] = []);
            let ep = inner(block, 'episode-num');
            if (ep && /\d+\s*\.\s*\d+/.test(ep)) {
              const p = ep.split('.'); const s = parseInt(p[0], 10), e = parseInt(p[1], 10);
              ep = (isNaN(s) ? '' : 'S' + (s + 1)) + (isNaN(e) ? '' : 'E' + (e + 1));
            }
            arr.push(start, stop || start + 3600e3, inner(block, 'title'), inner(block, 'desc').slice(0, 600), inner(block, 'category'), ep || inner(block, 'sub-title'));
            count++;
          }
          idx = end + 12;
        } else if (buf.startsWith('<channel', lt) && (buf[lt + 8] === ' ' || buf[lt + 8] === '>')) {
          const end = buf.indexOf('</channel>', lt);
          if (end === -1) { idx = lt; break; }
          const block = buf.slice(lt, end);
          const id = decode(attr(block.slice(0, block.indexOf('>')), 'id'));
          const icon = block.indexOf('<icon');
          channels[id] = { n: inner(block, 'display-name'), i: icon > -1 ? decode(attr(block.slice(icon, block.indexOf('>', icon)), 'src')) : '' };
          idx = end + 10;
        } else {
          const gt = buf.indexOf('>', lt);
          if (gt === -1) { idx = lt; break; }
          idx = gt + 1;
        }
      }
      buf = buf.slice(idx);
      const now = performance.now();
      if (now - lastPost > 250) { lastPost = now; self.postMessage({ type: 'progress', loaded, total, count }); }
      if (done) break;
    }
    // sort each channel's programmes by start time
    for (const k in progs) {
      const a = progs[k];
      const rows = [];
      for (let i = 0; i < a.length; i += 6) rows.push(a.slice(i, i + 6));
      rows.sort((x, y) => x[0] - y[0]);
      // drop overlaps/duplicates
      const flat = [];
      let lastStart = -1;
      for (const r of rows) { if (r[0] === lastStart) continue; lastStart = r[0]; flat.push(...r); }
      progs[k] = flat;
    }
    self.postMessage({ type: 'done', channels, progs, count });
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message || String(e) });
  }
};
