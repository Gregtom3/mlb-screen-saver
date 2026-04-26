# Phase 4 — Stadium Identity + Polish (in progress)

Date: 2026-04-26

This phase is partially landed. The architectural piece — letting
stadium quirks actually shift the simulation — is in. The atmospheric
pieces (audio, day/night, weather, chiptune, idle/wake) are still
ahead.

## What ships in this pass

- **Stadium-quirk plugin registry** (`/sim/stadium-effects.ts`).
  Each `StadiumQuirk` variant maps to a `QuirkAdjustments` record
  carrying multipliers on HR, double, and triple probability rolls.
  `simulateInPlay` reads the active stadium's quirk via the threaded
  `GameInput.stadiumQuirk` and applies the multipliers before rolling
  the outcome dice. Quirks shift *odds*; they never fabricate outcomes.
- **Wired quirks**:
  - `short-porch` — HR boost scales with how short the porch is
    (closer wall ⇒ bigger boost), small double-rate boost too.
  - `altitude-thin-air` — Coors-style HR + triple boost scaled by
    elevation above 1500 ft.
  - `wind-tunnel` — out-direction +18% HR, in-direction -18% HR,
    cross-wind neutral (wired in for spray effects later).
  - `deep-center` — HR rate cut, triples slightly bumped (would-be HRs
    that stay in the park).
  - Cosmetic-only quirks (`ivy-wall`, `hill-cf`, `pond-beyond-rf`,
    `clock-tower-in-play`, `mascot-statue`) return `NEUTRAL_ADJUSTMENTS`
    until a future pass adds e.g. ricochet rules for ivy / clock tower.
- **Plumbing**:
  - `GameInput.stadiumQuirk?: StadiumQuirk` — the runtime hook, opt-in
    so existing tests don't need backfilled stadiums.
  - `/app/main.ts` and `/app/play-game.ts` both pull `stadium.quirk`
    from the league snapshot and pass it through.
- **Tests**: 5 unit tests in `/sim/stadium-effects.test.ts` cover
  cosmetic neutrality, distance-scaled short porches, altitude
  proportionality, wind-tunnel direction signs, and the deep-center
  HR↔triple swap.

## What is deliberately NOT in Phase 4 yet

- **Day/night rendering.** Stadium dayGameBias is in the data but the
  renderer doesn't toggle a sky / lighting mode yet.
- **Weather effects.** No wind-by-time-of-day, no rain delays, no
  visibility cuts.
- **Crowd density curves & home-heavy / late-arrivers atmosphere.**
  Stadium atmosphere has these fields but the renderer ignores them.
- **Chiptune SFX + ambient crowd.** This is a whole `/audio` module
  bring-up — bat crack, glove pop, scattered crowd, organ riff.
  Subscribes to the same SimEvent stream the renderer already
  consumes.
- **Side-switching animations** (offense/defense walking off and on
  between innings).
- **Screensaver idle/wake.** Detect inactivity, dim the HUD, fade in
  on wake.

These are the substantial remaining items in Phase 4 proper. They each
warrant a focused pass.

## Test invariants

- All 30 tests green (5 new in `stadium-effects.test.ts`).
- Sim determinism is preserved: same seed + same input + same quirk →
  same events. Stadiums without quirks (or unwired ones) produce
  identical events to before this pass.

## Notable architectural choices

- **Multipliers, not bypass.** Quirks shift the same outcome roll the
  league baseline uses. No quirk can mint a HR; it can only nudge the
  probability. Keeps determinism intact and makes balance easy to
  reason about.
- **Quirk on `GameInput`, not `Player` or `Team`.** Quirks are about
  the venue, not the participants. The renderer already has the same
  Stadium record for visuals, so the data flows cleanly.
- **Cosmetic quirks return `NEUTRAL_ADJUSTMENTS`.** Ivy walls and
  mascot statues can't shift HR rates today, but the registry hook is
  there: when the renderer learns to ricochet a ball off the ivy,
  this is where the matching sim-side rule will live.
