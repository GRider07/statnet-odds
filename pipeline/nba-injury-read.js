#!/usr/bin/env node
// nba-injury-read.js — today's official NBA injury report (ESPN's feed as the backup) into R2 odds/nba/injury-latest.json.gz
// plus a per-day history (odds/nba/injury/<UTC date>.json.gz). Run with the price reads (nba-watch.yml, public repo
// statnet-odds, a copy of this file) so the odds-watcher Worker rescores the admin table when the Out/Doubtful list changes,
// not only when a price does. Read only; needs pdftotext (poppler-utils).
//   node pipeline/nba-injury-read.js [--r2]
'use strict';
const os = require('os');
const { today } = require('./nba-injury-report.js'), { toR2 } = require('./vegas-nba-read.js');

(async () => {
  const t = await today(os.tmpdir());
  console.log(t.rep ? `injury report ${t.date} ${t.rep.name}: ${t.rep.rows.length} rows` : `no injury report found for ${t.date}`);
  if (process.argv.includes('--r2')) await toR2(t, 'odds/nba/injury');
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
