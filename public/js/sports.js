// Sports hub data: finds football, cricket and F1 events in the TV guide and in
// "event" channels, merges the same event across channels, and classifies them.
import { lib } from './library.js';

export const SPORTS = {
  football: { label: 'Football', color: '#22c55e', icon: 'football' },
  cricket: { label: 'Cricket', color: '#f59e0b', icon: 'cricket' },
  f1: { label: 'Formula 1', color: '#ef4444', icon: 'f1' },
};

const RE = {
  football: /\b(football|soccer|futbol|fútbol|premier league|epl|champions league|europa (conference )?league|conference league|la ?liga|serie a|bundesliga|ligue 1|eredivisie|primeira liga|scottish premiership|spfl|efl|sky bet championship|fa cup|carabao cup|league cup|copa del rey|coppa italia|dfb[- ]?pokal|mls|saudi pro league|world cup|euro 20\d\d|nations league|super cup|copa am[eé]rica|afcon|africa cup of nations|wsl|isl)\b/i,
  cricket: /\b(cricket|test match|\d(?:st|nd|rd|th) test|odi|t20i?|ipl|indian premier league|big bash|bbl|wbbl|the hundred|ashes|county championship|vitality blast|t20 blast|psl|pakistan super league|cpl|caribbean premier league|sa20|ilt20|wpl|champions trophy|ranji)\b/i,
  f1: /\b(formula ?1|formula one|f1|grand prix)\b/i,
};
const NOT_FOOTBALL = /\b(rugby|nfl|american football|afl|aussie rules|gaelic|futsal|fantasy|esports|e-?football|fifa \d\d|ea sports fc)\b/i;
const NOT_F1 = /\b(moto ?gp|formula ?e|formula ?[234]|f[234]\b|indycar|nascar|superbikes?|wec|le mans|w series|karting|speedway|greyhound|horse)\b/i;
// Studio shows, highlights and replays: hidden unless the user asks for them
const REPLAY = /\b(highlights?|review|reloaded|rewind|classics?|replay|best of|preview|magazine|news|podcast|documentary|countdown|build[- ]?up|reaction|weekly|round[- ]?up|goals? of|extra time show|show\b|talk|analysis|archive|retro|delayed|tape|encore|repeat|focus|soccer am|match of the day|motd|sportscentre|sports ?centre|sportsday|transfer|draw|press conference|paddock|chequered flag|pit ?lane|inside line|stumped|tailenders)\b/i;
const EVENTISH = /\b(v|vs\.?|versus|live|race|qualifying|practice|sprint|fp[123]|test|day \d|innings|final|semi|quarter|match|grand prix|derby)\b/i;
const LIVE_WORD = /(^|\W)(live|en vivo|en directo|ao vivo|direct)(\W|$)/i;
const EVENT_GROUP = /\b(events?|ppv|pay ?per ?view|live sports?|matchday|match ?centre|match ?center|fixtures?)\b/i;
const NO_EVENT = /\b(no event|no events|offline|tba|tbd|coming soon|off ?air|not scheduled|no match)\b/i;

function sportOf(text) {
  if (RE.cricket.test(text)) return 'cricket';
  if (RE.f1.test(text) && !NOT_F1.test(text)) return 'f1';
  if (RE.football.test(text) && !NOT_FOOTBALL.test(text)) return 'football';
  return null;
}

/** Normalised event title for merging the same event across channels */
function eventKey(title) {
  return title.toLowerCase()
    .replace(LIVE_WORD, ' ')
    .replace(/\b(hd|fhd|uhd|4k)\b/g, ' ')
    .replace(/\bversus\b|\bvs\.?\b/g, ' v ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

let cache = null;
lib.on('epg', () => { cache = null; });
lib.on('change', () => { cache = null; });

/**
 * Scans the guide for sports events. Async + chunked so the UI stays responsive
 * on TV boxes even with thousands of channels.
 */
export async function findSportsEvents() {
  if (cache && Date.now() - cache.at < 5 * 60e3) return cache.data;
  const now = Date.now(), from = now - 4 * 3600e3, to = now + 7 * 864e5;
  const map = new Map();
  const channels = lib.live;
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const chText = `${ch.name} ${ch.group}`;
    // Sport-specific channel names (e.g. "Sky Sports Cricket") classify their event-like
    // programmes; event channels are handled separately (their guide is usually filler).
    const isEventCh = EVENT_GROUP.test(ch.group) || /\b(v|vs\.?)\b/i.test(ch.name);
    const chSport = isEventCh ? null : sportOf(chText);
    for (const p of lib.programmes(ch, from, to)) {
      if (p.stop <= now) continue;
      const text = `${p.title} ${p.cat || ''} ${p.ep || ''}`;
      let sport = sportOf(text);
      // fall back to the description, then to a sport-specific channel name
      if (isEventCh && !sportOf(text)) continue;
      if (!sport && p.desc) sport = sportOf(p.desc.slice(0, 240)) && EVENTISH.test(p.title) ? sportOf(p.desc.slice(0, 240)) : null;
      if (!sport && chSport && EVENTISH.test(p.title)) sport = chSport;
      if (!sport) continue;
      const replay = REPLAY.test(p.title) && !LIVE_WORD.test(p.title);
      const key = `${sport}|${eventKey(p.title)}|${Math.round(p.start / 900e3)}`;
      let ev = map.get(key);
      if (!ev) {
        ev = { key, sport, title: p.title.replace(/^\s*live\b\s*[:\-|]?\s*/i, '').trim(), sub: [p.cat, p.ep].filter(Boolean).join(' · '), desc: p.desc, start: p.start, stop: p.stop, channels: [], replay, live: LIVE_WORD.test(p.title) };
        map.set(key, ev);
      }
      if (!ev.channels.includes(ch)) ev.channels.push(ch);
    }
    if (i % 250 === 249) await new Promise((r) => setTimeout(r));
  }
  // "Event" channels: the fixture is in the channel name itself
  const eventChannels = [];
  for (const ch of channels) {
    if (!EVENT_GROUP.test(ch.group) && !/\b(v|vs\.?)\b/i.test(ch.name)) continue;
    if (NO_EVENT.test(ch.name)) continue;
    const sport = sportOf(`${ch.name} ${ch.group}`) || (EVENT_GROUP.test(ch.group) && /\b(v|vs\.?)\b/i.test(ch.name) ? sportOf(ch.group) : null);
    if (!sport) continue;
    const [nowProg] = lib.nowNext(ch);
    const time = (ch.name.match(/\b(\d{1,2}[:.]\d{2})\b/) || [])[1] || '';
    const name = ch.name.replace(/^[^:|]{0,24}(event|ppv)\s*\d*\s*[:|\-]\s*/i, '')
      .replace(/[\s@\-|(]*\d{1,2}[:.]\d{2}\s*(am|pm|uk|gmt|cet|et|est|bst)?\)?\s*$/i, '').trim();
    eventChannels.push({ key: 'ch|' + ch.id, sport, title: nowProg && sportOf(nowProg.title) ? nowProg.title : name, sub: ch.group, channels: [ch], eventChannel: true, time });
  }
  const events = [...map.values()].sort((a, b) => a.start - b.start || b.channels.length - a.channels.length);
  cache = { at: Date.now(), data: { events, eventChannels } };
  return cache.data;
}
