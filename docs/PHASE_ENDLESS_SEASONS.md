# Phase — Endless Seasons + Baserunning/Stats Correctness

One pass, two halves: make the screensaver actually endless (the core
"always-running" pillar), and fix a cluster of baseball-rules and
stat-accounting bugs found in a full-project review.

## What shipped

### Endless days + auto-director + season rollover (`/app/main.ts`)

Previously the app pre-simulated up to the live day, played that one slate
(~30 min), and froze on the final out forever. Now:

- **Auto-director.** When the channel you're watching goes final, the
  director hops to the most interesting game still in progress — scored as
  `inning * 1.5 − |scoreDiff| * 2`, judged only from state at the current
  tick so it never spoils an outcome. A manual channel change (arrows,
  digits, menu "watch") holds the director off for 30 s so you can linger
  on a final scoreboard.
- **Day advance.** When the whole slate is final, the next day is simulated
  on the spot (~8 games, a few hundred ms, once per ~30 min), folded into
  the season aggregates incrementally via `aggregateGame`, and put on the
  air at `simTime = 0`. The standings strip refreshes to count the finished
  day — never the new day's pre-simulated finals, so no spoilers.
- **Season rollover.** When the schedule runs out, the finished season's
  aggregates are banked into `priorSummaries`, `buildLeagueHistory` is
  re-run (the History menu grows a year), and a fresh season starts with a
  new schedule, per-season seed (`seasonSeedFor`), empty aggregates, and
  0–0 standings. Rosters carry over unchanged — aging/retirement is still
  future Phase 6 work.
- **Resume-from-save.** Progress is just `{seed, seasonIdx, day}` in
  localStorage (`8bb:progress:<seed>`): determinism is the storage engine.
  On reload, completed seasons are re-simulated with the same schedules and
  seeds — byte-identical to what originally played out — and the current
  season's history days rebuild the same way. An explicit `?day=` in the
  URL overrides the save. Cost: a few seconds of startup per completed
  season; storage failure (private mode) degrades to a fresh start.
- The channel label now shows `day N` (and `year Y` after a rollover), and
  the stats menu follows the active season's schedule via a live getter.
- Memory stays flat across a long session: each day's `LiveGame` array
  replaces the last, and raw history event logs are freed once aggregated.

### Sim correctness (`/sim/game.ts`)

`advanceForOutcome` now receives the current out count (and is exported for
unit tests). Fixes:

- **Fielder's choice**: trailing forced runners advance behind the force at
  2B — runner on 2nd takes 3rd with 1st+2nd occupied; the runner on 3rd
  scores on a bases-loaded force. Previously they illegally held.
- **Double play**: no run scores when the DP ends the inning; with 0 outs
  the runner from 3rd still crosses.
- **Groundout**: productive outs. With <2 outs, forced runners move up (a
  grounder that survived the DP/FC escalation means the force was beaten)
  and an unforced runner on 3rd scores on the contact play ~50% of the
  time (runner on 2nd takes 3rd ~60% when 3rd clears). With 2 outs
  everyone holds and nothing scores. Previously all runners always held.

### Stats correctness (`/stats/aggregator.ts`)

- **Earned runs**: ER was simply set equal to R. Now runs by runners who
  reached on an error — plus all runs in a reached-on-error at-bat — are
  unearned (a simplified inning reconstruction). `foldPitcherAtBat` takes
  an explicit `earnedRuns`; ERA stops being inflated.
- **Monthly splits**: per-month R was hardcoded to 0. Runs are now credited
  to the runner who scored, in the month they scored, so month split R sums
  to the top-line R.

### Render (`/render/loop.ts`)

- Frame delta clamped to 1 s: a backgrounded tab (rAF suspended) no longer
  fast-forwards the game and dumps the whole event backlog into the
  audio/ambience callbacks in one frame on return.

## Tests

141 passing (was 129). New:

- `sim/baserunning-table.test.ts` — 10 tests over `advanceForOutcome`:
  FC force chains, DP inning-ending no-run, groundout advancement rates,
  2-out holds, and a no-double-occupancy sweep.
- `stats/aggregator.test.ts` — ER ≤ R for every pitcher with league ER
  strictly below league R over a 6-day batch; month-split R sums to
  top-line R over an 8-day batch.

## Known limits / next steps

- Playoffs are still schema-only — the rollover jumps straight from the
  last regular-season day to the next year. Wiring the bracket into the
  endless loop is the natural next phase.
- No aging/retirement/draft: every season is played by the same roster
  (existing Phase 6 gap).
- Resume replays completed seasons at startup (~seconds per season). If a
  league runs for many seasons, capping replayed history or persisting
  aggregates directly may be worth it.
- `buildScene` still re-reduces the full event log every frame (cost grows
  within a game). Known hot spot, untouched here.
- Note for sim changes: outcomes shift because productive outs add PRNG
  draws — same seed still yields identical games run-to-run, but totals
  differ from pre-change builds. All seeded tests still pass.
