// nba-injury-parse.js — one official NBA injury report (pdftotext -raw text) -> [{ date, matchup, team, player ("First Last"), status }]
// Shared by nba-injury-reports-pull.js (the 2025/26 archive) and nba-live-score.js (tonight's report).
'use strict';
const STATUS = 'Out|Questionable|Doubtful|Probable|Available';
const TEAMS = ['Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets', 'Chicago Bulls', 'Cleveland Cavaliers', 'Dallas Mavericks', 'Denver Nuggets', 'Detroit Pistons', 'Golden State Warriors', 'Houston Rockets', 'Indiana Pacers', 'LA Clippers', 'Los Angeles Lakers', 'Memphis Grizzlies', 'Miami Heat', 'Milwaukee Bucks', 'Minnesota Timberwolves', 'New Orleans Pelicans', 'New York Knicks', 'Oklahoma City Thunder', 'Orlando Magic', 'Philadelphia 76ers', 'Phoenix Suns', 'Portland Trail Blazers', 'Sacramento Kings', 'San Antonio Spurs', 'Toronto Raptors', 'Utah Jazz', 'Washington Wizards'];

// one report's text -> [{ date, matchup, team, player ("First Last"), status }]
function parse(txt) {
  const rows = [];
  let date = null, matchup = null, team = null;
  const re = new RegExp(`^(.*?)([A-Z][A-Za-z'.\\- ]*(?: (?:Jr\\.|Sr\\.|II|III|IV))?, [A-Z][A-Za-z'.\\- ]*?) (${STATUS})\\b`);
  for (let l of txt.split(/\r?\n/)) {
    const d = l.match(/^(\d\d\/\d\d\/\d{4}) /); if (d) { date = d[1]; l = l.slice(d[0].length); }
    const t = l.match(/^\d\d:\d\d \(ET\) /); if (t) l = l.slice(t[0].length);
    const m = l.match(/^([A-Z]{2,3}@[A-Z]{2,3}) /); if (m) { matchup = m[1]; team = null; l = l.slice(m[0].length); }
    const tm = TEAMS.find((n) => l.startsWith(n + ' ')); if (tm) { team = tm; l = l.slice(tm.length + 1); }
    const p = l.match(re);
    if (p && !p[1] && matchup && team) { const [last, first] = p[2].split(', '); rows.push({ date, matchup, team, player: `${first} ${last}`, status: p[3] }); }
  }
  return rows;
}
// self-check on a known line pattern
{ const r = parse('01/15/2026 07:00 (ET) PHX@DET Phoenix Suns Booker, Devin Out Injury/Illness - Left Ankle; Sprain\nPippen Jr., Scotty Out\nInjury/Illness - x');
  if (r.length !== 2 || r[0].player !== 'Devin Booker' || r[1].player !== 'Scotty Pippen Jr.' || r[1].team !== 'Phoenix Suns') throw new Error('parser self-check failed: ' + JSON.stringify(r)); }

module.exports = { parse, TEAMS };
