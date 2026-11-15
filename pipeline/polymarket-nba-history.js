#!/usr/bin/env node
// polymarket-nba-history.js — minute price path of every NBA game moneyline on Polymarket.
// The CLOB host refuses connections
// from Hungary, so this runs on GitHub Actions (.github/workflows/polymarket-nba-history.yml).
// Writes <out>: [{ slug, start, outcomes: [a, b], q: question, h: [[t, p of outcome a], ...] }] gzip'd.
// Usage: node pipeline/polymarket-nba-history.js --from=2025-10-01 --to=2026-04-20 --out=poly-nba.json.gz
'use strict';
const fs = require('fs'), zlib = require('zlib');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const FROM = arg('from', '2025-10-01'), TO = arg('to', '2026-04-20'), OUT = arg('out', 'poly-nba.json.gz');
const HOURS = +arg('hours', '36');   // how far before tip-off the path starts
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let k = 1; ; k++) {
    try { const r = await fetch(url); if (r.status === 200) return await r.json(); throw new Error('HTTP ' + r.status); }
    catch (e) { if (k >= 6) throw new Error(url + ': ' + e.message); await sleep(1000 * 2 ** k); }
  }
}

async function main() {
  // every closed NBA game event in the window (slug nba-<a>-<b>-YYYY-MM-DD; props and futures have longer slugs)
  const evs = [];
  for (let off = 0; ; off += 100) {
    const page = await get(`https://gamma-api.polymarket.com/events?tag_slug=nba&closed=true&limit=100&offset=${off}&order=id&ascending=true&start_date_min=${FROM}T00:00:00Z&start_date_max=${TO}T00:00:00Z`);
    for (const e of page) if (/^nba-[a-z]+-[a-z]+-\d{4}-\d\d-\d\d$/.test(e.slug)) evs.push(e);
    if (page.length < 100) break;
    await sleep(150);
  }
  console.log(`${evs.length} game events`);
  const out = [];
  let i = 0, fail = 0;
  const worker = async () => {
    for (let e; (e = evs[i++]);) {
      try {
        const m = (e.markets || []).find((x) => x.sportsMarketType === 'moneyline');
        if (!m) continue;
        const tok = JSON.parse(m.clobTokenIds)[0], start = Date.parse(m.gameStartTime.replace(' ', 'T').replace('+00', 'Z')) / 1000;
        const h = [];
        for (let t0 = start - HOURS * 3600; t0 < start; t0 += 12 * 3600) {   // 12 h windows keep 1-minute fidelity
          const j = await get(`https://clob.polymarket.com/prices-history?market=${tok}&startTs=${t0}&endTs=${Math.min(start, t0 + 12 * 3600)}&fidelity=1`);
          for (const x of j.history || []) h.push([x.t, x.p]);
          await sleep(120);
        }
        out.push({ slug: e.slug, start, q: m.question, outcomes: JSON.parse(m.outcomes), h });
      } catch (err) { fail++; console.log('fail', e.slug, err.message); }
      if (i % 100 === 0) console.log(`  ${i}/${evs.length}, ${fail} failed`);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(out)));
  const pts = out.reduce((a, g) => a + g.h.length, 0);
  console.log(`${out.length} games, ${pts} price points, ${fail} failed -> ${OUT}`);
  if (out.length < evs.length * 0.8 || pts < out.length * 100) throw new Error('too few games or price points: check the API');
}
main().catch((e) => { console.error(e); process.exit(1); });
