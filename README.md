# statnet-odds

Read-only price snapshots for basketball games (vegas.hu, Tippmix Pro, Polymarket), taken a few times a day and stored for later comparison. Nothing is bet from here.

- `nba-watch.yml`: NBA prices.
- `intl-watch.yml`: four European leagues (ACB, Georgia, Denmark, Czechia).

Both start from `workflow_dispatch` only. Reads are polite: one browser page or one websocket session per book, 1.5 s between calls, no login, no disguised client.
