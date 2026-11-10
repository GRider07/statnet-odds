// pipeline/tippmix-intl-read.mjs — read Tippmix Pro's prices for the four watch leagues ONCE, on command. Not scheduled, not a Worker.
//
// node pipeline/tippmix-intl-read.mjs [--r2]      --r2: also R2 odds/tippmix/intl-latest.json.gz + odds/tippmix/intl/<UTC date>.json.gz
//
// Same protocol, markets and politeness as pipeline/tippmix-nba-read.mjs (one websocket session, 1.5 s between calls).
// Tournaments are found by their Hungarian template name each run (the ids change every season). GEOB is the GEORGIAN
// league ("Georgiai bajnokság"), not the Greek one. Saved to pipeline-cache/winprob/tippmix-intl/<UTC time>.json:
// { at, leagues: { ACB: [{ proId, start, live, home, away, ml, ml1, hc, tot }] } } (hc = ladder [[home line, home, away]]).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readProMarkets } from '../odds-watcher/src/pro.js';

const HOST = 'sportsapi.tippmixpro.hu', ORIGIN = 'https://sports2.tippmixpro.hu', REALM = 'www.tippmixpro.hu', OP = 2901;
const UA = 'StatNet research (foreign-league prices for model comparison, read on command)';
const CALL_MS = 15000, GAP_MS = 1500;
export const TOURS = { ACB: 'Spanyol bajnokság', GEOB: 'Georgiai bajnokság', DBBF: 'Dán bajnokság', CBFFE: 'Cseh bajnokság' };   // templateName, exact
const OUT = path.join(import.meta.dirname, '..', 'pipeline-cache', 'winprob', 'tippmix-intl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// shortcut: a copy of tippmix-nba-read.mjs's session (that file runs on import); move both to one module if a third reader appears
const session = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`wss://${HOST}/v2`, { protocols: ['wamp.2.json'], headers: { Origin: ORIGIN, 'User-Agent': UA } });
  const pending = new Map();
  let req = 0;
  const timer = setTimeout(() => reject(new Error('no WELCOME')), CALL_MS);
  ws.addEventListener('open', () => ws.send(JSON.stringify([1, REALM, { roles: { caller: {} } }])));
  ws.addEventListener('error', () => reject(new Error('socket error')));
  ws.addEventListener('close', () => reject(new Error('socket closed')));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m[0] === 2) { clearTimeout(timer); resolve(api); }
    else if (m[0] === 50 && pending.has(m[1])) { pending.get(m[1]).res((m[4] || {}).records); pending.delete(m[1]); }
    else if (m[0] === 8 && pending.has(m[2])) { pending.get(m[2]).rej(new Error('WAMP error ' + JSON.stringify(m.slice(3)).slice(0, 200))); pending.delete(m[2]); }
  });
  const api = {
    dump: (topic) => new Promise((res, rej) => {
      const id = ++req;
      const to = setTimeout(() => { pending.delete(id); rej(new Error('timeout ' + topic)); }, CALL_MS);
      pending.set(id, { res: (v) => { clearTimeout(to); if (!Array.isArray(v)) rej(new Error('reply without records: ' + topic)); else res(v); }, rej: (e) => { clearTimeout(to); rej(e); } });
      ws.send(JSON.stringify([48, id, {}, '/sports#initialDump', [], { topic }]));
    }),
    close: () => { try { ws.close(1000, 'done'); } catch (_) { /* closed */ } },
  };
});

export async function readIntl() {
  const s = await session();
  try {
    const tours = (await s.dump(`/sports/${OP}/hu/tournaments/8`)).filter((x) => x._type === 'TOURNAMENT');
    const leagues = {};
    for (const [code, name] of Object.entries(TOURS)) {
      const t = tours.find((x) => x.templateName === name);
      if (!t) { console.warn(`!! ${code}: no tournament named "${name}" on Pro (renamed, or off-season)`); leagues[code] = []; continue; }
      await sleep(GAP_MS);
      const recs = await s.dump(`/sports/${OP}/hu/tournament-aggregator-groups-overview/${t.id}/default-event-info/BOTH/570`);
      leagues[code] = [];
      for (const m of recs.filter((x) => x._type === 'MATCH' && (x.statusId === '1' || x.statusId === '2'))) {
        await sleep(GAP_MS);
        const px = readProMarkets(await s.dump(`/sports/${OP}/hu/${m.id}/match-odds/market-group/Nepszeru`), m);
        leagues[code].push({ proId: m.id, start: new Date(m.startTime).toISOString(), live: m.statusId === '2', home: m.homeParticipantName, away: m.awayParticipantName, ml: px.ml, ml1: px.ml1, hc: px.hc, tot: px.tot });
      }
    }
    return leagues;
  } finally { s.close(); }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('tippmix-intl-read.mjs')) {
  try {
    const leagues = await readIntl(), at = new Date().toISOString();
    console.log(Object.entries(leagues).map(([c, l]) => `${c} ${l.length}`).join(', '));
    if (!Object.values(leagues).some((l) => l.length)) { console.error('FAILED: 0 games in all four leagues'); process.exit(2); }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, at.replace(/[:.]/g, '-') + '.json'), JSON.stringify({ at, leagues }));
    if (process.argv.includes('--r2')) await createRequire(import.meta.url)('./vegas-intl-read.js').toR2({ at, leagues }, 'odds/tippmix/intl');
  } catch (e) { console.error('FAILED: ' + e.message + ' (a 403 means Pro refuses this client: stop, do not retry around it)'); process.exit(1); }
}
