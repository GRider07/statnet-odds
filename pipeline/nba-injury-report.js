// nba-injury-report.js — find and read the newest official NBA injury report for a date (ESPN's feed as the backup).
// Shared by nba-live-score.js (the scorer) and nba-injury-read.js (the price-read job's copy, public repo statnet-odds).
// A copy lives in GRider07/statnet-odds: a change here goes there too.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { parse } = require('./nba-injury-parse.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// New York wall clock as a UTC-labelled Date (EST/EDT from the platform's tz data)
const etClock = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ms).map((x) => [x.type, x.value])); return new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`); };
const etDate = (ms) => etClock(ms).toISOString().slice(0, 10);

// newest official report for date: 15-minute slots back from now (polite: 1 s apart, stops on a block); dir holds the PDF
async function report(date, dir) {
  const HDR = { 'User-Agent': 'StatNet research (NBA model dry run, on command)' };
  const now = Date.now();
  const nowET = etClock(now), start = date === etDate(now) ? nowET.getUTCHours() * 60 + nowET.getUTCMinutes() : 23 * 60;
  for (let m = Math.floor(start / 15) * 15, tries = 0; m >= 10 * 60 && tries < 28; m -= 15, tries++) {
    const h = Math.floor(m / 60), name = `${String(((h + 11) % 12) + 1).padStart(2, '0')}_${String(m % 60).padStart(2, '0')}${h < 12 ? 'AM' : 'PM'}`;
    const url = `https://ak-static.cms.nba.com/referee/injury/Injury-Report_${date}_${name}.pdf`;
    await sleep(1000);
    const r = await fetch(url, { headers: HDR });
    if (r.status === 200) {
      const tmp = path.join(dir, 'injury', '_live.pdf');
      fs.mkdirSync(path.dirname(tmp), { recursive: true });   // a GitHub runner starts without injury/ (not in the state pack)
      fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
      return { name, rows: parse(execFileSync('pdftotext', ['-raw', tmp, '-']).toString()) };
    }
    if (r.status !== 403 && r.status !== 404) throw new Error(`injury report host answered ${r.status}: stopping`);
  }
  return null;
}

// ESPN backup (owner 2026-11-06: official first). Same row shape as the parser; shortcut: feed has no per-date view, so it is today's list
async function espn() {
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries', { headers: { 'User-Agent': 'StatNet research (NBA model dry run, on command)' } });
    if (!r.ok) return null;
    const j = await r.json(), rows = [];
    for (const t of j.injuries) for (const i of t.injuries) rows.push({ team: t.displayName, player: i.athlete.displayName, status: i.status === 'Out' ? 'Out' : 'Available' });
    return rows.length ? { name: 'ESPN backup', rows } : null;
  } catch (e) { return null; }
}

// today's report, official first: { at, date, rep } (rep null when neither source has one)
async function today(dir) {
  const date = etDate(Date.now());
  let rep = await report(date, dir).catch((e) => { console.log(`  official report failed (${e.message})`); return null; });
  if (!rep) rep = await espn();
  return { at: new Date().toISOString(), date, rep };
}

module.exports = { etClock, etDate, report, espn, today };
