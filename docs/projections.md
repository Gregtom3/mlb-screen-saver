# Playoff projections

`/projections` runs Monte Carlo over the remaining schedule + a synthetic
playoff bracket. Lives in its own module (no DOM, no rendering) so it could
move to a Web Worker if profiling demands it. Today it runs synchronously
with a 500-sim default.

## Method

1. **Team strength** — Pythagorean win expectation (`RS² / (RS² + RA²)`)
   regressed toward .500 by remaining-game weight. Early in the season the
   prior dominates; late, the team's actual record is the signal.
2. **Per-game probability** — log5: `P(A beats B) = (pa − pa·pb) / (pa + pb − 2·pa·pb)`,
   with a small additive home-field bump (`+0.04`).
3. **Regular season** — for each sim, every remaining schedule entry is
   rolled with the per-game probability. Outputs final wins per team.
4. **Playoff bracket** — top 4 per conference (ties broken by raw strength).
   Best-of-5 division round (1v4, 2v3), best-of-7 conference final, best-of-7
   championship. HFA alternates per game.

## Outputs

For every team:

- P(make playoffs) / P(win division) / P(top seed) / P(win conference) / P(win title)
- Final-win-total distribution: 5th / 50th / 95th percentile
- Strength-of-schedule remaining (avg log5 win prob of remaining opponents)
- Magic / elimination numbers (computed at view time vs. division rivals)

## When it runs

- On first menu read in `app/main.ts` (lazy, cached).
- A Phase-6 hook will refresh once per simulated game-day; the call is
  cheap (~10 ms for 500 sims, ~25 ms for 1000), so you can also trigger a
  manual refresh from the team Projections tab.

## Knobs

- `simulations` — N (default 500).
- `seed` — defaults to the league seed; same seed → byte-identical projection.

## Limits

- No starter-rotation modeling (every game uses team-level strength, not
  the actual SP that day). MLB-quality projections need this; the screensaver
  use case doesn't.
- No injury / fatigue / momentum effects.
- Tiebreakers between teams with identical sim-final wins fall back to raw
  Pythagorean — actual MLB tiebreakers (head-to-head, division record, RD)
  are deferred until the season's tiebreaker rules are formalized.
- `magicDivision` / `eliminationDivision` are derived in the team view via
  `computeMagicNumber`, not stored in the cached set.

## Where the code lives

- `/projections/montecarlo.ts` — Monte Carlo + magic-number helper.
- `/projections/types.ts` — `TeamProjection`, `ProjectionSet`.
- Tests: `/projections/montecarlo.test.ts` — sums P(title) ≈ 1, P(playoffs) ≈ 8.
