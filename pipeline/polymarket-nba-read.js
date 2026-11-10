#!/usr/bin/env node
// polymarket-nba-read.js — the SHARP side of the same-moment price log:
// Polymarket's NBA game moneylines, read in the same GitHub run as Vegas and Tippmix (nba-watch.yml), so each soft
// book price has a sharp fair price taken minutes apart. gamma-api answers from Hungary and GitHub; no login, no headers.
//
//   node pipeline/polymarket-nba-read.js [--r2]     --r2: odds/polymarket/nba-latest.json.gz + odds/polymarket/nba/<date>.json.gz
//
// Row per game: [startUTC, slug, outcomeA, outcomeB, pA mid, bestBid A, bestAsk A, last trade A, liquidity]. Read only.
'use strict';
const { toR2 } = require('./vegas-nba-read.js');
const HORIZON_H = 96;   // games tipping off within 4 days (Vegas lists 2-4 days ahead, Tippmix ~48 h)

async function get(url) {
  for (let k = 1; ; k++) {
    try { const r = await fetch(url); if (r.status === 200) return await r.json(); throw new Error('HTTP ' + r.status); }
    catch (e) { if (k >= 4) throw new Error(url + ': ' + e.message); await new Promise((r) => setTimeout(r, 1000 * 2 ** k)); }
  }
}

async function read() {
  const now = Date.now(), games = [];
  for (let off = 0; off < 1000; off += 100) {
    const page = await get(`https://gamma-api.polymarket.com/events?tag_slug=nba&closed=false&active=true&limit=100&offset=${off}`);
    for (const e of page) {
      if (!/^nba-[a-z]+-[a-z]+-\d{4}-\d\d-\d\d$/.test(e.slug)) continue;   // game events only (props and futures have longer slugs)
      const t = Date.parse(e.startTime || e.endDate), m = (e.markets || []).find((x) => x.slug === e.slug);
      if (!m || !(t > now) || t > now + HORIZON_H * 3600e3) continue;
      const out = JSON.parse(m.outcomes || '[]'), px = JSON.parse(m.outcomePrices || '[]').map(Number);
      if (out.length !== 2 || !(px[0] > 0 && px[0] < 1)) continue;
      games.push([new Date(t).toISOString().slice(0, 16), e.slug, out[0], out[1], px[0], m.bestBid ?? null, m.bestAsk ?? null, m.lastTradePrice ?? null, Math.round(+m.liquidity || 0)]);
    }
    if (page.length < 100) break;
  }
  return games.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

if (require.main === module) (async () => {
  const games = await read(), at = new Date().toISOString();
  if (!games.length) throw new Error('0 upcoming NBA games on Polymarket: the feed or its shape changed');   // parsers must scream on zero
  console.log(`${games.length} NBA games on Polymarket at ${at}`);
  for (const g of games.slice(0, 12)) console.log(`  ${g[0]}Z  ${g[2]} vs ${g[3]}  ${(100 * g[4]).toFixed(1)}%  bid ${g[5]} ask ${g[6]}  liq ${g[8]}`);
  if (process.argv.includes('--r2')) await toR2({ at, games }, 'odds/polymarket/nba');
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });

module.exports = { read };
