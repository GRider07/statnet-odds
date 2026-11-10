// pro.js — Tippmix Pro (tippmixpro.hu) market parsing, read over its sportsbook's WAMP websocket
// (EveryMatrix: wss://sportsapi.tippmixpro.hu/v2, realm www.tippmixpro.hu, operator 2901). No login needed.
// shortcut: a trimmed copy of the private repo's odds-watcher/src/pro.js (only what the readers here use); edit both.
//
// RECORDS come flat (MATCH, MARKET, OUTCOME, MARKET_OUTCOME_RELATION, BETTING_OFFER, EVENT_INFO) and OUTCOMES COME IN
// NO FIXED ORDER: every price is placed by its outcome's participant id, never by position.
// MARKETS (bettingTypeId / eventPartId): 466/60 winner incl. overtime, 69/61 1X2 regular time, 47/60 total incl.
// overtime, 48/60 handicap incl. overtime.

const byType = (recs) => { const o = {}; for (const r of recs || []) (o[r._type] ||= []).push(r); return o; };

// one match's markets out of a record dump -> { ml, ml1, x12, hc, tot, bs }
export function readProMarkets(recs, m) {
  const T = byType(recs);
  const offer = new Map((T.BETTING_OFFER || []).map((b) => [b.outcomeId, b]));
  const outcome = new Map((T.OUTCOME || []).map((o) => [o.id, o]));
  const rel = {};
  for (const r of T.MARKET_OUTCOME_RELATION || []) (rel[r.marketId] ||= []).push(r.outcomeId);
  const H = m.homeParticipantId, A = m.awayParticipantId;
  const o = { ml: null, ml1: null, x12: null, hc: [], tot: [], bs: null };
  for (const mk of T.MARKET || []) {
    if (mk.eventId !== m.id) continue;
    const outs = (rel[mk.id] || []).map((id) => ({ o: outcome.get(id), b: offer.get(id) })).filter((x) => x.o && x.b && x.b.odds > 1);
    const side = (x) => (x.o.paramParticipantId1 === H ? 'h' : x.o.paramParticipantId1 === A ? 'a' : 'd');
    const get = (s) => outs.find((x) => side(x) === s);
    const bt = mk.bettingTypeId, ep = mk.eventPartId;
    if (bt === '466' && ep === '60') {
      const h = get('h'), a = get('a');
      if ((h || a) && !(h && a)) o.ml1 = [h ? h.b.odds : 0, a ? a.b.odds : 0];   // one side only
      if (h && a) { o.ml = [h.b.odds, a.b.odds]; o.bs = h.b.isAvailable !== false && a.b.isAvailable !== false ? 1 : 0; }
    } else if (bt === '69' && ep === '61') {
      const h = get('h'), d = get('d'), a = get('a');
      if (h && d && a) o.x12 = [h.b.odds, d.b.odds, a.b.odds];
    } else if (bt === '47' && ep === '60') {
      const u = outs.find((x) => x.o.headerNameKey === 'under' || x.o.typeId === '14'), ov = outs.find((x) => x.o.headerNameKey === 'over' || x.o.typeId === '13');
      if (u && ov && mk.paramFloat1 != null) o.tot.push([+mk.paramFloat1, u.b.odds, ov.b.odds]);
    } else if (bt === '48' && ep === '60') {
      const h = get('h'), a = get('a');   // the line is the HOME side's handicap
      if (h && a && h.o.paramFloat1 != null) o.hc.push([+h.o.paramFloat1, h.b.odds, a.b.odds]);
    }
  }
  o.hc.sort((a, b) => a[0] - b[0]); o.tot.sort((a, b) => a[0] - b[0]);
  return o;
}
