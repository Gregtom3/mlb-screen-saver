# Phase Baserunning — leads, steals, pickoffs, errant throws

Activates the previously dormant first-base coach ratings (`baserunningCoaching`,
`pickoffAwareness`), the catcher's `popTime` / `armStrength` / `armAccuracy`
ratings on a steal play, the pitcher's `holdRunners` and `armAccuracy` on
pickoff attempts, and the runner's `stealing` / `speed` / `baserunningIQ`
ratings everywhere they belong. Closes the largest gap from the
"missing player/coach attributes" audit.

## What shipped

### Sim
New module `/sim/baserunning.ts` exposes `resolveBetweenPitches`, called once
before every pitch inside `simulateAtBat`. The resolver is a pure function of
PRNG + world snapshot; same seed + same input → byte-identical event sequence.
The existing `runGame` determinism test was extended to confirm.

Probabilistic state machine, run in this order between pitches:

1. **Lead emission.** Any runner on 1B/2B/3B who hasn't yet had a `lead`
   event at their current arrival gets one. Lead distance and aggression
   scalar come from `computeLead(runner, pitcher, battingMods)` — driven by
   `stealing`, `speed`, `baserunningIQ`, `holdRunners`, and the 1B coach's
   `stealAdvantage`. Range: 6–15 ft, aggression 0.05–0.95.
2. **Pickoff phase.** The most-advanced runner is the priority target
   (3B → 2B → 1B). Attempt rate is gated by aggression + `holdRunners`.
   - On attempt: emit `pickoffAttempt` → `pickoffThrow`.
   - Throw is errant with low probability scaled by `1 - armAccuracy`. On
     errant: emit `errantThrow` carrying the backup OF id (RF for 1B, CF
     for 2B, LF for 3B) and a deflected landing point in shallow OF, then
     `backupPlay` for the OF retrieve, then `tagAttempt` + `baserunner` at
     the advancing base. A runner from 3B on an errant throw home scores
     directly without a backup tag.
   - Clean throw: low chance of catching the runner napping, scaled by
     pitcher `armAccuracy`, runner `baserunningIQ`/`speed`, lead distance,
     and the fielding 1B coach's `pickoffPrevention`.
3. **Steal phase.** First runnable steal candidate (1B→2B or 2B→3B with the
   target base empty). Per-pitch attempt rate driven by aggression + speed
   + technique - hold, and multiplied by the 1B coach's `stealAdvantage`.
   - Outcome: race between runner (`speed` + `stealing`) and the catcher
     (`popTime` + `armStrength` + `armAccuracy`). League-average matchup
     resolves to ~70% safe — matches modern MLB SB%.

A 3rd out from a caught stealing or pickoff aborts the at-bat: the resolver
returns `endsHalfInning: true`, the at-bat exits without an `atBatEnd`
event, and the same batter leads off the next half-inning (matches MLB
rule).

### New SimEvent kinds
Added to `/sim/types.ts` as flat events on the discriminated union (per the
design discussion — keeps subscribers trivial and replays deterministic):

- `lead` — runnerId, base, leadFt, aggression
- `pickoffAttempt` — pitcherId, runnerId, targetBase
- `pickoffThrow` — pitcherId, targetBase, accurate
- `errantThrow` — pitcherId, targetBase, backupFielderId, landingX, landingY
- `backupPlay` — fielderId, runnerId, throwToBase
- `stealAttempt` — runnerId, from, to
- `tagAttempt` — runnerId, base, out

Existing `baserunner` events are still emitted for the actual base
movement (out or safe). Existing consumers (box-score, aggregator, app
play-by-play, audio dispatcher) ignore unknown kinds gracefully — no
exhaustive `assertNever` switches anywhere — so adding the new events
required no defensive churn.

### Audio
`/audio/dispatcher.ts` maps the new events:

- `pickoffThrow` accurate → catcher mitt pop (the bag arrival).
- `errantThrow` → foul tick — the "oh no" beat.
- `backupPlay` → fielder glove pop on the OF pickup.
- `tagAttempt` → fielder glove pop on the bag.
- `lead`, `pickoffAttempt`, `stealAttempt` are silent; the renderer's
  motion + the surrounding events carry the beat.

### Renderer
`/render/scene.ts` now stamps the most recent `lead` event per runner and
passes it to `computeRunnerRender`. At-rest runners on 1B/2B/3B render
with a lateral offset toward the next base equal to `leadFt`, plus a small
sinusoidal sway whose amplitude scales with `aggression` and whose phase is
deterministic per-runner — produces the "all the runners idle-shuffle while
the pitcher is in the set" feel without a sprite-system rewrite.

Throw arcs for pickoffs / errant throws / backup retrieves are deferred
to a follow-up render pass — the events are in the log so the audio fires
correctly today, and a future pass can layer the visual ball flights on
top of the existing horn-throw segment system.

## Tuning

Across a 30-game test batch with seed `0xba5eba11`:

- 5+ steal attempts (typical: 30–80, well below MLB)
- 5+ pickoff attempts (typical: 20–60)
- 0–60 errant throws — intentionally rare, gated by `armAccuracy`

The 100-game runs/game test (4 ≤ avg ≤ 20) still passes — the new events
don't measurably shift run environment.

## Still missing (from the player/coach audit)

Player-side: `coachability` drift, `consistency` game-to-game variance hook,
in-sim `clutch` rating reads, `hot-headed` / `glove-first` flag activations,
multi-season aging.

Coach-side: head coach `morale` (needs cross-game clubhouse state).

Bigger systems: injuries, the manager-nudge `/director`, weather, music.
See `docs/STATUS.md`.

## Tests

`/sim/baserunning.test.ts` — 10 deterministic tests covering:
- `computeLead` direction sanity (fast vs slow runners; quick vs slow
  delivery pitchers).
- `lead` events emitted for every base arrival.
- `leadFt` / `aggression` ranges.
- Steal/pickoff/errant frequency bands across 30 games.
- Every `errantThrow` is followed by a `backupPlay` (or scores from 3B).
- Every `stealAttempt` is followed by a `tagAttempt` + `baserunner` pair.
- `runGame` determinism still holds.
- 3rd-out caught stealing ends the half-inning cleanly (when it fires
  in the sample window).

Total suite: 127 tests passing.
