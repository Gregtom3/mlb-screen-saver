# Project Brief — 8-Bit Baseball Screensaver

> Save this as `CLAUDE.md` in the repo root if you want Claude Code to auto-load it as context every session.

## The Concept

A retro 8-bit, birds-eye-view baseball screensaver featuring a persistent simulated league. While the user is away, fictional games unfold across a 16-team league. The user can wake the screensaver, flip between live games like changing TV channels, peek at lineups and box scores, and — when the mood strikes — nudge a game with a pinch hitter or defensive swap.

A full season + playoffs lasts **24 hours of real time**. Then the offseason runs, players age and retire, rookies arrive, and the next season begins automatically.

**Vibe:** *Out of the Park Baseball* meets a Game Boy meets a fish-tank screensaver. Pleasant to leave on for months.

---

## Core Pillars (Do Not Compromise)

1. **Always-running, low-key beautiful.** This is wallpaper that happens to be a baseball league. Subtle motion, generous color, no UI screaming for attention.
2. **Persistent world.** Players have careers across seasons. The rookie who broke out in year 1 is the aging veteran in year 4. Records and hall-of-famers carry forward.
3. **Simulation integrity first, visuals second.** Games are simulated by a deterministic, seedable engine. The visualizer is *just a renderer of the canonical play-by-play event log.* This separation is sacred.
4. **Bloat-resistant by construction.** The architecture forbids new features from leaking into the simulation core. Anything cosmetic, interactive, or meta-game lives in clearly bounded modules with explicit interfaces.

---

## League Structure

- **16 teams**: 2 conferences × 2 divisions × 4 teams.
- Teams placed in real U.S. cities **without** existing MLB or Triple-A franchises. Original, civically-rooted names — playful but not punny-cringe. Seed examples: Louisville Spiders, Boise Steelheads, Anchorage Halibut, Tucson Saguaros, Des Moines Drovers, Wichita Jetstream, Spokane Lumberjacks, Burlington Maple Kings.
- Each team gets identity colors, a primary mascot, a home city, and a stadium with one signature quirk.

## Stadium Identity

Every ballpark has personality, expressed through:

- **Grass:** custom shade and pattern (checkerboard, radial, ringed, plain).
- **Dimensions:** outfield wall distances and heights, foul territory size, mound height variation.
- **Signature quirk:** ivy-covered wall, hill in center field, a small pond beyond the right-field fence, a clock tower in play, a giant mascot statue, a wind tunnel from the bay.
- **Atmosphere:** crowd density curves, seat color palette, day/night biases (some teams play more day games).

Stadium quirks **affect simulation, not just rendering.** A short porch in right means more home runs there. A 420 ft center field means more triples. The plugin interface for stadium effects is the same one used for weather and personality flags — see *Architecture* below.

## Player System

- ~25 active + ~15 minor-leaguers per team at league founding (~640 players total).
- Hidden true stats (contact, power, eye, speed, fielding, arm, stamina, composure) drive behavior. Visible counting stats accumulate through play.
- **Aging curves**: rookies arrive via fictional draft each offseason; players peak in their late 20s; veterans decline and retire.
- **Personality flags**: clutch, streaky, injury-prone, durable, hot-headed, glove-first. These modulate behavior subtly, not deterministically.
- **Name pools** by region — a player from Anchorage feels different from one from San Antonio. Avoid uncanny-valley name generation; lean into a curated pool.

## Game Flow

- Pace: ~8–10× real time. A full game runs ~25–40 minutes of wall-clock.
- All daily games run concurrently in the background. Schedule staggers them like real MLB.
- On screensaver wake, the user sees a default "game of the night" view. Left/right arrow or click cycles channels.
- Persistent UI elements: small standings strip, "next up" carousel, optional box score / play-by-play drawer.
- Hover a batter: tooltip with season slash line. Click: full player card with career arc.

## 24-Hour Season Cadence

- 162 games per team scaled to fit ~21 hours.
- Hours 1–21: regular season (~7–8 games per team per day).
- Hours 22–23: playoffs.
- Hour 24: championship + offseason recap (highlight reel, awards, retirements, draft, free agency).
- Then auto-rolls into next season. The league lives forever.

## Manager Knobs (Phase 5+)

When the user is actively watching, they can nudge:

- Recommend a pinch hitter
- Suggest a defensive swap or shift
- Warm up a reliever
- Issue an intentional walk
- Toggle steal signs / hit-and-run

The sim has its own manager AI; user nudges are *suggestions* the in-game manager weighs (and sometimes overrides if the suggestion is silly given context). The system tracks if the user becomes the de facto GM of one team across a season.

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

## Phased Build Plan

Each phase ends with a demonstrable, playable artifact and a `/docs/PHASE_N.md` changelog. Resist the urge to start in Phase 4.

### Phase 0 — Foundation
Stack lock-in, repo setup, lint/format/test/CI, core type system, seedable PRNG, persistence adapter stub.

### Phase 1 — Simulation MVP
League generator (16 teams, 16 stadiums, ~640 players, schedule). Pitch-by-pitch sim of one game. CLI output only — box score + play-by-play log. Deterministic given a seed.

### Phase 2 — Visualization MVP
Browser-based birds-eye renderer for one game. Tick-rate decoupled from sim rate; smooth interpolation between events. Basic pixel sprites for batter/runners/fielders. One placeholder ballpark.

### Phase 3 — Multi-game + UI
All 8 daily games run concurrently in a Web Worker. Channel-flip game switcher. Hover tooltips, basic box score drawer, standings strip.

### Phase 4 — Stadium Identity + Polish
Per-stadium grass, dimensions, quirks — and quirks influencing sim. Day/night, weather, crowd density curves. Chiptune SFX + ambient. Screensaver idle/wake behavior.

### Phase 5 — Manager Knobs
Pinch hitter, defensive swap, intentional walk, bullpen warmup. Nudges threaded into sim cleanly via `/director` without breaking determinism (re-seed forward from user intervention point).

### Phase 6 — Persistence Across Seasons
Offseason: retirements, draft, free agency, awards ceremony. Career stats, record book, hall of fame. Multi-league save slots.

### Phase 7+ — Stretch Ideas

- Trade deadline events with simple GM AI per team
- Rivalry tracking + dynamic narrative beats ("These teams have split the last 6 meetings…")
- Highlight reels: replay the day's key plays during the offseason hour
- Time-travel mode: boot up the league at any past date from the save
- Subtle broadcast overlay with chiptune commentary blips
- Hot/cold streaks visualized as auras around player sprites
- Injury system with recovery timelines
- Minor league call-ups visible in the news ticker
- Weather affecting fly ball carry, fielder visibility
- "Sandlot mode" — generate a one-off exhibition with custom rosters

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

---

## Tone & Aesthetics

- **8-bit but generous.** 32×32 sprites are fine if they read better than 16×16 at glance distance. This isn't NES-hardware cosplay; it's a screensaver someone will glance at for months.
- **Color palette:** warm and limited per stadium, but not retro-puke. Modern pixel-art indie, not 1986 constraints.
- **Audio:** minimal, melodic, never chip-loud. Bat crack, glove pop, scattered crowd, occasional organ riff. Muted by default; sound is opt-in.
- **UI overlays:** thin, almost diegetic. The field is the show.
- **Naming taste matters.** Team names, player names, and stadium quirks are flavor — get them right and the whole thing feels lived-in. Get them wrong and it feels generated.

---

## First Task

1. Read this brief end to end.
2. Propose a stack with one-paragraph justification (recommended: TypeScript + Vite + Canvas2D + IndexedDB, but argue if you disagree).
3. Create the directory skeleton with placeholder index files and a lint rule enforcing the `/sim` import boundary.
4. Define the minimal type system in `/sim` and `/world` (Player, Team, Stadium, Game, Pitch, AtBat, Inning, BoxScore, SimEvent, SeasonState).
5. Generate a placeholder league — 16 teams with names, cities, colors, and stadium dimension stubs — and pretty-print it to the terminal.

**Stop there.** Do not render anything yet. Do not write the sim loop yet. Do not ship Phase 1 in one shot. Commit, write `/docs/PHASE_0.md`, and wait for review.