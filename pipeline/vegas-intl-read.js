#!/usr/bin/env node
// vegas-intl-read.js — vegas.hu prices for the four watch leagues (ACB, GEOB, DBBF, CBFFE), read the same way as
// vegas-nba-read.js (headless Chrome opens vegas.hu, the page itself calls the Altenar feed; no header faking).
//   node pipeline/vegas-intl-read.js [--r2]
// Snapshot { at, leagues: { ACB: [rows], ... } } with rows exactly as vegas-nba-read.js rows() makes them. --r2 writes
// R2 odds/vegas/intl-latest.json.gz and appends to odds/vegas/intl/<UTC date>.json.gz. Read only, nothing is bet.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const puppeteer = require('puppeteer-core');
const { rows } = require('./vegas-nba-read.js');
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
const CHAMPS = { ACB: 3009, GEOB: 4480, DBBF: 3017, CBFFE: 3068 };   // GEOB = Georgian Superleague (Batumi, Kutaisi...), NOT Greece (2982)
const feed = (id) => `https://hu-sb2frontend-altenar2.biahosted.com/api/widget/GetEvents?culture=hu-HU&timezoneOffset=-60&integration=vegashu2&deviceType=1&numFormat=hu-HU&countryCode=HU&eventCount=0&sportId=0&champIds=${id}`;
const OUT = path.join(__dirname, '..', 'pipeline-cache', 'winprob', 'vegas-intl');

async function read() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  try {
    const page = await browser.newPage();
    await page.goto('https://vegas.hu/sports', { waitUntil: 'networkidle2', timeout: 60000 });
    const out = {};
    for (const [code, id] of Object.entries(CHAMPS)) {
      const r = await page.evaluate(async (u) => { const x = await fetch(u); return { status: x.status, body: await x.text() }; }, feed(id));
      if (r.status !== 200) throw new Error(`${code}: Vegas feed answered HTTP ${r.status}: ${r.body.slice(0, 200)}`);
      out[code] = rows(JSON.parse(r.body));
    }
    return out;
  } finally { await browser.close(); }
}

async function toR2(snap, base = 'odds/vegas/intl') {   // also used by tippmix-intl-read.mjs (base odds/tippmix/intl)
  const R2 = require('./r2-put.js'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vegas-')), day = snap.at.slice(0, 10);
  const put = async (key, obj) => { const f = path.join(tmp, 'x.gz'); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(obj))); const r = await R2.putObject('statnet-games', key, f); if (!r.ok) throw new Error(`R2 put ${key} failed: ${r.msg}`); };
  let hist = { date: day, reads: [] };
  const f = path.join(tmp, 'day.gz'), g = await R2.getObject('statnet-games', `${base}/${day}.json.gz`, f);
  if (g.ok) { const b = fs.readFileSync(f); hist = JSON.parse((b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b).toString()); }
  else if (!/404|NoSuchKey|not found/i.test(g.msg || '')) throw new Error(`R2 get of today's history failed (${g.msg}): not overwriting it`);
  hist.reads.push(snap);
  await put(`${base}/${day}.json.gz`, hist);
  await put(`${base}-latest.json.gz`, snap);
  console.log(`R2: ${base}/${day}.json.gz now holds ${hist.reads.length} reads`);
}

module.exports = { toR2 };

if (require.main === module) (async () => {
  const leagues = await read(), at = new Date().toISOString();
  const total = Object.values(leagues).reduce((s, l) => s + l.length, 0);
  console.log(Object.entries(leagues).map(([c, l]) => `${c} ${l.length}`).join(', '));
  if (!total) throw new Error('0 games parsed in all four leagues: the feed or its shape changed');   // parsers must scream on zero (an empty league alone can be an off-week)
  const snap = { at, leagues };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, at.replace(/[:.]/g, '-') + '.json'), JSON.stringify(snap));
  if (process.argv.includes('--r2')) await toR2(snap);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
