# Strike Zone Viewer + Per-Player Zone Identities

Date: 2026-04-27

A targeted pass that takes a sim feature already in the event log
(`pitch.locationZone`) and surfaces it three ways:

1. An **8-bit strike zone viewer** in the live HUD. Every pitch in the
   current at-bat plots as a colored marker inside (or just outside) a
   3×3 zone box.
2. **Per-player zone identities.** Each pitcher carries a stable
   `pitcherTendencies` heat map; each batter carries a stable
   `batterZonePrefs` xBA grid. Both are generated once at player
   creation, never mutate, and feed the sim so a fastball thrown into
   a pull hitter's hot zone really does end up as more barrels.
3. **Sample-gated views in the player menu.** Pitchers unlock a heat
   map after 50 pitches; batters unlock per-zone xBA cells after 4 ABs
   in that cell. Until then the panels stay hidden — the screensaver
   vibe is "stats fill in as the season runs".

Per-player **listed height** also lands in this pass. It drives a tiny
sprite-size variance (~±8%) so the field shows visible variety, and
nudges the strike-zone viewer's box height so a 5'7" hitter and a
6'5" hitter visibly differ.

## What ships

### `/world/types.ts`

- `ZoneIndex` and `ZoneTuple` — the shared 0..9 grid (0 = outside, 1-9
  = top-left → bottom-right row-major). Renderer, stats, sim, and
  HUD all use this convention.
- `Player.heightFt: number` — listed height in feet.
- `Player.pitcherTendencies?: { zoneWeights }` — only on pitchers; a
  10-tuple of unnormalized zone weights.
- `Player.batterZonePrefs: { xBA }` — every player carries one (catches
  position-player pitchers and DH cases).

### `/content/player-init.ts`

- `generateHeightFt` — bell-curve mean 6.05 ft, light position bias
  (P/1B/DH skew tall, 2B/SS/CF skew short).
- `generatePitcherTendencies` — picks one of five archetypes (high
  inside, down-and-away, low sinker-ball, high heater, generic
  middle), centers a Gaussian blob there, jitters per cell, and lets
  groundball/velocity ratings nudge the blob low/high.
- `generateBatterZonePrefs` — picks a sweet quadrant (contact hitters
  trend middle/away, power hitters split inner/outer halves), mirrors
  it for L bats, flatter for switch hitters; the contact+power average
  scales the baseline so good hitters feast harder.

All three flow through the team-forked PRNG so `generateInitialLeague`
stays deterministic.

### `/sim/game.ts`

- `pickInZoneLocation` — when `simulatePitch` decides the pitch is in
  the zone, sample 1..9 weighted by `pitcherTendencies.zoneWeights`
  instead of uniform. Falls back to uniform for pitchers without a
  tendency (e.g. emergency position-player pitchers).
- `xBAMultFor` — the batter's preference at the pitch's location is
  threaded into `simulateInPlay`, scaling HR / double / single rates
  by `(1 + (xBA - 1) * scale)`. The scale is small on purpose — the
  zone grid is one input among many, not a dominator.

### `/stats/types.ts` and `/stats/aggregator.ts`

- `PitchingLine.pitchesByZone: number[]` — count of pitches thrown in
  each cell, incremented on every `pitch` event.
- `BattingLine.zone: ZoneBattingCell[]` — per-cell PA / AB / H / HR
  for the hitter, attributed to the **last pitch** of the at-bat
  (the one that produced the outcome). Pitch-count exposure tracks
  separately.

### `/render/scene.ts`

- `StrikeZoneViewerInfo` — the reducer captures the pitch sequence
  for the current at-bat (cleared at every atBatEnd / inningEnd) plus
  the active batter's `heightFt`. Capped at the most recent 12
  pitches so long fouled-off ABs don't blanket the grid.
- `ScenePlayer.heightScale` — derived from `player.heightFt`; the
  sprite renderer multiplies the shared `SCALE_PX_PER_FT` by it.

### `/render/hud.ts`

- New `drawStrikeZoneViewer` panel. 96px wide, sits between the
  batter card and line score:
  - 3×3 box drawn with crisp pixel grid lines.
  - Box height varies with batter listed height (1.7 ft reference,
    bounded 1.3–2.1 ft).
  - One colored block per pitch: green = ball, red = strike (looking /
    swinging / foul-tip), amber = foul, yellow = in-play, purple = HBP.
  - Older pitches fade; the most recent gets the strongest alpha and
    a small glyph (· × / ★) for at-a-glance reading.
  - Out-of-zone pitches splay around the perimeter (one side per
    sequential ball, so consecutive chase pitches don't pile up).
  - Footer legend: B / K / F / IP color swatches.

### `/ui/menu-player.ts` (+ `index.html` CSS)

- **Pitcher** view, after 50 pitches: a 220×240 canvas heat map.
  Each cell is tinted blue→orange by share of in-zone pitches and
  labeled with raw count + percentage. The margin around the box is
  tinted by the chase-pitch share (a high-control pitcher's halo
  stays cool; a wild reliever's glows orange).
- **Batter** view, once any cell has at least 4 ABs: a 3×3 grid of
  AVG values, tinted green/red around a .250 reference. Cells
  below the floor stay dim with their AB count visible — the
  feature reveals itself as the season fills in.
- Both panels have inline captions explaining what unlocks them and
  the sample size required.

## Tests

- Existing 75-test suite: green.
- New 2-test block in `sim/game.test.ts`:
  - `every in-zone pitch lands in 1..9, every out-of-zone pitch is 0`
    — sanity check the new `pickInZoneLocation` doesn't leak invalid
    zones into the event log.
  - `the same pitcher fingerprint produces a recognizable in-zone
    bias` — over 30 games, ≥60% of pitchers with ≥60 pitches show a
    hot/cold ratio of at least 1.5×. Uniform sampling would not.
- Determinism preserved: `generateInitialLeague(seed)` still
  byte-identical across runs (pure rolls, no clock or env reads).
  `runGame(input)` still byte-identical for the same seed.

## What's intentionally not in this pass

- **In-game pitcher heat-map updates.** The aggregator only runs once
  per finished game (Phase 5.5 contract). Live mid-game heat maps
  would need a separate live aggregator, which is out of scope.
- **Catcher framing on locationZone.** Framing rating exists on
  catchers; biasing called-strike calls based on framing × zone is a
  natural follow-up but not wired here.
- **Strike-zone width variance.** Only the height bends with the
  batter — width stays constant. Real MLB rule keeps width fixed
  too, so this matches reality.
- **Per-pitch sound effects in the viewer.** The audio dispatcher
  already fires SFX off the pitch event; the viewer doesn't yet
  flash on the same beat. Nice-to-have but not required.

## Notable architectural choices

- **Zone convention shared across all five subsystems.** One numbering
  rule (0 outside, 1..9 top-left to bottom-right row-major) lives in
  `/world/types.ts`. Sim emits it, stats fold it, renderer plots it,
  HUD shows it — none of them invent their own convention.
- **Stable per-player data, not per-game state.** Tendencies and
  preferences are generated once with the team-fork PRNG and never
  mutate. This keeps the sim determinism contract intact and means a
  pitcher's heat map shape is recognizable from year one.
- **Sample-size gates rather than empty tables.** The menu doesn't
  show a noisy 3-pitch heat map; it tells the user the panel will
  unlock as the season runs. Matches the "screensaver that happens to
  be a baseball league" framing in the brief.
- **Sim integrity: zone effects are multiplicative on the same
  outcome roll, not a separate fork.** A pitch into a hitter's hot
  zone bumps HR/double/single rates by a few points each; it never
  mints an outcome that wouldn't otherwise have happened.
