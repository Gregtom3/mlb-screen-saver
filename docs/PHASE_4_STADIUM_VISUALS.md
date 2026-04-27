# Phase 4 — Stadium Visuals

A visual-only pass that flesh out the placeholder ballpark drawn in Phase
2/3 and finally pays off the rich stadium data already sitting in
`/world` and `/content`. Strictly cosmetic — `/sim`, `/world`, and
`/season` are untouched. The renderer is still a pure function of the
event log + simTime; the new chrome layers are deterministic and read
only from the immutable Stadium record + a few scene aggregates
(`inning`, `simTime`).

## What shipped

- **Per-stadium wall arc** — `buildWallPath` interpolates the polyline
  from each stadium's `dimensions.left/leftCenter/center/rightCenter/right`
  using a cosine ease, replacing the hardcoded `OUTFIELD_DEPTHS`. Tide
  Park's 308-ft RF reads visibly short; Glacier Hollow's 425-ft CF reads
  visibly deep.
- **Warning track** — a 10-ft tan band stroked along the wall path, with
  a 1-px darker inside edge.
- **Foul poles** — yellow vertical lines at the foul-line / wall corners,
  with a small umpire-screen arrow and a red pennant flag that ripples
  deterministically from `simTime`. Wind-tunnel quirks pump the
  ripple amplitude.
- **Outfield wall** — the existing stadium frame band + dark outline,
  now drawn from the per-stadium polyline.
- **Backstop arc** — a thin gray arc behind the catcher.
- **Dugouts** — two recessed dark rectangles flush with the backstop,
  with a roof lip, a hint of bench, and a 1-px team-color trim.
- **Batter's boxes** — chalk rectangles at both sides of the plate,
  always drawn (regardless of who's batting), plus a half-rectangle
  catcher's box.
- **On-deck circles** — chalked rings between the dugouts and the boxes.
- **Outfield bleachers + home-plate bowl** — two bands of stands using
  the per-team `seatPalette`. Fan-pixel speckle scatters above the band
  at a density driven by `crowdDensityCurve` (`home-heavy`, `flat`,
  `late-arrivers`) and the current inning. Subtle ambient flicker every
  ~6 sim ticks. Fully deterministic — frames are byte-reproducible.
- **Grass-pattern registry** — `plain`, `radial`, `striped`,
  `checkerboard`, and `ringed` are now actually drawn (previously only
  `plain` rendered). Dispatched on `atmosphere.grassPattern`.
- **Stadium-cosmetics registry** — mirrors the shape of
  `/sim/stadium-effects.ts:adjustmentsFor()`. Each `quirk.kind` maps to
  a draw function; `phase` (`beyond-wall` | `on-wall` | `in-field`)
  picks the right layer:

  | Quirk                  | Visual                                                   |
  |------------------------|----------------------------------------------------------|
  | `short-porch`          | "308" sign painted on the foul-side wall                 |
  | `deep-center`          | "425" sign painted on the CF wall                        |
  | `ivy-wall`             | 1-px green-noise ivy texture on the named segment        |
  | `hill-cf`              | 3-step pixel-terraced grass slope into CF                |
  | `pond-beyond-rf`       | Blue water with rippling pixels + a docked rowboat       |
  | `clock-tower-in-play`  | Tower past CF with a slow-moving clock hand              |
  | `altitude-thin-air`    | Mountain pixel silhouette behind the wall, snowcaps      |
  | `mascot-statue`        | Pedestal + statue sprite atop the named wall             |
  | `wind-tunnel`          | Loose paper pixels drifting across the field             |
- **Day / night per game** — `dayGameBias` finally consumed: a stable
  hash of `gameId` picks day/dusk/night, with a brighter cyan sky on
  day games and the existing dark home-color blend at night.
- **Viewport** — the camera now reserves headroom above the deepest
  wall for stands and sky (470 ft / 270 ft instead of 420 / 240), so
  the field fills the screen instead of leaving a gap above the wall.

## Architecture

`drawField` is now a layered sequence:

1. Sky / night-color band
2. Distant silhouette (mountains, ponds, clock tower — quirk-driven)
3. Outfield bleachers + crowd speckle
4. Outfield wall (per-stadium arc)
5. Outfield grass + selected pattern (clipped to fair territory)
6. In-field quirk decorations (hill-CF, wind-tunnel papers)
7. Infield dirt arc + grass cutout + mound
8. Warning track (tan band along the wall)
9. On-wall quirk decorations (ivy, distance signs)
10. Foul poles + flags
11. Foul lines
12. Home-plate bowl stands (sit behind dugouts)
13. Backstop, dugouts, batter's boxes, on-deck circles
14. Bases + home plate

The new modules:

- `/render/wall.ts` — `buildWallPath`, `wallPointAt`,
  `PLACEHOLDER_DIMENSIONS`.
- `/render/grass-patterns.ts` — `drawGrassPattern` registry.
- `/render/stadium-chrome.ts` — `drawWarningTrack`, `drawFoulPoles`,
  `drawDugouts`, `drawBatterBoxes`, `drawOnDeckCircles`, `drawBackstop`,
  `drawOutfieldWall`.
- `/render/crowd.ts` — `drawOutfieldStands`, `drawHomeBowlStands`,
  `densityForInning`. Stochastic decisions go through `hash32(simTime,
  seatIndex)` so frames at the same simTime are byte-identical.
- `/render/stadium-cosmetics.ts` — `drawStadiumCosmetic(quirk, args)`
  registry, `flagAmplitudeFor(quirk)`.

`SceneContext` now carries an optional `stadium: Stadium` and
`homeTeamPrimary: string` so the field draw layers can read the
canonical record. Optional so existing tests that build a context
without those fields keep passing — the renderer falls back to
`PLACEHOLDER_DIMENSIONS` and the legacy ballpark look.

`drawField`'s call site in `/render/loop.ts` was reordered so
`buildScene` runs first; `simTime` and `inning` flow into the field draw
for crowd density and ambient animation. The scene reducer is
unchanged.

## Determinism

Same `(events, simTime)` produces the same `SceneState` (existing
test). Same `(stadium, simTime, inning)` produces the same field
pixels — verified by inspection: every random draw goes through
`hash32(seed, simTime)` with no use of `Math.random` in the new
modules. Crowd flicker uses `floor(simTime / 6)` epochs, so two
consecutive frames at the same simTime show the same flicker state.

## What didn't ship (deliberately)

- **Fence-distance gating in the sim.** A "home-run" outcome that lands
  short of the fence still counts as a HR; a non-HR ball that visually
  settles past the wall still counts as whatever the sim rolled. This
  is the documented Phase 5+ candidate; would change determinism
  contracts and break `/sim/stadium-effects.test.ts`.
- **Foul-line geography in the sim.** Fouls are still rolled at the
  pitch layer.
- **Wave-burst on home runs.** The crowd module exposes
  `waveCenterAngleDeg` / `waveStrength` parameters but the field
  caller doesn't pump them yet — kept simple per the "subtle ambient"
  scope.
- **Per-fan portrait animation, mascot dances, scoreboard flips.**
- **Weather particles** beyond the wind-tunnel paper drift.
- **Audio.** Separate `/audio` module.

## Tests

All 81 tests pass. New modules are pure draw code (Canvas2D side
effects only) and are covered indirectly by the existing
`render/scene.test.ts` determinism tests, which confirm the SceneState
contract is preserved.
