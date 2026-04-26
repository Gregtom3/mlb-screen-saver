# Phase 5.5 — Statistics & Information Menu (part 2)

Date: 2026-04-26

This pass closes out the rest of the `dev_polish_001.md` checklist plus a
new attribute-system overhaul that landed alongside it. Everything the doc
listed in "Deferred to next part" of `PHASE_5_5.md` ships here.

---

## Player attribute system overhaul

The original 8 lumped ratings (`contact / power / eye / speed / fielding /
arm / stamina / composure`) became 31 named attributes — each tied to a
single sim hook. Continuous personality flags (`clutch`, `streaky`,
`durable`, `injury-prone`) collapsed to scalars; only `hot-headed` and
`glove-first` remain as qualitative tags.

### New attributes by domain

**Hitting** — `contact`, `power`, `discipline` (was `eye`), `pitchRecognition`,
`bunting`, `platoonBias`, `clutch`.

**Pitching** — `velocity`, `control`, `command`, `stamina`, `breakingBall`,
`changeup`, `holdRunners`, `groundballTendency`.

**Fielding** — `range`, `glove` (was `fielding`), `armStrength` (was `arm`),
`armAccuracy`, `transferSpeed` (IF), `framing`/`blocking`/`popTime` (C only).

**Baserunning** — `speed`, `stealing`, `baserunningIQ`.

**Mental** — `composure`, `consistency` (replaces `streaky`),
`durability` (replaces `durable`/`injury-prone`), `workEthic`, `coachability`.

### Sim hooks wired in this pass

- `velocity` → fastball MPH (`velocityFor`).
- `control` → in-zone strike rate (`zoneProb`).
- `command` → suppresses HR (in-play HR rate).
- `breakingBall` / `changeup` → SwStr% on their own pitch types.
- `groundballTendency` → tilts the GB/FB mix on outs + suppresses HR.
- `discipline` + `pitchRecognition` → swing decisions (chase rate, biased
  on breaking/off-speed).
- `platoonBias` → contact penalty when batter/pitcher share handedness.
- `clutch` vs pitcher `composure` → lift in the in-play HR/2B/1B rates in
  high-leverage states (7th+ inning, score within 2).

The remaining attributes are display-only for now; the sim hooks are
documented in `/stats/grades.ts` (`RATING_EFFECTS`), and wiring them in is
a follow-up that doesn't change the menu surface.

### Display

`/stats/grades.ts` converts internal 1-99 ratings to 1-5 scout stars with
half-star precision and named buckets (`elite`, `plus-plus`, `plus`,
`above avg`, `solid`, `average`, `fringe`, `below avg`, `well below`).
Player view shows attributes grouped by domain (Hit / Pitch / Field / Run /
Mental), role-gated so pitchers don't show fielding-only attributes and
catchers get framing/blocking/popTime. Tooltips explain the sim effect.

---

## What ships in this pass

- **5.5.3 — Splits.** `BattingLine` and `PitchingLine` carry nested split
  rows for `vsLHP/RHP`, `home/away`, `RISP`, `RISP+2`, `lateAndClose`. A
  per-month accumulator (`byMonth`) shows month-over-month performance.
  Tested invariants: `vsLHP + vsRHP = season PA`, `home + away = season PA`.

- **5.5.7 — Team detail view.** Header (banner, mascot, record, streak,
  RD), tabs for Roster (grouped by position with key stats), Schedule
  (full 150-game schedule, played games dimmed), Stats (with league rank
  per metric), Projections (full Monte Carlo readout + magic/elimination),
  and Stadium (dimensions + quirk). Click-through wired from the league
  standings.

- **5.5.8 — Player view (rest).** Procedural 64×64 pixel-art portrait
  (`ui/portrait.ts`, deterministic from `player.id`). Hot/cold pill in the
  header (rolling 7-game OPS or 3-game ERA delta vs. baseline). Splits
  panel with the dropdown the doc specified. Per-month and per-game logs.
  Full attribute panel with role-gated star grades.

- **5.5.9 — Spray charts.** `ui/spray-chart.ts` renders fair territory +
  one dot per batted ball, color-coded by outcome. Reuses the field-shape
  logic from `/render` without duplicating the full scene pipeline.

- **5.5.10 — Live view + WP chart.** `ui/wp-chart.ts` draws the per-game
  win-probability curve with annotations on plays >10% delta. The Live tab
  shows a tile grid with mini sparklines per game; clicking a tile expands
  the big chart + a "biggest plays" list. The "▶ watch this channel"
  button jumps the screensaver to that game's channel and closes the menu.

- **5.5.11 — `/projections` Monte Carlo.** New module: Pythagorean
  strength → log5 per game → 1000-sim Monte Carlo over remaining schedule
  + 8-team playoff bracket (top 4 per conference, best-of-5 division,
  best-of-7 championship). Outputs P(playoffs/division/seed/conference/title)
  + 5/50/95 win-total percentiles + SOS remaining. Magic / elimination
  numbers via `computeMagicNumber` at view time. Documented in
  `/docs/projections.md`.

- **5.5.12 — History stub.** Empty-state pages for Past seasons /
  Single-season records / All-time records / Hall of fame. Each one has a
  one-line note pointing at Phase 6.

- **5.5.13 — Polish.**
  - Procedural pixel-art portraits (deterministic from `player.id`,
    optional team colors). Smiles when `clutch > 65`, because why not.
  - Awards-watch leaderboard on the League view (MVP / Cy Young / Rookie),
    formulas documented in `/docs/awards.md`.
  - Hot/cold indicator (`stats/hot-cold.ts`).

- **5.5.B — Incremental aggregation.** New test asserts that calling
  `aggregateGame` in a loop produces the same result as one
  `buildSeasonAggregates` over the whole batch (PA totals, IP totals, W
  totals all match). Same invariant called out in `dev_polish_001.md`.

## Acceptance criteria check

The doc listed six things a user should be able to do without leaving the
screensaver. After this pass:

| # | Check | Status |
|---|---|---|
| 1 | Find HR leader in two key presses (Tab → click HR header) | ✓ |
| 2 | Player full season + splits vs LHP + last 10 + spray chart | ✓ |
| 3 | Team schedule + playoff odds + projected final record | ✓ |
| 4 | Live view with per-game WP evolution | ✓ |
| 5 | Click a past play, see WP delta | ✓ (in the WP chart's annotation list) |
| 6 | Close menu, return to right channel | ✓ (the menu never resets channel state) |

## What's still deferred

- **Vendored `/stats/wpTable.json`.** The closed-form approximation in
  `wp.ts` produces sensible curves; vendoring the Tom Tango lookup is a
  pure-data swap with no system change. Filed for Phase 6.
- **Manager of the Year award.** Needs preseason projections, which arrive
  in Phase 6.
- **Sim wiring for fielding attributes.** `range`, `armAccuracy`,
  `framing`, `blocking`, `popTime`, etc. are all generated, displayed, and
  documented; their sim hooks are still pending. Wiring them lands in a
  follow-up that touches `/sim` only.
- **Per-game live-incremental updates** during the watching session. The
  current build pre-simulates the day and aggregates once; a future pass
  can fold in finals as they happen.

## Tests

- 56 tests pass (was 42 in part 1 → +14 new).
- New: `stats/grades.test.ts` (5), `stats/incremental.test.ts` (1),
  `stats/splits.test.ts` (5), `projections/montecarlo.test.ts` (3).
- Existing aggregator tests updated for the new `(games, teams, players)`
  signature and `FinishedGame.day` field.

## Bundle

- `dist/index.html` 14.15 kB / 2.72 kB gzipped.
- `dist/assets/index-*.js` 126.34 kB / 41.79 kB gzipped (was 87 / 29 in
  part 1 — splits + projections + live view + portrait + attribute panel
  account for the delta).

## How to use

1. `npm run dev`, open the page.
2. **Tab** or **M** opens the menu over the screensaver.
3. **1**–**5** to switch views; **Esc** to close.
4. Click anywhere — division standings into team detail, leaderboards into
   player detail, live tiles into the WP chart.
5. From a Live tile's detail panel, hit **▶ watch this channel** to jump
   the renderer to that game.
