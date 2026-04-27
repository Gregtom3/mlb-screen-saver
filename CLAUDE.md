# 8-Bit Baseball Screensaver

A retro 8-bit, birds-eye-view baseball screensaver featuring a persistent
simulated 16-team league. A full season + playoffs lasts 24 hours of real
time; offseason runs, players age and retire, the next season begins
automatically. The vibe: *Out of the Park Baseball* meets a Game Boy meets a
fish-tank screensaver — pleasant to leave on for months.

For the full design brief (concept, league/stadium/player flavor, game flow,
season cadence, manager-knobs catalog, tone & aesthetics, the phased build
plan), see [`/docs/BRIEF.md`](docs/BRIEF.md). For current shipped/partial/stub
state and a module map, see [`/docs/STATUS.md`](docs/STATUS.md). Per-phase
changelogs live at `/docs/PHASE_*.md`.

---

## Core Pillars (Do Not Compromise)

1. **Always-running, low-key beautiful.** This is wallpaper that happens to be a baseball league. Subtle motion, generous color, no UI screaming for attention.
2. **Persistent world.** Players have careers across seasons. The rookie who broke out in year 1 is the aging veteran in year 4. Records and hall-of-famers carry forward.
3. **Simulation integrity first, visuals second.** Games are simulated by a deterministic, seedable engine. The visualizer is *just a renderer of the canonical play-by-play event log.* This separation is sacred.
4. **Bloat-resistant by construction.** The architecture forbids new features from leaking into the simulation core. Anything cosmetic, interactive, or meta-game lives in clearly bounded modules with explicit interfaces.

---

## Architecture

The single biggest project risk is feature creep blurring sim, render, and meta-game systems. Enforce this separation from day one.

### Directory layout

```
/sim         Pure simulation engine. Zero rendering, zero DOM, zero audio.
/world       Persistent league state: teams, players, careers, records, schedule.
/render      Canvas renderer. Consumes events from /sim, never mutates them.
/ui          Overlays: tooltips, box score, game switcher, standings strip.
/audio       Chiptune SFX + ambient crowd. Subscribes to sim events.
/persist     Storage adapter (IndexedDB or SQLite-WASM). One save = one league.
/season      Scheduler, playoff bracket, awards, offseason logic.
/director    User-issued manager nudges. Translates UI intent → sim input.
/app         Glue layer, lifecycle, screensaver idle/wake.
/content     Data: city pool, name pools, mascot ideas, stadium quirk catalog.
/stats       Aggregation, derived stats, splits, WPA, hot/cold, awards. (Phase 5.5+)
/projections Pythagorean + log5 + Monte Carlo standings projections. (Phase 5.5+)
/docs        Phase changelogs, screenshots, design decisions.
```

### Hard architectural rules

- `/sim` cannot import from `/render`, `/ui`, `/audio`, or `/app`. Lint-enforce this.
- `/sim` emits a **typed event log**; everything downstream consumes that log. The renderer is a pure function of the log + tick.
- `/world` owns persistence; `/sim` is stateless across pitches except via the world it's handed.
- Every cosmetic or behavioral extension (grass patterns, stadium quirks, weather, personality flags) goes through a **plugin registry** so features are addable without touching the core loop.
- All randomness flows through a single seedable PRNG threaded through the sim. Same seed + same world = byte-identical game. This is what makes replay, debugging, and "what if I'd pinch hit" features trivial.

### Event log shape (illustrative)

```ts
type SimEvent =
  | { t: number; kind: 'pitch'; pitcherId: string; batterId: string; type: PitchType; result: PitchResult }
  | { t: number; kind: 'contact'; ballPath: BallPath; fielderId?: string }
  | { t: number; kind: 'baserunner'; runnerId: string; from: Base; to: Base; out: boolean }
  | { t: number; kind: 'sub'; out: string; in: string; reason: SubReason }
  | { t: number; kind: 'inningEnd'; halfInning: number; runs: number }
  // ...
```

The renderer interpolates between these. The audio module fires SFX off them. The UI updates box score from them. None of those subsystems can see *into* the sim; they only see what it emits.

---

## Engineering Conventions for the Agent

When working in this repo:

- **Before adding a feature, name its module.** If it crosses boundaries, propose a new module rather than dumping it in `/app`.
- **Every sim behavior gets a unit test with a fixed seed.** Determinism is the contract.
- **No hardcoded city names, team colors, or player attributes inside `/sim` or `/render`.** All data lives in `/content` or `/world`.
- **No new dependencies without a one-line justification** in the PR description.
- **Cosmetic features must degrade gracefully.** If a stadium quirk asset fails to load, the game still plays in the placeholder ballpark.
- **Each phase ends with `/docs/PHASE_N.md`** + a screenshot or terminal capture committed.
- **No silent scope expansion.** If a task implies work beyond the current phase, surface it and stop.
- **Update `/docs/STATUS.md`** when a chunk lands so the next session starts oriented.
