# Phase 4 — Fence-aware home runs

A sim-side pass that closes the gap left open by `PHASE_4_STADIUM_VISUALS`:
the renderer was drawing per-stadium wall arcs from each park's actual
dimensions, but the sim was rolling home runs from a probability table
that didn't see the wall — so a HR-shaped trajectory that landed past
Madison's 425-ft fence still counted, while a borderline fly toward
Tide Park's 308-ft RF was no more likely than anywhere else. After this
phase, geometry filters borderline cases: a rolled HR whose synthesized
trajectory falls short of the wall is downgraded to a wall-ball double
or a wall-saving flyout, depending on launch angle. Park factors are now
emergent from geometry instead of declarative multipliers.

## What changed

- **New `/world/stadium-geometry.ts`** — pure geometry over `StadiumDimensions`,
  consumed by both `/sim` (scalar `wallDistanceAtAngle`) and `/render`
  (polyline `buildWallPath` / `wallPointAt`). The renderer's `wall.ts` is
  now a thin re-export. This satisfies the architectural rule that `/sim`
  cannot import from `/render`.
- **`GameInput.stadiumDimensions?: StadiumDimensions`** — optional. When
  provided, `simulateInPlay` runs the geometry filter on rolled HRs.
  Optional so tests and ad-hoc fixtures without a Stadium record keep
  working (the absence falls back to no filter, matching the legacy
  pre-phase behavior).
- **Geometry filter in `simulateInPlay`** — after `buildBallPath`
  produces a trajectory for a rolled `home-run`:
  1. Compute spray angle and landing distance from `ballPath.landingX/Y`.
  2. `effectiveWall = wallDistanceAtAngle(dims, spray) + wallHeightFt * 1.5`.
     The 1.5×height shortcut models a tall wall stopping clears it
     wouldn't on a 6-ft fence — Sapwood's 18-ft wall, Beacon Field's 22-ft.
  3. If `landing < effectiveWall`:
     - `launchAngleDeg > 28` AND `landing >= effectiveWall - 30` → `'flyout'`
       (caught at the warning track).
     - Otherwise → `'double'` (off-the-wall).
- **Base HR rate bump** — the geometry filter eats ~5-8% of rolled HRs
  in average parks. To keep league-wide HR/G in the same band as before,
  the base term in the HR probability moved from `0.04` → `0.043`.
- **Quirk-registry cleanup** in `/sim/stadium-effects.ts`:
  - `short-porch.hrRateMul` deleted (was `1.08–1.26`). The HR uptick
    now emerges from the actual short fence — a 308-ft porch produces
    more HRs because the trajectory check is friendlier there.
  - `deep-center.hrRateMul` deleted (was `0.82–1.00`). Same logic in
    reverse — a 425-ft fence rejects more borderline HRs naturally.
  - Both retain their non-HR effects: `short-porch.doubleRateMul = 1.05`
    (off-the-wall flavor) and `deep-center.tripleRateMul` (deep gaps
    still reward speed independent of HRs).
  - `altitude-thin-air` and `wind-tunnel` keep their multipliers.
    They model carry/physics rather than pure geometry; reworking them
    as ballistics modifiers is a separate phase.

## Files

**New:**
- `/world/stadium-geometry.ts` — geometry helpers + `PLACEHOLDER_DIMENSIONS`.

**Modified:**
- `/render/wall.ts` — thin re-export from `/world/stadium-geometry`.
- `/sim/types.ts` — `GameInput.stadiumDimensions` field.
- `/sim/game.ts` — fence-aware HR check; base rate 0.04 → 0.043; threading.
- `/sim/stadium-effects.ts` — remove redundant HR multipliers, retain flavor multipliers.
- `/sim/stadium-effects.test.ts` — assertions updated to match neutral `hrRateMul`.
- `/sim/game.test.ts` — three new park-effect tests.
- `/app/main.ts` + `/app/play-game.ts` — pass `stadium.dimensions` through.

## Tests

`84/84` pass. The three new tests in `sim/game.test.ts > fence-aware home runs`:

- **Short park vs deep park** — same seeds, same teams, two synthetic
  parks (305-ft / 8-ft wall vs 380-440-ft / 18-ft wall). Asserts
  `short.hr / deep.hr > 1.3`. In practice the ratio sits around 1.6–2.0.
- **Wall-ball downgrades exist** — deep park produces strictly more
  combined doubles + flyouts than the short park (the borderline HRs
  have to go somewhere).
- **Neutral-park HR/G stability** — calibration lock. Comparing the
  legacy `stadiumDimensions: undefined` path against
  `PLACEHOLDER_DIMENSIONS` over 50 games each: HR ratio in [0.75, 1.25]
  and run-environment ratio in [0.85, 1.15]. Catches base-rate drift
  if the constant is later retuned.

The pre-existing `runGame sanity > 100-game batch produces plausible
average runs per game` test continues to pass with the bumped base —
runs/game stayed inside the existing `(4, 20)` band.

## Determinism & replay

Same seed + same `GameInput` produces byte-identical events still — the
geometry filter is a deterministic function of `ballPath` and
`dimensions`, both already deterministic.

A game simulated under the old rules and re-simulated under the new
rules WILL differ in HR count and box score. `/persist` is in-memory
only and prior seasons are simulated fresh on app boot, so no saved
historical record is at risk. Treat this as a sim version bump; future
on-disk persistence will need to capture the sim version alongside the
seed.

## Out of scope (still)

- **Foul-line geography in the sim.** Fouls are still rolled at the
  pitch level. Adding spray-angle gating is a larger refactor (changes
  the `PitchResult → AtBatOutcome` flow).
- **Wind/altitude as ballistics modifiers.** Still rate multipliers.
  Reworking them to scale `BallPath` distance (so a thin-air park's
  flies actually carry farther through the same geometry filter) is the
  natural next phase.
- **Defense-reaches-the-ball model.** The wall-saving flyout in this
  phase is just an outcome label — there's no fielder physics check
  that the LF/CF/RF actually reaches the ball at the wall. The choreo
  still handles the long fly because `fielderPositionFor` already maps
  spray to OF position.
- **Wall-ball ricochet animation.** A wall-ball double currently plays
  the same renderer choreo as any other double; the BallPath's
  HR-shape distance means the OF chases it deep, which reads correctly
  enough at screensaver scale.
- **Full physics-first sim.** Outcome is still rolled first, ballpath
  synthesized second; the geometry filter only post-processes HR rolls.
  A truly physics-first sim where outcome derives from ballistics + the
  fielder's reach is a much larger phase.
