import { hashStr } from './util.js';

const ATTR_RE = /([\w-]+)="([^"]*)"/g;

function classify(url, group) {
  const u = url.toLowerCase();
  if (/\/movie\//.test(u)) return 'movie';
  if (/\/series\//.test(u)) return 'series';
  if (/\.(mp4|mkv|avi|mov|m4v|webm)(\?|$)/.test(u) && !/live/i.test(group)) return 'movie';
  return 'live';
}

/**
 * Parse an M3U / M3U8 (extended) playlist.
 * Returns { epgUrl, live: [], movies: [], episodes: [] }
 */
export function parseM3U(text, sourceId) {
  const out = { epgUrl: '', live: [], movies: [], episodes: [] };
  let pos = 0, n = text.length, cur = null, grp = '', opts = {};
  let liveNum = 0;
  const seen = new Map();
  while (pos < n) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = n;
    let line = text.slice(pos, end).trim();
    pos = end + 1;
    if (!line) continue;
    if (line.charCodeAt(0) === 35 /* # */) {
      if (line.startsWith('#EXTINF')) {
        const comma = findTitleComma(line);
        const head = line.slice(0, comma), title = line.slice(comma + 1).trim();
        const a = {};
        for (const m of head.matchAll(ATTR_RE)) a[m[1].toLowerCase()] = m[2];
        cur = { a, title };
      } else if (line.startsWith('#EXTM3U')) {
        const m = line.match(/(?:url-tvg|x-tvg-url|tvg-url)="([^"]+)"/i);
        if (m) out.epgUrl = m[1].split(',')[0].trim();
      } else if (line.startsWith('#EXTGRP:')) {
        grp = line.slice(8).trim();
      } else if (line.startsWith('#EXTVLCOPT:')) {
        const [k, ...v] = line.slice(11).split('=');
        if (/user-agent/i.test(k)) opts.ua = v.join('=');
        if (/referr?er/i.test(k)) opts.ref = v.join('=');
      } else if (line.startsWith('#KODIPROP:')) {
        const m = line.match(/stream_headers=(.*)/i);
        if (m) for (const kv of m[1].split('&')) {
          const [k, v] = kv.split('=');
          if (/user-agent/i.test(k)) opts.ua = decodeURIComponent(v || '');
          if (/referr?er/i.test(k)) opts.ref = decodeURIComponent(v || '');
        }
      }
      continue;
    }
    // URL line
    if (!cur) cur = { a: {}, title: line.split('/').pop() };
    const a = cur.a;
    const group = a['group-title'] || grp || 'Uncategorized';
    const name = a['tvg-name'] && !cur.title ? a['tvg-name'] : (cur.title || a['tvg-name'] || 'Channel');
    const kind = classify(line, group);
    let id = sourceId + ':' + hashStr(line + '|' + name);
    if (seen.has(id)) id += ':' + seen.get(id);
    seen.set(id, (seen.get(id) || 0) + 1);
    const item = {
      id, src: sourceId, name, url: line, group,
      logo: a['tvg-logo'] || a['logo'] || '',
    };
    if (opts.ua || a['user-agent'] || a['http-user-agent']) item.ua = opts.ua || a['user-agent'] || a['http-user-agent'];
    if (opts.ref || a['http-referrer']) item.ref = opts.ref || a['http-referrer'];
    if (kind === 'live') {
      item.num = parseInt(a['tvg-chno'] || a['channel-number'], 10) || ++liveNum;
      if (item.num > liveNum) liveNum = item.num;
      item.epgId = a['tvg-id'] || '';
      item.tvgName = a['tvg-name'] || '';
      const cu = a['catchup'] || a['catchup-type'] || (a['timeshift'] || a['tvg-rec'] ? 'default' : '');
      if (cu) item.catchup = { type: cu, days: parseInt(a['catchup-days'] || a['timeshift'] || a['tvg-rec'], 10) || 3, source: a['catchup-source'] || '' };
      out.live.push(item);
    } else if (kind === 'movie') out.movies.push(item);
    else out.episodes.push(item);
    cur = null; grp = ''; opts = {};
  }
  return out;
}

// EXTINF titles can contain commas, attributes can contain commas inside quotes.
function findTitleComma(line) {
  let inQ = false;
  for (let i = 7; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) return i;
  }
  return line.length;
}

/** Group M3U series episodes ("Show S01 E02") into series objects */
export function groupEpisodes(episodes, sourceId) {
  const map = new Map();
  for (const e of episodes) {
    const m = e.name.match(/^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})/i);
    const show = (m ? m[1] : e.name).trim() || e.name;
    const key = e.group + '|' + show;
    let s = map.get(key);
    if (!s) {
      s = { id: sourceId + ':s:' + hashStr(key), src: sourceId, name: show, cover: e.logo, group: e.group, m3uEpisodes: [] };
      map.set(key, s);
    }
    s.m3uEpisodes.push({ id: e.id, title: e.name, season: m ? +m[2] : 1, episode: m ? +m[3] : s.m3uEpisodes.length + 1, url: e.url, logo: e.logo });
  }
  return [...map.values()];
}
