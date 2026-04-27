# Project Status — where things live, what's shipped, what's stub

A current-state map so a fresh session doesn't have to re-survey the repo.
Update this file whenever you finish a chunk. Keep it short.

Last reviewed: 2026-04-27 (after PHASE_6 history merge).

## Phase status

| Phase | State | Notes |
|-------|-------|-------|
| 0 — Foundation | ✅ shipped | `PHASE_0.md`. Stack, lint, types, PRNG, persist stub. |
| 1 — Sim MVP | ✅ shipped | `PHASE_1.md`. 640 players, schedule, pitch-by-pitch, deterministic. |
| 2 — Render MVP | ✅ shipped | `PHASE_2.md`. Canvas, scene reducer, interp, sprites. |
| 3 — Multi-game + UI | ✅ shipped | `PHASE_3.md`. 8 channels, switcher, standings strip. |
| 4 — Stadium Identity + Polish | ⚠️ partial | Quirks in sim ✅. Day/night, weather, crowd density, chiptune ❌. |
| 5 — Manager Knobs | ❌ not started | `/director` is a one-line stub. No nudges. |
| 5.5 — Stats + Projections + Menus | ⚠️ partial | `PHASE_5_5*.md`. Aggregator, splits, WPA, projections, all 5 menus shipped. |
| 6 — Persistence Across Seasons | ⚠️ partial | `PHASE_6.md`. History schema + multi-season pre-sim ✅. Aging, retirement, draft, free agency, disk save ❌. |

## Module map

| Path | What it owns | State |
|------|--------------|-------|
| `/sim` | Pure sim engine, event log, box score, stadium-effect plugins | Solid. Missing: errors, WPs, pickoffs, SB, fatigue, advanced baserunning. |
| `/world` | League snapshot, persistent state types | Static across seasons (no aging). |
| `/render` | Canvas renderer, scene reducer, sprites, HUD | Phase 2/3 complete. No day/night or weather. |
| `/ui` | Five DOM menus (live/league/team/player/history), nav stack, sortable tables | Complete. No nudge controls. |
| `/audio` | SFX dispatcher wired to SimEvents, audition page | ~5 SFX. No ambient crowd loop, no chiptune. |
| `/persist` | SaveAdapter interface | **In-memory only.** No IndexedDB yet. |
| `/season` | Schedule, history rollups, lineups | Schedule + history ✅. Playoffs are schema only — no games run. Offseason orchestration ❌. |
| `/director` | User manager nudges → sim input | **One-line placeholder.** |
| `/app` | Glue, lifecycle, CLI, PBP printers | Complete for current scope. |
| `/content` | Curated teams, names, stadiums | Complete. |
| `/stats` | Aggregator, derived, splits, WPA, hot/cold, awards | New (Phase 5.5). Solid, well-tested. |
| `/projections` | Pythagorean + log5 + Monte Carlo standings | New (Phase 5.5). Not in original brief. |

## Tech stack

TypeScript 5.7 + Vite 6 + Canvas2D. Vitest 2.1 (63 tests). ESLint 9 flat config
with `eslint-plugin-import-x` enforcing the `/sim` boundary. Prettier 3.4.
**Zero runtime dependencies.** Bundle ~145 KB / ~47 KB gzipped.

## Conventions worth remembering

- All SimEvent types live in `/sim/types.ts`. Renderers/UI/audio import the
  types but never reach into sim internals.
- New stadium effects, weather, personality flags all go through the plugin
  registry — don't fork the core loop.
- Determinism is the contract: every sim behavior gets a fixed-seed test.
- Phase docs in `/docs/PHASE_*.md` are the source of truth for what each pass
  intentionally did and didn't do. Read them before extending an area.
