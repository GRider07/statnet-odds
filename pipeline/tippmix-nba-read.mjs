// pipeline/tippmix-nba-read.mjs — read Tippmix Pro's NBA prices once. Not a Worker: the vegas-nba-watch GitHub
// workflow runs it every 30 min with --r2 (R2 odds/tippmix/nba-latest.json.gz + per-day history odds/tippmix/nba/<date>).
//
// node pipeline/tippmix-nba-read.mjs [--list] [--r2]      (--list: only print the basketball tournaments Pro offers)
//
// One websocket session, the protocol and markets of odds-watcher/src/pro.js (same User-Agent family and Origin), a few
// calls: the basketball tournament list, the NBA tournament's games, one market page per game. Each run is saved to
// pipeline-cache/nba-oracle/tippmix-nba/<UTC time>.json so prices can later be compared with the OddsPortal close.
// Per game: moneyline [home, away], handicap ladder [[home line, home odds, away odds]...], total ladder [[line, under, over]...].
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readNba } from '../odds-watcher/src/nba.js';

const HOST = 'sportsapi.tippmixpro.hu', ORIGIN = 'https://sports2.tippmixpro.hu', REALM = 'www.tippmixpro.hu', OP = 2901;
const UA = 'StatNet research (NBA prices for model comparison, read every 30 min)';
const CALL_MS = 15000, GAP_MS = 1500;
const OUT = path.join(import.meta.dirname, '..', 'pipeline-cache', 'nba-oracle', 'tippmix-nba');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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


const s = await session().catch((e) => { console.error('FAILED: ' + e.message + ' (a 403 here means Pro refuses this client: stop, do not retry around it)'); process.exit(1); });
try {
  const { tours, games } = await readNba(s.dump, () => sleep(GAP_MS));
  if (process.argv.includes('--list')) { for (const t of tours) console.log(t.id, '|', t.name, '|', t.templateName, '|', t.shortTranslatedName); process.exit(0); }
  if (!games.length) { console.log(`no NBA games on Pro (${tours.length} basketball tournaments; --list shows their names)`); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, at.replace(/[:.]/g, '-') + '.json'), JSON.stringify({ at, games }, null, 1));
  console.log(`${games.length} NBA games on Pro at ${at}`);
  if (process.argv.includes('--r2')) await createRequire(import.meta.url)('./vegas-nba-read.js').toR2({ at, games }, 'odds/tippmix/nba');
  for (const g of games) {
    // main handicap line = the one whose two prices are closest to each other
    const main = [...g.hc].sort((a, b) => Math.abs(a[1] - a[2]) - Math.abs(b[1] - b[2]))[0];
    console.log(`${g.start.slice(5, 16)}Z${g.live ? ' LIVE' : ''}  ${g.away} @ ${g.home}  ML ${g.ml ? g.ml.join(' / ') : g.ml1 ? 'one side ' + g.ml1.join(' / ') : '-'}  HC ${main ? `${main[0]} (${main[1]} / ${main[2]})` : '-'}  ladder ${g.hc.length} lines, total ${g.tot.length} lines`);
  }
} catch (e) { console.error('FAILED: ' + e.message); process.exit(1); } finally { s.close(); }
