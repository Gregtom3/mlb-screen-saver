# Phase 5.5 — Statistics & Information Menu (part 1)

Date: 2026-04-26

The doc at `docs/dev_polish_001.md` lays out 13 sub-tasks. This pass
ships the foundation + the most-asked-for views; the rest gets follow-
up commits.

## What ships in this pass

- **5.5.1 — Aggregate tables foundation.** New `/stats` module with
  `BattingLine`, `PitchingLine`, `TeamLine`, and `SeasonAggregates`.
  `aggregateGame()` walks one game's SimEvent log once and folds its
  results into the season's aggregates. `buildSeasonAggregates(games)`
  is the bulk entry. Pure: in → out, no DOM, no rendering — the doc's
  ground rule that `/stats` should be Web-Worker safe is honoured.
- **5.5.2 — Stats catalog v1.** All standard counting and rate stats
  derived at read time in `/stats/derived.ts`: AVG, OBP, SLG, OPS,
  ERA, WHIP, K/9, BB/9, IP, win%, run differential, last-10, current
  streak, Pythagorean expectation. Six formula and invariant tests
  in `aggregator.test.ts` (`PA = AB + BB + HBP + SF + SH`, BF = PA
  league-wide, R-allowed = R-scored, etc.).
- **5.5.4 — WP heuristic + WPA.** Closed-form `homeWinProb(state)` in
  `/stats/wp.ts` that approximates Tom Tango's tables (run-impact
  scales by inning, base/out leverage, late-and-close magnification).
  WPA per plate appearance computed during aggregation — positive =
  the team gained WP. Pitcher's WPA mirrors the batter's. Vendoring
  a precomputed table is a follow-up; the system reads through this
  function either way.
- **5.5.5 — Menu shell.** `/ui/menu.ts` mounts a DOM-based modal over
  the canvas. Tab or M opens, Esc closes, 1–5 switch views, breadcrumbs
  update. Background games keep simulating while the menu is open
  (per the doc's "do not pause" rule).
- **5.5.6 — League view.** Standings grouped by conference + division
  with W/L/PCT/GB/Streak/L10/RS/RA/RD/HOME/AWAY columns; team-color
  stripes per row; division leader gets `GB —`. Below: batting and
  pitching leaderboards, qualified-only (3.1 PA/game-played hitters,
  1.0 IP/game-played pitchers per the doc's MLB-scaled threshold).
  Click any leaderboard row → drill into Player view.
- **5.5.8 partial — Player view.** Header card (name, position, bats/
  throws, team, hometown, personality flags). Season batting line +
  season pitching line if applicable. Career section is an empty-state
  pointing at Phase 6. Spray chart, splits panel, and game log come in
  the next pass.

## Open questions — proposed and proceeding

- **Playoff format**: 8-team (top 4 per conference, best-of-5 division,
  best-of-7 championship). Doc's own proposal — proceeding.
- **Qualifier thresholds**: 3.1 PA / team-game and 1.0 IP / team-game,
  scaled by `teamGamesPlayed` so leaderboards stay sensible mid-season.
- **WPA convention**: positive = team gained WP. Pitcher WPA mirrors
  batter WPA (sign-flipped). Documented at the top of `/stats/wp.ts`
  and `/stats/types.ts`.
- **Awards formula**: not yet implemented; will land with the awards-
  watch leaderboard. Proposed simple transparent formula:
  `MVP = bWPA + (OPS - .700) * 25 * (G / 150)`,
  `Cy Young = pWPA + (4.00 - ERA) * 0.5 * (IP / 150)`. Document in
  `/docs/awards.md` when shipped.

## Deferred to next part

- 5.5.3 Splits (vs L/R, RISP, late-and-close, by month). Adding these
  is "nest the same aggregator under split keys"; small but mechanical.
- 5.5.7 Team detail view (roster, schedule, stats, projections).
- 5.5.8 (rest) — splits panel, full game log, spray chart, hot/cold,
  procedural pixel-art portrait.
- 5.5.9 Spray charts.
- 5.5.10 Live view + per-game WP chart.
- 5.5.11 `/projections` Monte Carlo (Pythagorean + log5).
- 5.5.12 History view.
- 5.5.13 Polish — portraits, awards-watch, the docs that referenced
  this pass.

## Architecture notes

- `/stats` reads only `SimEvent[]` and `GameInput`. Never mutates the
  sim — the doc's "stats always derived from the event log" rule.
- `/ui/menu.ts` reads from `MenuContext.getAggregates()` so the menu
  always sees the latest aggregate. Today the aggregates are computed
  once at startup over the history days; when live games complete in
  Phase 5.5 part 2, they'll fold in incrementally and the menu will
  pick up the change without any wiring change.
- Sim untouched. All 30 prior tests still green; 12 new stats tests
  bring the total to 42.

## How to use

1. `npm run dev`, open the page.
2. Press **Tab** (or **M**) — stats menu opens over the screensaver.
3. **1**–**5** to switch views; **Esc** to close.
4. In the League view, click any row in the leaderboards to jump
   straight to that player.
5. Standings show all 16 teams sorted by record within their division;
   drill-down into Teams view is part 2.
