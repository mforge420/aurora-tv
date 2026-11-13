// Live / near-live scores from ESPN's public scoreboard feeds (no key needed).
// Unofficial API: everything here fails soft — no scores is never an error.
import { fetchJSON } from './net.js';
import { settings } from './settings.js';
import { store } from './util.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const HEADER = 'https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=';

// Competition names (as they appear in TV guides) → ESPN league slugs
const LEAGUES = [
  [/premier league|\bepl\b/i, 'eng.1'], [/\bchampionship\b/i, 'eng.2'], [/league one/i, 'eng.3'], [/league two/i, 'eng.4'],
  [/fa cup/i, 'eng.fa'], [/carabao|league cup|efl cup/i, 'eng.league_cup'],
  [/champions league/i, 'uefa.champions'], [/conference league/i, 'uefa.europa.conf'], [/europa league/i, 'uefa.europa'],
  [/nations league/i, 'uefa.nations'], [/la ?liga/i, 'esp.1'], [/copa del rey/i, 'esp.copa_del_rey'],
  [/serie a/i, 'ita.1'], [/coppa italia/i, 'ita.coppa_italia'], [/bundesliga/i, 'ger.1'], [/dfb[- ]?pokal/i, 'ger.dfb_pokal'],
  [/ligue 1/i, 'fra.1'], [/eredivisie/i, 'ned.1'], [/primeira liga|liga portugal/i, 'por.1'],
  [/scottish premiership|spfl/i, 'sco.1'], [/\bmls\b/i, 'usa.1'], [/saudi pro league/i, 'ksa.1'], [/\bwsl\b|women'?s super league/i, 'eng.w.1'],
];

const ALIASES = {
  'man utd': 'manchester united', 'man united': 'manchester united', 'man city': 'manchester city', spurs: 'tottenham hotspur',
  tottenham: 'tottenham hotspur', wolves: 'wolverhampton wanderers', 'nottm forest': 'nottingham forest', forest: 'nottingham forest',
  villa: 'aston villa', newcastle: 'newcastle united', 'west ham': 'west ham united', brighton: 'brighton hove albion',
  inter: 'internazionale', 'inter milan': 'internazionale', psg: 'paris saint germain', 'paris sg': 'paris saint germain',
  atletico: 'atletico madrid', barca: 'barcelona', juve: 'juventus', bayern: 'bayern munich', leverkusen: 'bayer leverkusen',
  dortmund: 'borussia dortmund', gladbach: 'borussia monchengladbach', 'sheff utd': 'sheffield united', 'sheff wed': 'sheffield wednesday',
  qpr: 'queens park rangers', wba: 'west bromwich albion', 'west brom': 'west bromwich albion',
  rcb: 'royal challengers bengaluru', csk: 'chennai super kings', mi: 'mumbai indians', kkr: 'kolkata knight riders', srh: 'sunrisers hyderabad',
  dc: 'delhi capitals', pbks: 'punjab kings', rr: 'rajasthan royals', lsg: 'lucknow super giants', gt: 'gujarat titans',
  eng: 'england', aus: 'australia', ind: 'india', pak: 'pakistan', sa: 'south africa', nz: 'new zealand', wi: 'west indies', sl: 'sri lanka',
};
const STOP = /\b(fc|afc|cf|sc|ac|ssc|cd|ud|rc|club|de|the|men|mens|cricket|football|team)\b/g;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' ').replace(/\((?:npl|ipl|bbl)\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const canon = (s) => { const n = norm(s); return norm(ALIASES[n] || n).replace(STOP, ' ').replace(/\s+/g, ' ').trim(); };
const isWomen = (s) => /\bwomen|\bwomens|\(w\)|-w\b|\bw\b|\bwbbl\b|\bwpl\b|\bwsl\b|\bwt20/i.test(s);

/** "Premier League - Liverpool v Manchester City" → ['Liverpool', 'Manchester City'] */
export function teamsFromTitle(title) {
  const t = String(title).replace(/\s+\d{1,2}[:.]\d{2}\s*$/, '');
  const m = t.match(/([^:|\-–—]+?)\s+(?:v|vs\.?|versus|x)\s+([^:|\-–—(,]+)/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function teamMatches(cardName, team, cardWomen) {
  const c = canon(cardName.replace(/\b(women'?s?|w)\b/gi, ''));
  if (!c) return false;
  if (cardWomen !== isWomen(team.names.join(' '))) return false;
  for (const n of team.names) {
    const t = canon(n);
    if (!t) continue;
    if (t === c || (c.length >= 4 && t.includes(c)) || (t.length >= 4 && c.includes(t))) return true;
    const a = new Set(c.split(' ')), b = t.split(' ');
    const common = b.filter((w) => w.length > 2 && a.has(w)).length;
    if (common && common >= Math.min(a.size, b.length) * 0.6) return true;
  }
  return false;
}

// ---------------------------------------------------------------- fetching
const cache = new Map();
async function get(url, ttl = 25e3) {
  const c = cache.get(url);
  if (c && Date.now() - c.at < ttl) return c.data;
  if (c?.pending) return c.pending;
  const pending = fetchJSON(url).then((data) => { cache.set(url, { at: Date.now(), data }); return data; })
    .catch(() => { cache.set(url, { at: Date.now() - ttl + 60e3, data: null }); return null; }); // back off 60 s
  cache.set(url, { ...(c || { at: 0 }), pending });
  return pending;
}
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

/** Normalised games from the "header" feed (all sports' current games) */
function fromHeader(d, sport) {
  const out = [];
  for (const lg of d?.sports?.[0]?.leagues || []) for (const e of lg.events || []) {
    const fs = e.fullStatus || {};
    out.push({
      sport, league: lg.name, start: Date.parse(e.date), end: e.endDate ? Date.parse(e.endDate) : null,
      state: fs.type?.state || e.status, clock: fs.type?.shortDetail || e.summary || '',
      note: sport === 'cricket' ? (fs.summary || e.summary || '') : '',
      teams: (e.competitors || []).sort((a, b) => (a.homeAway === 'home' ? -1 : 1) - (b.homeAway === 'home' ? -1 : 1)).map((c) => ({
        names: (learnCrest(sport, [c.displayName, c.name, c.location, c.shortDisplayName], c.logo), [c.displayName, c.name, c.location, c.shortDisplayName].filter(Boolean)),
        short: c.abbreviation || c.name || c.displayName, label: c.shortDisplayName || c.displayName, score: c.score ?? '',
      })),
    });
  }
  return out;
}
/** Normalised games from a league scoreboard */
function fromScoreboard(d, sport) {
  return (d?.events || []).map((e) => {
    const c = e.competitions?.[0] || {};
    return {
      sport, league: d.leagues?.[0]?.name, start: Date.parse(e.date), state: e.status?.type?.state,
      clock: e.status?.type?.shortDetail || '', note: '',
      teams: (c.competitors || []).sort((a, b) => (a.homeAway === 'home' ? -1 : 1) - (b.homeAway === 'home' ? -1 : 1)).map((x) => ({
        names: [x.team?.displayName, x.team?.shortDisplayName, x.team?.name, x.team?.location, x.team?.abbreviation].filter(Boolean),
        short: x.team?.abbreviation, label: x.team?.shortDisplayName || x.team?.displayName, score: x.score ?? '',
      })),
    };
  });
}

// ---------------------------------------------------------------- public API
export const scoresEnabled = () => settings.get('liveScores') !== false;

/**
 * Scores for sports-hub events ({key, sport, title, start, stop}).
 * Returns Map(event.key → { sport, line, home, away, clock, note, state, top? }).
 */
export async function scoresFor(events) {
  const res = new Map();
  if (!scoresEnabled() || !events.length) return res;
  const now = Date.now();
  const wants = { cricket: false, footballHeader: false, leagues: new Map(), f1: false };
  for (const e of events) {
    if (e.sport === 'cricket') wants.cricket = true;
    else if (e.sport === 'f1') wants.f1 = true;
    else if (e.sport === 'football') {
      const hay = `${e.title} ${e.sub || ''}`;
      const lg = LEAGUES.find(([re]) => re.test(hay));
      if (lg) {
        const days = wants.leagues.get(lg[1]) || new Set();
        for (const t of [e.start || now, now, now - 10 * 3600e3]) days.add(ymd(t));
        wants.leagues.set(lg[1], days);
      } else wants.footballHeader = true;
    }
  }
  const jobs = [];
  if (wants.cricket) jobs.push(get(HEADER + 'cricket').then((d) => fromHeader(d, 'cricket')));
  if (wants.footballHeader) jobs.push(get(HEADER + 'soccer', 45e3).then((d) => fromHeader(d, 'football')));
  for (const [slug, days] of wants.leagues) {
    for (const day of days) jobs.push(get(`${SITE}/soccer/${slug}/scoreboard?dates=${day}`).then((d) => fromScoreboard(d, 'football')));
  }
  const f1 = [];
  if (wants.f1) {
    const days = new Set(events.filter((e) => e.sport === 'f1').map((e) => ymd(e.start || now)));
    for (const day of days) jobs.push(get(`${SITE}/racing/f1/scoreboard?dates=${day}`, 30e3).then((d) => { if (d) f1.push(d); return []; }));
  }
  const games = (await Promise.all(jobs)).flat();

  for (const e of events) {
    if (e.sport === 'f1') { const s = f1.map((d) => f1Score(d, e)).find(Boolean); if (s) res.set(e.key, s); continue; }
    const teams = teamsFromTitle(e.title);
    if (!teams) continue;
    const t0 = e.start || now;
    const w = isWomen(`${e.title} ${e.sub || ''}`);
    const find = (women) => games.filter((g) => g.sport === e.sport && g.teams.length === 2 &&
      Math.abs(g.start - t0) < (e.sport === 'cricket' ? 5 * 864e5 : 6 * 3600e3) &&
      ((teamMatches(teams[0], g.teams[0], women) && teamMatches(teams[1], g.teams[1], women)) || (teamMatches(teams[0], g.teams[1], women) && teamMatches(teams[1], g.teams[0], women))));
    let found = find(w);
    // Guide didn't say "Women": accept a women's game only if it's the single match
    if (!found.length && !w) { const alt = find(true); if (alt.length === 1) found = alt; }
    const game = found[0];
    if (!game || game.state === 'pre') continue;
    const [h, a] = game.teams;
    res.set(e.key, {
      sport: e.sport, state: game.state, clock: game.clock, note: game.note,
      home: { name: h.label, short: h.short, score: h.score }, away: { name: a.label, short: a.short, score: a.score },
      line: e.sport === 'cricket' ? `${h.short} ${h.score || '–'}  ·  ${a.short} ${a.score || '–'}` : `${h.label} ${h.score} – ${a.score} ${a.label}`,
    });
  }
  return res;
}

function f1Score(d, e) {
  for (const ev of d?.events || []) for (const c of ev.competitions || []) {
    const start = Date.parse(c.date || c.startDate || ev.date);
    if (!start || Math.abs(start - e.start) > 3 * 3600e3) continue;
    const state = c.status?.type?.state;
    if (state === 'pre') return null;
    const top = (c.competitors || []).slice().sort((x, y) => (x.order || 99) - (y.order || 99)).slice(0, 3)
      .map((x) => x.athlete?.shortName || x.athlete?.displayName).filter(Boolean);
    if (!top.length) return null;
    const session = c.type?.abbreviation || '';
    return { sport: 'f1', state, clock: c.status?.type?.shortDetail || c.status?.type?.detail || '', note: session,
      top, line: top.map((n, i) => `${i + 1}. ${n}`).join('   ') };
  }
  return null;
}

/** Score for a programme on a channel (used by the fullscreen banner) */
export async function scoreForProgramme(sport, prog) {
  if (!sport || !prog) return null;
  const ev = { key: 'p', sport, title: prog.title, sub: `${prog.cat || ''} ${prog.ep || ''}`, start: prog.start, stop: prog.stop };
  return (await scoresFor([ev])).get('p') || null;
}

// ---------------------------------------------------------------- team crests
// Football: ESPN league team lists (cached a week). Cricket: national-team ids
// (verified against ESPN's images) plus logos learned from live scoreboards.
const CRICKET_IDS = { england: 1, australia: 2, 'south africa': 3, 'west indies': 4, 'new zealand': 5, india: 6, pakistan: 7, 'sri lanka': 8, zimbabwe: 9, bangladesh: 25, ireland: 29, afghanistan: 40 };
const DEFAULT_LEAGUES = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'eng.2', 'sco.1', 'por.1', 'ned.1', 'usa.1', 'ksa.1'];
let learned = store.get('crests', {});
function learnCrest(sport, names, logo) {
  if (sport !== 'cricket' || !logo) return;
  for (const n of names) if (n) learned[canonTeam(n)] = logo;
  clearTimeout(learnCrest.t); learnCrest.t = setTimeout(() => store.set('crests', learned), 2000);
}
const canonTeam = (n) => canon(String(n).replace(/\b(women'?s?|men'?s?|under[- ]?\d+s?|u\d{2}s?|a team|xi)\b/gi, ' '));

const teamLists = new Map();
async function leagueTeams(slug) {
  if (teamLists.has(slug)) return teamLists.get(slug);
  const cached = store.get('teams:' + slug);
  if (cached && Date.now() - cached.at < 7 * 864e5) { teamLists.set(slug, cached.teams); return cached.teams; }
  const p = fetchJSON(`${SITE}/soccer/${slug}/teams`).then((d) => {
    const teams = (d?.sports?.[0]?.leagues?.[0]?.teams || []).map(({ team: t }) => ({
      names: [t.displayName, t.shortDisplayName, t.name, t.location, t.abbreviation].filter(Boolean),
      logo: t.logos?.[0]?.href || '',
    })).filter((t) => t.logo);
    store.set('teams:' + slug, { at: Date.now(), teams });
    return teams;
  }).catch(() => []);
  teamLists.set(slug, p);
  return p;
}

const crestMemo = new Map();
/** { home: url|null, away: url|null, names: [a, b] } for a sports-hub event, or null */
export async function crestsFor(ev) {
  if (ev.sport === 'f1') return null;
  const names = teamsFromTitle(ev.title);
  if (!names) return null;
  const key = ev.sport + '|' + names.join('|');
  // cricket lookups are local (no network) and improve as scoreboards teach us logos: don't memoise
  if (ev.sport !== 'cricket' && crestMemo.has(key)) return crestMemo.get(key);
  const job = (async () => {
    let logos;
    if (ev.sport === 'cricket') {
      logos = names.map((n) => { const c = canonTeam(n); return learned[c] || (CRICKET_IDS[c] ? `https://a.espncdn.com/i/teamlogos/cricket/500/${CRICKET_IDS[c]}.png` : null); });
    } else {
      const hay = `${ev.title} ${ev.sub || ''}`;
      const lg = LEAGUES.find(([re]) => re.test(hay));
      const slugs = lg ? [lg[1], ...DEFAULT_LEAGUES.filter((s) => s !== lg[1])] : DEFAULT_LEAGUES;
      logos = [null, null];
      for (const slug of slugs) {
        const teams = await leagueTeams(slug);
        names.forEach((n, i) => { if (!logos[i]) logos[i] = teams.find((t) => teamMatches(n, t, false))?.logo || null; });
        if (logos[0] && logos[1]) break;
      }
    }
    return logos[0] || logos[1] ? { home: logos[0], away: logos[1], names } : null;
  })();
  crestMemo.set(key, job);
  return job;
}
