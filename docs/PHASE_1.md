# Phase 1 — Simulation MVP

Date: 2026-04-26

## What ships in Phase 1

- **Player generator (~640 players).** Each team carries a 40-player roster
  (25 active + 15 minors) drawn from a curated American name pool with a
  Latin/Caribbean/East-Asian sprinkle. Per-position rating biases produce
  recognizable archetypes — pitchers with high stamina, catchers with high
  arms, middle infielders with speed-fielding emphasis, DHs with power.
  Personality flags (`clutch`, `streaky`, `injury-prone`, `durable`,
  `hot-headed`, `glove-first`) are stamped on ~30–40% of players for use
  by later phases. All randomness flows through PRNG sub-streams forked
  per team via `rng.fork('roster:<teamId>')`, so adding generation steps
  later won't perturb existing seeds.
- **Schedule generator.** 10 rotations of a circle-method round-robin over
  the 16 teams: every team plays every other team exactly 10 times across
  150 days, one game per team per day, with home/away alternating between
  rotations for a balanced 75/75 split. Tests verify all four invariants.
- **Lineup builder (`/season/lineup.ts`).** Selects the starting pitcher
  from a 5-deep stamina-ranked rotation cycling on `(gameDay - 1) % 5`,
  fills the field by best-at-position, picks a DH, and orders the lineup
  card with leadoff = highest on-base score, cleanup = highest power,
  and the rest by combined hitting score.
- **Pitch-by-pitch sim (`/sim/game.ts`).** A self-contained state machine
  threads a single PRNG through pitch → at-bat → inning → game and emits
  the canonical `SimEvent` stream. The probability model:
  - Per-pitch: zone-likelihood ∝ pitcher composure; swing-likelihood ∝
    inverse of batter eye, modulated by count.
  - On contact: foul vs. in-play split, with two-strike fouls staying
    foul rather than retiring the batter.
  - On in-play: outcome rolled from a flat HR/3B/2B/1B/out table with
    rating-driven biases; outs split into GO/FO/LO/PO by launch angle;
    sac flies and double plays detected from base/out state.
- **Bullpen logic.** Starters are pulled at 95 pitches (or 70 in trouble:
  ≥4 runs allowed). Relievers cycle out at 30. Pitching changes emit a
  `sub` event with `reason: 'pitching-change'` and surface in PBP.
- **Box-score reducer (`/sim/box-score.ts`).** Builds a `BoxScoreView`
  from the event log alone — the renderer/UI/persistence will all use
  this same reducer pattern. Linescore, batter lines (AB/R/H/RBI/BB/K/HR),
  pitcher lines (IP/H/R/BB/K/HR/Pitches).
- **Terminal play-by-play (`/app/pbp.ts`).** Formats events into per-
  inning blocks with dim per-half-inning summaries, RBI tags, and the
  scoring runners' last names inlined.
- **CLI (`npm run game:play`).** Generates the league, builds the
  schedule, picks a game (`--day`, `--game`, `--seed`), and prints PBP
  followed by the box score. Sample run captured to
  `docs/phase-1-game.txt`.

## What is deliberately NOT in Phase 1

- **Stadium quirks affecting sim.** The data is declared on `Stadium`,
  but the effect-plugin registry that consumes it is Phase 4. A short
  porch in right does not yet make HRs more likely.
- **Manager nudges, pinch hits, defensive subs, intentional walks,
  steals, hit-and-run, shifts.** All Phase 5.
- **Wild pitches, passed balls, pickoffs, errors.** Errors are reserved
  in the box score (always 0 for now).
- **Per-region flavor (name pools by hometown, regional accents).** The
  name pool is one curated list; Phase 6 splits it.
- **Aggressive baserunning.** Singles only advance trail runners one
  base except 1st-to-3rd; doubles score everyone behind. No two-out
  hustle scoring from first.
- **Realistic 162-game season schedule with within/cross-division
  weighting and bye days.** Phase 6 ships this alongside the playoff
  bracket.
- **Multi-game scheduling on a single day in CLI.** `npm run game:play`
  picks one game; no day-summary view yet.

## Architectural notes

- `/sim` still imports nothing from `/season`, `/content`, or anything
  else that would couple it to schedule shapes. The `GameInput` type
  declares exactly what the sim needs (lineups + a `playerIndex`); the
  CLI does the assembly.
- `BoxScoreView` and the formal `BoxScore` type are kept distinct on
  purpose. The view is what terminals/UIs print; the formal type is a
  reconstructable view-of-record we'll need when Phase 2 wants to seek
  to a specific at-bat from the event log.
- Determinism contract holds: `runGame(input)` is a pure function of
  `input`. Two tests confirm byte-equal `JSON.stringify(events)` for
  same seed, divergence for different seeds, and that 100-game batches
  always end with a non-tie `gameEnd`.
- The PRNG is *forked* per game with the gameId-hashed seed XOR'd into
  the master, so every game in a season is independent yet reproducible
  from one master seed.

## How to run

```sh
npm install
npm run typecheck             # tsc --noEmit
npm run test                  # vitest run (19 tests)
npm run lint                  # ESLint, including /sim boundary rule
npm run league:print          # Phase 0 ANSI rundown
npm run game:play             # default: day 1, game 1, seed 0xba5eba11
npm run game:play -- --seed 7 --day 5 --game 3
```

## Sample game output

`docs/phase-1-game.txt` captures the default run — 175 lines including
PBP and box score. Open with `less -R docs/phase-1-game.txt` to view
ANSI colors. Key signatures: 17 inning-end blocks (9 top + 8 bottom,
home walks off in 9 if leading), pitching changes annotated inline,
and a line-score table with R/H/E totals.

## Test invariants worth highlighting

- **Schedule.** 1200 games total, 150 per team, 75 home / 75 away
  ±2, every pair meets exactly 10 times, every team plays exactly
  once per day.
- **Players.** 640 total = 16 × 40, every team has 25 active + 15
  minors with 12 active pitchers and 7 minor-league pitchers. All
  ratings ∈ [1, 99].
- **Sim.** Same seed → byte-identical events. Different seeds → 
  different events. 100 random seeds all terminate with a non-tie.
  Box-score linescore sums match `gameEnd.finalRuns`.

## Next: Phase 2 — Visualization MVP

Browser-based birds-eye renderer for one live game. Tick-rate decoupled
from sim rate; smooth interpolation between events on the canvas. Basic
pixel sprites for batter/runners/fielders. One placeholder ballpark.
The renderer will subscribe to the same `SimEvent` stream the box score
already consumes.
