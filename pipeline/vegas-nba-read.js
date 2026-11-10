#!/usr/bin/env node
// vegas-nba-read.js — read vegas.hu's NBA prices the way a visitor's browser does: headless Chrome opens vegas.hu and
// the page itself calls the Altenar widget feed (a plain request gets HTTP 400 and faking the page's headers is not
// allowed, so the request must come from the real page). No login, no cookie consent clicked, browser not disguised.
//
//   node pipeline/vegas-nba-read.js [--r2]
//
// Saves pipeline-cache/nba-oracle/vegas-nba/<UTC time>.json: { at, games: [[start MM-DDTHH:MM, home, away, ml[h,a], hc[homeLine,h,a]]] }
// (raw API prices; nba-full-model.js rounds them down to the 2-decimal display price). --r2 (the scheduled GitHub run)
// also writes R2 odds/vegas/nba-latest.json.gz and appends the read to odds/vegas/nba/<UTC date>.json.gz (price history).
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');

const CHROME = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
const FEED = 'https://hu-sb2frontend-altenar2.biahosted.com/api/widget/GetEvents?culture=hu-HU&timezoneOffset=-60&integration=vegashu2&deviceType=1&numFormat=hu-HU&countryCode=HU&eventCount=0&sportId=0&champIds=2980';
const OUT = path.join(__dirname, '..', 'pipeline-cache', 'nba-oracle', 'vegas-nba');

// pure: Altenar GetEvents JSON -> snapshot rows (typeId 219 winner, 223 handicap, main line = the market holding the isMB odd)
function rows(j) {
  const mk = new Map(j.markets.map((m) => [m.id, m])), od = new Map(j.odds.map((o) => [o.id, o]));
  const px = (m) => m.oddIds.map((i) => od.get(i).price);
  return j.events.filter((e) => e.status === 0 && / vs\. /.test(e.name)).map((e) => {
    const ms = e.marketIds.map((i) => mk.get(i)).filter(Boolean), w = ms.find((m) => m.typeId === 219);
    const hs = ms.filter((m) => m.typeId === 223), h = hs.find((m) => m.oddIds.some((i) => (od.get(i) || {}).isMB)) || hs[0];
    const [home, away] = e.name.split(' vs. ');
    return [e.startDate.slice(5, 16), home, away, w ? px(w) : null, h ? [+h.sv, ...px(h)] : null];
  });
}

async function read() {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage();
    await page.goto('https://vegas.hu/sports', { waitUntil: 'networkidle2', timeout: 60000 });
    const r = await page.evaluate(async (u) => { const x = await fetch(u); return { status: x.status, body: await x.text() }; }, FEED);
    if (r.status !== 200) throw new Error(`Vegas feed answered HTTP ${r.status} from inside the page: ${r.body.slice(0, 200)}`);
    return JSON.parse(r.body);
  } finally { await browser.close(); }
}

// R2 <prefix>-latest.json.gz = this read, <prefix>/<UTC date>.json.gz = the day's reads (also used by tippmix-nba-read.mjs)
async function toR2(snap, prefix = 'odds/vegas/nba') {
  const R2 = require('./r2-put.js'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-')), day = snap.at.slice(0, 10);
  const put = async (key, obj) => { const f = path.join(tmp, 'x.gz'); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(obj))); const r = await R2.putObject('statnet-games', key, f); if (!r.ok) throw new Error(`R2 put ${key}: ${r.msg}`); };
  let hist = { date: day, reads: [] };
  const f = path.join(tmp, 'day.gz'), g = await R2.getObject('statnet-games', `${prefix}/${day}.json.gz`, f);
  if (g.ok) { const b = fs.readFileSync(f); hist = JSON.parse((b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b).toString()); }   // the S3 path may hand it back already decompressed
  else if (!/404|NoSuchKey|not found/i.test(g.msg || '')) throw new Error(`R2 get of today's history failed (${g.msg}): not overwriting it`);
  hist.reads.push(snap);
  await put(`${prefix}/${day}.json.gz`, hist);
  await put(`${prefix}-latest.json.gz`, snap);
  console.log(`R2: ${prefix}/${day}.json.gz now holds ${hist.reads.length} reads; ${prefix}-latest updated`);
}

if (require.main === module) (async () => {
  const j = await read(), games = rows(j), at = new Date().toISOString();
  if (!games.length) throw new Error(`0 NBA games parsed from ${j.events.length} events: the feed or its shape changed`);   // parsers must scream on zero
  const snap = { at, games };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, at.replace(/[:.]/g, '-') + '.json'), JSON.stringify(snap));
  console.log(`${games.length} NBA games on Vegas at ${at}`);
  for (const g of games.slice(0, 12)) console.log(`  ${g[0]}Z  ${g[2]} @ ${g[1]}  ML ${g[3] ? g[3].join(' / ') : '-'}  HC ${g[4] ? `${g[4][0]} (${g[4][1]} / ${g[4][2]})` : '-'}`);
  if (process.argv.includes('--r2')) await toR2(snap);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });

module.exports = { rows, toR2 };
