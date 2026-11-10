// nba.js — Tippmix Pro's NBA games and prices, from a `dump(topic)` function (see pro.js for the protocol).
// Shared on purpose: pipeline/tippmix-nba-read.mjs runs it on command from the PC today; the Worker can call the same
// readNba() from a cron later (give proSession's return object a `dump`), like the Hungarian leagues. Nothing here schedules anything.
import { readProMarkets } from './pro.js';

const OP = 2901;
// the NBA tournament, not WNBA / G League / summer league
export const isNba = (t) => { const n = `${t.name} ${t.templateName} ${t.shortTranslatedName}`; return /\bNBA\b/i.test(n) && !/WNBA|G[ -]?League|summer|n[őo]i|women|fantasy/i.test(n); };

// Player points, full game incl. overtime (bettingTypeId 200, eventPartId 60; improvement 4, logged from 2026-11-09 to test a
// player model later): [[player name, team name, line, under odds, over odds], ...]. Pro's margin here is ~9.5%.
export function readPlayerPoints(recs, m) {
  const offer = new Map(), outcome = new Map(), rel = {};
  for (const r of recs) {
    if (r._type === 'BETTING_OFFER') offer.set(r.outcomeId, r);
    else if (r._type === 'OUTCOME') outcome.set(r.id, r);
    else if (r._type === 'MARKET_OUTCOME_RELATION') (rel[r.marketId] ||= []).push(r.outcomeId);
  }
  const out = [];
  for (const mk of recs) {
    if (mk._type !== 'MARKET' || mk.bettingTypeId !== '200' || mk.eventPartId !== '60' || mk.eventId !== m.id || mk.paramFloat1 == null) continue;
    const os = (rel[mk.id] || []).map((id) => ({ o: outcome.get(id), b: offer.get(id) })).filter((x) => x.o && x.b && x.b.odds > 1);
    const u = os.find((x) => x.o.headerNameKey === 'under'), ov = os.find((x) => x.o.headerNameKey === 'over');
    if (u && ov) out.push([ov.o.paramParticipantName1, ov.o.paramParentParticipantName1, +mk.paramFloat1, u.b.odds, ov.b.odds]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2]);
}

// -> { tours: all basketball tournaments, games: [{ proId, tournament, start (ISO), live, home, away, ml, ml1, hc, tot }] }
// gap: ms to wait between calls (be polite); the Worker passes a no-op.
export async function readNba(dump, gap = async () => {}) {
  const tours = (await dump(`/sports/${OP}/hu/tournaments/8`)).filter((x) => x._type === 'TOURNAMENT');
  const games = [];
  for (const t of tours.filter(isNba)) {
    await gap();
    const recs = await dump(`/sports/${OP}/hu/tournament-aggregator-groups-overview/${t.id}/default-event-info/BOTH/570`);
    for (const m of recs.filter((x) => x._type === 'MATCH' && (x.statusId === '1' || x.statusId === '2'))) {
      await gap();
      const recs = await dump(`/sports/${OP}/hu/${m.id}/match-odds/market-group/Nepszeru`), px = readProMarkets(recs, m);
      games.push({ proId: m.id, tournament: t.name, start: new Date(m.startTime).toISOString(), live: m.statusId === '2', home: m.homeParticipantName, away: m.awayParticipantName, ml: px.ml, ml1: px.ml1, hc: px.hc, tot: px.tot, pp: readPlayerPoints(recs, m) });
    }
  }
  games.sort((a, b) => a.start.localeCompare(b.start));
  return { tours, games };
}
