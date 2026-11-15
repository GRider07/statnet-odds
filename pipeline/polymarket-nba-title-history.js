#!/usr/bin/env node
// Daily-ish price path of every team in Polymarket's "NBA Champion" markets (2021/22 .. now).
// The CLOB host refuses Hungarian connections, so this runs on GitHub Actions (.github/workflows/polymarket-nba-title-history.yml).
// Writes <out>: [{ slug, season (end year), teams: [{ team, yes (final Yes price), h: [[t, p], ...] }] }] gzip'd.
'use strict';
const fs = require('fs'), zlib = require('zlib');
const OUT = (process.argv.find((x) => x.startsWith('--out=')) || '--out=poly-nba-title.json.gz').split('=')[1];
const EVENTS = { 'who-will-win-the-NBA-21-22-championship': 2022, 'nba-champion': 2023, 'nba-champion-2023-24': 2024, 'nba-champion-2024-2025': 2025, '2026-nba-champion': 2026, 'nba-2027-champion': 2027 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let k = 1; ; k++) {
    try { const r = await fetch(url); if (r.status === 200) return await r.json(); if (r.status >= 400 && r.status < 500) { console.log('HTTP', r.status, (await r.text()).slice(0, 160), url.slice(-90)); return null; } throw new Error('HTTP ' + r.status); }
    catch (e) { if (k >= 5) { console.log('skip', url.slice(0, 120), e.message); return null; } await sleep(1000 * 2 ** k); }
  }
}
(async () => {
  const out = [];
  for (const [slug, season] of Object.entries(EVENTS)) {
    const ev = (await get(`https://gamma-api.polymarket.com/events?slug=${slug}`))?.[0]; if (!ev) { console.log('no event', slug); continue; }
    const t1 = Math.floor(Date.parse(season === 2027 ? new Date().toISOString() : `${season}-07-01`) / 1000), t0 = Date.parse(`${season - 1}-06-15`) / 1000, teams = [];
    for (const m of ev.markets) {
      let ids, px; try { ids = JSON.parse(m.clobTokenIds); px = JSON.parse(m.outcomePrices); } catch { continue; }
      const h = []; { const r = await get(`https://clob.polymarket.com/prices-history?market=${ids[0]}&interval=max&fidelity=720`); for (const x of r?.history || []) h.push([x.t, x.p]); }
      if (!h.length) for (let a = t0; a < t1; a += 25 * 86400) {   // 25-day windows: long ranges come back empty at fine fidelity
        const r = await get(`https://clob.polymarket.com/prices-history?market=${ids[0]}&startTs=${Math.floor(a)}&endTs=${Math.floor(Math.min(a + 25 * 86400, t1))}&fidelity=720`);
        for (const x of r?.history || []) h.push([x.t, x.p]); await sleep(120);
      }
      teams.push({ team: m.groupItemTitle || m.question, yes: +px[0], h });
    }
    console.log(slug, season, teams.length, 'teams', teams.reduce((a, t) => a + t.h.length, 0), 'points');
    out.push({ slug, season, teams }); fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(out)));
  }
  fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(out)));
})();
