# Phase 4 — Crowd Ambience

Pass landed: 2026-04-27. Branch: `claude/improve-crowd-ambience-dyzRW`.

The home crowd was silent and the bowl was static. STATUS.md tracked that as
"No ambient crowd loop, no chiptune" against `/audio`, and the visual
`crowd.ts` already plumbed a wave-lift system (`waveCenterAngleDeg`,
`waveStrength`) that was never called. This pass turns the crowd into a soft,
persistent presence that adapts to plays, results, and the anticipation of a
particular batter — with audio reactions and visual reactions reading from
the **same** continuous signal so they never drift.

## What shipped

### A new `/ambience` module

The architectural risk in Phase 4 was bolting reactive crowd code onto both
`/audio` and `/render` and watching them drift. The new module sits between
`/sim` and the consumers and owns the crowd model:

```
/sim ──► SimEvent[] ──► /ambience ──► CrowdState (continuous + pulses)
                                         │
                                         ├──► /audio (bed, reactions, walk-up)
                                         └──► /render (wave, lights, density)
```

`/ambience` imports `/sim/types`, `/world/types`, and (read-only) `/stats`
aggregates for star-set derivation. It does not import `/audio`, `/render`,
`/ui`, or `/app`.

Files added under `/ambience`:

| File | What it does |
|------|--------------|
| `state.ts` | `CrowdState` (energy / arousal / mood / attention) + `ReactionPulse` taxonomy. |
| `reducer.ts` | `createAmbienceReducer({ home, away, stars }).step(events, dt) → { state, pulses }`. Mirrors enough game state (inning, count, outs, bases, score, batter id) to apply trigger logic. |
| `leverage.ts` | Closed-form leverage 0..1 from (inning, outs, score, bases). Ported from `/stats/wp.ts:43–51` so `/stats` isn't on the per-frame path. |
| `star.ts` | Top-N derivation per home/away team. Uses `SeasonAggregates.batting.HR` if available, falls back to `power + contact + clutch` composite. |
| `wave.ts` | Wave-envelope tracker — pulses with `centerAngleDeg` spawn an attack/sustain/release envelope that the renderer reads each frame. |
| `reducer.test.ts` | 9 fixed-input tests covering walkup-once-per-batter, two-strike-clap arming, home-vs-away cheer routing, decay over time, blowout vs. tied late-game energy, determinism. |

### Audio bring-up

Bus changes (`audio/bus.ts`):

* Four channel groups under `master`: `sfxGain`, `reactionGain`, `bedGain`,
  `walkupGain`, with per-group baseline levels so the bed sits quietly under
  reactions and SFX read on top of both.
* Side-chain ducker — `duckBed()` and `duckWalkup()` schedule a brief gain
  ramp with attack/release. SFX (`batCrack`, `catcherMittPop`,
  `fielderGlovePop`) and crowd reactions call them at fire time so the wash
  never masks transients.
* `makePinkNoise()` — pink-noise buffer factory (Voss-McCartney) used by the
  bed and the louder reaction layers.

New audio submodules:

* **`audio/bed.ts`** — sustained crowd bed: pink-noise murmur through a
  bandpass + LFO, a thin highpassed hiss layer, and a breathy formant pad.
  `setBedFromState(crowdState)` re-aims gain + filter values each frame from
  the live state — no reactions break, no hard cuts.
* **`audio/reactions.ts`** — eight pulse synths: `roar()`, `cheer()`,
  `oo()`, `gasp()`, `groan()`, `rallyClap()`, `twoStrikeClap()`,
  `applauseTail()`. Procedural, no samples.
* **`audio/walkup.ts`** — per-batter chiptune jingle generator. Player id +
  team color seeds a deterministic mulberry32 melody (square-wave +
  triangle sub + optional noise hi-hat for stars). 4–12 notes scaled by
  intensity. Cuts under the first pitch via `stopWalkup()`.

Dispatcher (`audio/dispatcher.ts`) gained an `applyAmbience(tick)` entry
point that fans pulses to the appropriate synth and pushes the bed state.
The legacy `dispatch(events)` path is untouched.

Audition page (`audio/audition.ts`) grew rows for every reaction kind, a
walk-up sample player, and a bed control panel with energy / arousal /
attention sliders that live-tune the bed.

### Renderer

* **`render/crowd.ts`** — `drawTierFans` now takes a flicker threshold and a
  front-row arousal lift. Active wave envelopes (passed through `field.ts`)
  drive the existing wave-lift code that previously sat dormant. A
  `crowdModsFor(state)` helper produces a quantized density multiplier so
  high-energy moments fill marginal seats without churning per-frame
  hashes.
* **`render/sky.ts`** — tower halos brighten with `state.energy`, fatten +
  flash on `state.arousal`, and the horizon-glow color blends up to 6%
  toward the home team's primary color when `state.mood` swings home.
* **`render/field.ts`** — `FieldDrawOptions` now accepts `crowdState`,
  `waveCenterAngleDeg`, `waveStrength`. Forwards them to the bowl draws and
  the sky.
* **`render/loop.ts`** — added `onTick(dt, events)`, `getCrowdState()`,
  `getWaveEnvelope()` hooks. The loop stays presentation-only; ambience
  state is owned by `/app`.

### App wiring

`app/main.ts` builds an `AmbienceReducer` + `WaveTracker` per channel and
swaps them on channel change. The render loop's `onTick` runs the reducer,
spawns waves from new pulses, advances envelopes, and pushes both into the
SFX dispatcher's `applyAmbience()`. The renderer reads `getCrowdState()` /
`getWaveEnvelope()` once per frame.

A `buildStarSet({ homeTeamPlayers, awayTeamPlayers, aggregates })` call uses
the live-day aggregates so a fan-favorite carries across both audio
(louder walk-up + arousal pop on entrance) and the visual (stage-set
reaction strength).

## Reaction taxonomy

| Trigger | Pulse(s) | Side |
|---------|----------|------|
| `gameStart` | `applause-tail` (warm welcome) | home |
| New batter | `walkup-start` (longer if star) | batting team |
| 2-strike count, home pitching | `two-strike-clap` (once per entrance) | home |
| Hard-hit contact (≥95 mph) | `oo` (home batting) / `gasp` (away batting) + wave at landing angle | home / all |
| Home-team home run | `roar` + `applause-tail`, mood↑↑, energy↑ | home |
| Away-team home run | `groan`, mood↓ | home |
| Home K (home pitching) | `cheer` scaled by leverage | home |
| Bases-loaded RBI walk by home | `rally-clap` | home |
| Out at base on close play | `gasp` then mood-side reaction | all |
| Inning end with runs | `applause-tail` scaled by run count | home |
| Game end, home wins | sustained `roar` + `applause-tail` | home |
| Late + close (inn≥7, ≤2 runs) | floors `energy` baseline | — |
| Blowout (≥6 run gap) | caps `energy` ceiling, drops attention | — |

Star-batter recognition lifts the walk-up intensity and pops `arousal` when
a home star steps in.

## Determinism

The reducer is a pure function: same `(prior state, events, dt)` →
identical output. The wave tracker is also deterministic. Visual seat
hashes include `quantize(state.energy, 0.1)` so the density bump doesn't
churn on every frame.

The `ambience/reducer.test.ts` suite asserts cross-instance equality on a
fixed input.

## Verification

* `npm test` — 117 / 117 passing (was 97). 9 ambience tests + 5 new
  dispatcher tests cover the new paths.
* `npm run build` — typechecks + builds clean. Bundle ~204 KB / ~67 KB gz.
* `npm run audio:audition` — opens the audition page; every new reaction
  kind has a row, the bed has live sliders, and the walk-up has a sample
  player.
* In-game spot checks on the live screensaver:
  * Bed audible during play, fades during half-inning gaps.
  * HR triggers visible wave + roar + tower-glow flash.
  * Late-and-close strikeout cheers louder than an early-inning K.
  * Walk-up jingle plays at each new batter and ducks under the first pitch.
  * With audio muted, all visual reactions still fire.

## Deferred / out-of-scope

* Vendored chiptune music tracks (between-innings / home-run songs).
* Weather effects + day/night sky palette swap remain Phase 4 ❌ items.
* Idle/wake screensaver detection (Phase 7).
* Mid-pitch crowd buildup that ramps within an at-bat — current model
  reacts to discrete events; pitch-level micro-builds would need a
  dt-driven sub-state. Worth a follow-up if we want even more sense of
  pitch-by-pitch tension.
