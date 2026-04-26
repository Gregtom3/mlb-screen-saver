# Phase 0 — Foundation

Date: 2026-04-26

## What ships in Phase 0

- **Stack lock-in.** TypeScript + Vite + Canvas2D + IndexedDB (recommended path
  in CLAUDE.md). Tests via Vitest, lint via ESLint flat config, format via
  Prettier. CLI scripts run with `tsx` so the pretty-print needs no build step.
- **Directory skeleton.** Every package named in CLAUDE.md exists at the repo
  root with a placeholder `index.ts`: `/sim`, `/world`, `/render`, `/ui`,
  `/audio`, `/persist`, `/season`, `/director`, `/app`, `/content`, `/docs`.
- **Lint-enforced `/sim` boundary.** `eslint-plugin-import-x`'s
  `no-restricted-paths` blocks `/sim` from importing `/render`, `/ui`,
  `/audio`, or `/app`. Verified by a temporary boundary-violating file —
  ESLint failed with a clear, CLAUDE.md-citing message.
- **Minimal type system.**
  - `/world/types.ts`: `Player`, `Team`, `Stadium` (with `StadiumDimensions`,
    `StadiumQuirk` as a discriminated union, `StadiumAtmosphere`), `Game`,
    `SeasonState`, `LeagueSnapshot`.
  - `/sim/types.ts`: `Pitch`, `AtBat`, `Inning`, `BoxScore`, `SimEvent`
    (discriminated union over `gameStart | pitch | contact | baserunner |
    atBatEnd | sub | inningEnd | gameEnd`), plus `PitchType`, `PitchResult`,
    `AtBatOutcome`, `Base`, `SubReason`, `BallPath`.
- **Seedable PRNG.** `createPRNG(seed)` (Mulberry32) with `next/int/range/pick`
  and a `fork(label)` that derives independent streams via FNV hash. Five
  vitest tests confirm determinism, divergence on different seeds, range
  invariants, and fork independence.
- **Persistence stub.** `/persist` exposes a tiny `SaveAdapter` interface
  plus an in-memory adapter for tests. IndexedDB implementation lands in
  Phase 6 alongside multi-season saves.
- **Founding 16 teams + 16 stadiums** in `/content/teams.ts`, hand-curated
  with city, nickname, abbreviation, mascot, three-color palette, stadium
  name, dimension stubs (LF/LCF/CF/RCF/RF, wall height, foul territory,
  mound), grass pattern + shade, seat palette, day/night bias, crowd density
  curve, and a typed quirk drawn from the `StadiumQuirk` union.
- **CLI pretty-print.** `npm run league:print` renders the league grouped
  by Western/Eastern conference and Pacific/Mountain/Heartland/Atlantic
  divisions, with 24-bit ANSI color bars per team and quirk descriptions.

## What is deliberately NOT in Phase 0

Per CLAUDE.md "First Task — Stop there":

- No simulation loop, no pitch generation, no game state machine.
- No player generation. `LeagueSnapshot.players` is `[]`; player generation
  arrives with the league generator in Phase 1.
- No schedule generation. Phase 1.
- No renderer, no Canvas2D code, no sprites. Phase 2.
- No CI workflow. Local scripts only — `lint`, `format`, `test`, `typecheck`,
  `league:print`, `dev`, `build`. CI drops in next phase.

## Notable architectural choices

- **Packages live at the repo root**, not under `src/`. The CLAUDE.md
  directory layout uses leading slashes to denote root paths; following
  it literally keeps the lint-zone targets readable (`./sim`, `./render`)
  and matches the way the brief talks about modules.
- **`SimEvent` is the contract.** The renderer, audio, UI, and box-score
  builders only see this stream. Box-score and inning aggregates live on
  the world side as views derived from the log — they are not produced by
  the sim directly.
- **Stadium quirks are a discriminated union, not strings.** That keeps the
  Phase 4 plugin registry honest: each quirk variant carries the data its
  effect rule will need (e.g. `short-porch` carries `side` and `distanceFt`).
- **PRNG forking by label** instead of a global counter. A given subsystem
  (e.g. one game, the offseason draft, a single team's lineup) gets a
  deterministic sub-stream from a label, so adding new randomness sites
  later does not perturb earlier streams.

## How to run

```sh
npm install
npm run league:print   # ANSI-colored 16-team rundown
npm run typecheck      # tsc --noEmit
npm run test           # vitest run (5 PRNG tests)
npm run lint           # ESLint, including /sim boundary rule
```

## Terminal capture

`npm run league:print` output lives in `docs/phase-0-league.txt` (raw ANSI
preserved). Open with `less -R docs/phase-0-league.txt` to view colors.

## Next: Phase 1 — Simulation MVP

Player generator (~640 players with hidden ratings, personality flags,
regional name pools), schedule generator, pitch-by-pitch sim of one game
with deterministic event log, CLI box score + play-by-play output.
