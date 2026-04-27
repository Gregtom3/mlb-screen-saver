# Phase 5.5 — Batter card upgrade

The on-canvas "AT BAT" card got the broadcast treatment: a pixel-art
portrait of the active batter, their season top line (AVG / HR / RBI),
and — when the sample size warrants — a "vs PITCHER" all-time matchup
line drawn from across every completed prior season plus the current
one. Closes a cluster of polish gaps the existing card had since
Phase 3.

## What shipped

- **Portrait on the card.** `/ui/portrait.ts:drawPortrait` now draws
  directly into the canvas HUD at a 36×36 (desktop) / 32×32 (narrow)
  size, anchored at the top-left of the batter card. Same procedural
  face the menu's player view shows, so the canvas and the menu agree.
- **Season top line.** AVG / HR / RBI for the active batter, formatted
  ".312  24HR  87RBI". Pulled from `SeasonAggregates.batting[batterId]`
  which already existed; the renderer just didn't have access to it
  before this pass.
- **All-time vs-this-pitcher matchup.** Hits-AB, AVG, and HR for the
  current batter against the current pitcher, accumulated across every
  game in `LeagueHistory.careerBvp` (prior seasons) plus
  `SeasonAggregates.bvpMatchups` (current season). Surfaced only when
  combined PA ≥ 3 so we don't show "1-1 1.000" after a single past
  matchup. Rendered in the accent color so it reads as a live
  "did-you-know" stat strip.
- **Layout grew vertically.** The shared bottom-panel height bumped
  from 78 → 102 (desktop) and 130 → 154 (narrow) to fit the new lines.
  The strike-zone viewer and line-score panels share the height; their
  internal layouts already breathe gracefully when given more room.
  The transform reserves the new height automatically via
  `bottomHudReserved`.

## Architecture

The feature touched three layers cleanly:

### `/stats` — new BvP aggregation

- `SeasonAggregates.bvpMatchups: Map<batterId, Map<pitcherId, BvpLine>>` —
  populated at every `atBatEnd` in `aggregateGame`. The same per-AB
  effects that fold into the batter top-line and pitcher top-line now
  also fold into this matchup row.
- `BvpLine` is a slim counter-only shape (PA, AB, H, doubles, triples,
  HR, RBI, BB, HBP, SO, SF, SH). No nested splits / hitChart / gameLog
  / byMonth / zone — those exist for the menus' deeper drilldowns,
  not the on-canvas one-line summary.

### `/season/history.ts` — career rollup

- `LeagueHistory.careerBvp: ReadonlyMap<batterId, ReadonlyMap<pitcherId, BvpLine>>` —
  built by `accumulateCareerBvp` in `buildLeagueHistory`. Sums each
  prior season's `bvpMatchups` into a per-pair career line.
- The current (in-progress) season's matchups stay in
  `SeasonAggregates.bvpMatchups` and are added to `careerBvp` at
  render time inside `buildScene` to produce the final all-time line.

### `/render` — plumbing + drawing

- `SceneContext` gained optional `seasonAggregates?` and `careerBvp?`.
  Optional so existing scene tests / ad-hoc callers keep working —
  absence cleanly falls back to "season + BvP unavailable" and the
  HUD just doesn't draw those lines.
- `SceneState` gained `seasonBatterStats: SeasonBatterStats | null`
  and `bvpStats: BvpStats | null`. `buildScene` derives them from the
  context's aggregates + `careerBvp` + the `currentBatterId` and
  `fieldingPitcherId` it already tracks.
- `drawBatterCard` rewritten: portrait at top-left, name + position in
  the column to its right, three stacked stat lines below. The "vs
  PITCHER" line is suppressed under the PA threshold so noise pairs
  don't appear. `HudExtras.teamColors` flows in so the portrait can
  paint with the batting team's accent / cap colors without a full
  Team object.
- `/ui/portrait.ts` widened its team parameter to accept either a
  `Team` or a structural `{ colors: TeamColors }` record. The existing
  `/ui/menu-player.ts` call (which passes a real Team) is unaffected.

### `/app/main.ts` — two-phase live-game build

The live-day games used to be built in one pass (event log + scene
context together). Now we build them in two phases:

1. Simulate every live game's events.
2. Roll all games (history + live) into `aggregatesWithLive`, then
   build `LeagueHistory` from the prior-season summaries.
3. Mint a SceneContext per live game wired to both maps.

This unlocks step (3): the SceneContext can carry season aggregates
and career BvP that include the very games being played back. Slightly
weird in principle (we're showing season stats that already include
the at-bat about to happen) but the right call for a screensaver —
matches the "broadcast highlights" feel and avoids a per-frame slice.

## Tests

`88/88` pass. Three new tests in `stats/aggregator.test.ts`:
- BvP matchups accumulate across days; some pairs reach ≥2 PA.
- Per-matchup invariants: AB ≤ PA, AB + non-AB events ≤ PA, hit
  decomposition ≥ 0.
- The sum of every matchup's PA for a given batter equals their
  top-line PA (consistency lock).

One new test in `season/history.test.ts`:
- A (batter, pitcher) pair that meets in two simulated seasons has its
  career BvP row equal to the sum of the two season rows (PA, AB, H,
  HR all check).

The existing `render/scene.test.ts` continues to pass without changes —
the new optional `SceneContext` fields default to absent in those
fixtures, and the new `SceneState` fields are simply `null`.

## Display thresholds

- **Season line.** Always shown when `seasonBatterStats` is non-null
  (i.e., the batter has at least one PA in the season). Day-1 games
  start before any stats accumulate; the line just hides until the
  first PA fires.
- **BvP line.** Shown only when combined PA ≥ 3. Below that it's noise
  ("1-1 1.000" reads as a sample-size lie). Easy to retune the
  constant in `hud.ts` if it feels off after watching a few games.

## Out of scope (deliberate)

- **Splits in the BvP line** (career home/away, vs LHP/RHP for a
  batter against a pitcher). The on-canvas card's a one-line summary;
  splits live in the menu.
- **Pitcher stats on the card.** The `pitcherStats` field already
  exists on `SceneState` for the line score; the batter card stays
  batter-focused.
- **Animation when the matchup line first appears** (e.g., the way a
  broadcast slides in a stat strip). The current pass is a cut — the
  line just shows up when the batter changes.
- **Aging / retirement / cross-year career nuance.** `careerBvp`
  accumulates whatever prior seasons are pre-simulated at app boot
  (`PRIOR_SEASONS` query param, default 1). Real persistent careers
  land later when /persist gets disk save.
