# Coaching Staff — Phase 5 sub-pass

## What shipped

Each team now carries a three-coach staff (head, first base, third base) on
its persistent `Team` record. Coaches have ratings on the same 1-99 scale as
players and feed a small modifier struct that the sim reads at game time.

### Wired effects

- **Third-base coach** (`aggression`, `judgment`):
  - Gates "score from 2B on a single" — the runner attempts to score with
    probability `0.85 + (aggression - 50) * 0.0022`. Failures hold at 3B
    rather than producing an out, so the run environment shifts but the
    out budget per inning is unchanged.
  - Gates tag-up success on sac flies — runner on 3B advances with
    probability `0.92 + (judgment - 50) * 0.0014`. Failures hold at 3B.
- **Head coach** (`tactics`):
  - Slides the infield-shift slice boundaries by up to ~3° of spray angle
    against pull hitters (LHB → boundaries shift right; RHB → shift left;
    switch hitters get no shift). Magnitude is non-negative — only above-
    average tactical coaches produce a real shift; a 50-tactics coach
    plays straight up.

### Defined-but-deferred (data only)

The full `CoachingStaff` shape is filled in for every team and every
modifier field is computed, but two effects are not yet wired into the
sim because their dependent subsystems don't exist yet:

- **First-base coach** (`baserunningCoaching`, `pickoffAwareness`):
  `stealAdvantage` and `pickoffPrevention` multipliers are computed but
  unread. Steals and pickoffs aren't simulated yet (`/sim/game.ts:22`);
  when they ship, this is a one-line activation in the relevant
  attempt-success roll.
- **Head coach `morale`**: there's no clubhouse / morale subsystem to
  consume it; deferring rather than faking a one-game effect that future
  work would have to disentangle.

Both fields exist in `CoachingMods` so tests can assert direction and so
the data path is exercised today.

## Architecture

Mirrors the stadium-effects plugin pattern (`/sim/stadium-effects.ts`):

```
/world/types.ts         Coach, CoachRatings, CoachingStaff types
/content/coach-init.ts  generateCoachingStaff(rng, teamId)
/content/teams.ts       buildTeamsAndStadiums(rng) — coaches per team
/sim/coaching-effects.ts  modsForCoaching(staff) → CoachingMods
/sim/game.ts            reads mods at advanceForOutcome + fielder-position time
```

The sim never imports the coach generator — it only consumes the mods
struct. Coaches travel into `runGame` through `SideInput.coachingStaff`,
optional so legacy fixtures keep working with neutral defaults.

## Determinism

`generateCoachingStaff` forks per team (`coaches:<teamId>`) so adding /
changing a coach for one club doesn't ripple across the league. Coach
ratings are stable for the life of a `LeagueSnapshot`. Within `runGame`,
all rolls use the existing per-game PRNG; same input → same events.

## Tests

- `sim/coaching-effects.test.ts` (6 tests): unit tests on `modsForCoaching`
  — neutral fallback, baseline at 50/50, direction of each rating's
  effect, including the deferred 1B fields.
- `sim/coaching-integration.test.ts` (3 tests): determinism with explicit
  staffs, league-snapshot coverage (every team has a staff), and a
  batched-game assertion that aggressive 3B coaches outscore cautious
  ones across 30-game samples on the same seeds.

97 tests total, suite green; lint and `tsc --noEmit` both clean.
