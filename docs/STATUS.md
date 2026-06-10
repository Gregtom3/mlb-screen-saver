# Project Status — where things live, what's shipped, what's stub

A current-state map so a fresh session doesn't have to re-survey the repo.
Update this file whenever you finish a chunk. Keep it short.

Last reviewed: 2026-06-10 (after endless-seasons pass — `PHASE_ENDLESS_SEASONS.md`. The league now runs forever: auto-director hops to the best live game when the watched one goes final, the next day simulates automatically when the slate is done, seasons roll over into the History view, and progress resumes from a `{seed, seasonIdx, day}` localStorage save via deterministic replay. Also fixed: fielder's-choice/groundout/DP baserunning (productive outs, force chains, no run on inning-ending DP), ER vs unearned runs, month-split R. 141 tests passing.).

## Phase status

| Phase | State | Notes |
|-------|-------|-------|
| 0 — Foundation | ✅ shipped | `PHASE_0.md`. Stack, lint, types, PRNG, persist stub. |
| 1 — Sim MVP | ✅ shipped | `PHASE_1.md`. 640 players, schedule, pitch-by-pitch, deterministic. |
| 2 — Render MVP | ✅ shipped | `PHASE_2.md`. Canvas, scene reducer, interp, sprites. |
| 3 — Multi-game + UI | ✅ shipped | `PHASE_3.md`. 8 channels, switcher, standings strip. |
| 4 — Stadium Identity + Polish | ⚠️ partial | Quirks in sim ✅. Stadium visuals ✅ (`PHASE_4_STADIUM_VISUALS.md`). Fence-aware HR sim ✅ (`PHASE_4_FENCE_AWARE_HR.md`). Crowd ambience ✅ (`PHASE_4_CROWD_AMBIENCE.md`): `/ambience` reducer drives audio bed + crowd reactions + walk-up jingles + visual wave / density / lighting from one CrowdState. Weather, chiptune ❌. |
| 5 — Manager Knobs | ❌ not started | `/director` is a one-line stub. No nudges. |
| 5.5 — Stats + Projections + Menus | ⚠️ partial | `PHASE_5_5*.md`. Aggregator, splits, WPA, projections, all 5 menus shipped. Batter-vs-pitcher matchup aggregation + on-canvas batter card with portrait + season AVG/HR/RBI + all-time BvP line shipped (`PHASE_5_5_BATTER_CARD.md`). |
| 6 — Persistence Across Seasons | ⚠️ partial | `PHASE_6.md` + `PHASE_ENDLESS_SEASONS.md`. History schema + multi-season pre-sim ✅. **Endless live seasons ✅**: day auto-advance, auto-director channel hops, season rollover into History, resume-from-save (localStorage `{seed, seasonIdx, day}` + deterministic replay). Aging, retirement, draft, free agency ❌. Playoffs still schema-only (rollover skips straight to next year). |

## Module map

| Path | What it owns | State |
|------|--------------|-------|
| `/sim` | Pure sim engine, event log, box score, stadium-effect plugins | Solid. Errors wired (glove rating → reached-on-error). Pitcher heat-map zone targeting + batter zone-pref outcome shifts wired. Fence-aware HR check active. Coaching-staff plugin wired (`coaching-effects.ts`): 3B coach gates send-on-single + tag-up success; head coach nudges infield-shift slices vs pull hitters. **1B coach activated** (`baserunning.ts`): pickoff attempts, errant throws with OF backup tag plays, and stolen-base attempts run between pitches. **Baserunning table corrected** (`PHASE_ENDLESS_SEASONS.md`): FC force chains, productive groundouts, no run on inning-ending DP; `advanceForOutcome` is outs-aware and exported for tests. Missing: WPs, advanced first-to-third reads, foul-line geography. |
| `/world` | League snapshot, persistent state types | Players carry `heightFt`, per-pitcher zone tendencies, per-batter zone xBA prefs. Teams now carry a 3-coach `CoachingStaff` (head / 1B / 3B). `stadium-geometry.ts` shares wall-distance helpers between `/sim` (HR gate) and `/render` (wall draw). Static across seasons (no aging). |
| `/render` | Canvas renderer, scene reducer, sprites, HUD | Phase 2/3 complete + 8-bit strike-zone viewer in HUD + per-player sprite-size variance from listed height. Stadium visuals shipped: per-stadium wall arc (`wall.ts`), grass patterns (`grass-patterns.ts`), warning track / foul poles / dugouts (rotated to lie parallel to the foul lines, with team-color trim per side — home → 1B-side, away → 3B-side) / batter's boxes / on-deck circles (`stadium-chrome.ts`), crowd (`crowd.ts`), quirk decorations (`stadium-cosmetics.ts`), day/night palette swap. Inning-gap choreography: per-position walk vs jog speeds (catcher + pitcher walk; everyone else jogs) with deterministic per-position start delays for a "team trickle" feel; 0–2 deterministic ball-tosses among infielders during the walk-off; ~50% around-the-horn (catcher → 3B → SS → 2B → P) after a strikeout with empty bases; outgoing batter slow-walks to dugout on K/air-out; on-deck batter rendered at the on-deck circle taking idle warmup swings. Animation-driven SFX (`anim-cues.ts` + `audio/dispatcher.ts: dispatchAnim`). No weather. |
| `/ui` | Five DOM menus (live/league/team/player/history), nav stack, sortable tables | Complete + pitcher heat map + batter xBA-by-zone in player view (sample-gated). No nudge controls. |
| `/audio` | SFX dispatcher + crowd bed + reaction layers + walk-up jingles | 10 SFX + procedural crowd bed (pink-noise + filter LFO + breathy pad), 8 reaction synths (roar/cheer/oo/gasp/groan/applause-tail/two-strike-clap/rally-clap), per-batter walk-up jingle generator. Channel-group bus with side-chain ducking. No vendored chiptune music yet. |
| `/ambience` | Crowd-state reducer + leverage + star-set + wave envelopes | New module. Pure function of (SimEvent batch, dt) → continuous CrowdState (energy/arousal/mood/attention) + discrete reaction pulses. Read by `/audio` and `/render` so they react cohesively. |
| `/persist` | SaveAdapter interface | **In-memory only.** No IndexedDB yet. (Progress survives reload anyway: `/app` persists `{seed, seasonIdx, day}` to localStorage and replays deterministically.) |
| `/season` | Schedule, history rollups, lineups | Schedule + history ✅. Playoffs are schema only — no games run. Offseason orchestration ❌. |
| `/director` | User manager nudges → sim input | **One-line placeholder.** |
| `/app` | Glue, lifecycle, CLI, PBP printers | Complete for current scope. **Endless-day machinery lives here**: auto-director, day advance (incremental `aggregateGame` folds), season rollover, resume-from-save. |
| `/content` | Curated teams, names, stadiums | Complete. Per-player heights + zone fingerprints generated at league init. |
| `/stats` | Aggregator, derived, splits, WPA, hot/cold, awards | Phase 5.5 + per-pitcher `pitchesByZone` + per-batter zone PA/AB/H/HR cells + per-batter `bvpMatchups` keyed by (batterId, pitcherId). |
| `/projections` | Pythagorean + log5 + Monte Carlo standings | New (Phase 5.5). Not in original brief. |

## Tech stack

TypeScript 5.7 + Vite 6 + Canvas2D. Vitest 2.1 (141 tests). ESLint 9 flat config
with `eslint-plugin-import-x` enforcing the `/sim` boundary. Prettier 3.4.
**Zero runtime dependencies.** Bundle ~204 KB / ~67 KB gzipped.

## Conventions worth remembering

- All SimEvent types live in `/sim/types.ts`. Renderers/UI/audio import the
  types but never reach into sim internals.
- New stadium effects, weather, personality flags all go through the plugin
  registry — don't fork the core loop.
- Determinism is the contract: every sim behavior gets a fixed-seed test.
- Phase docs in `/docs/PHASE_*.md` are the source of truth for what each pass
  intentionally did and didn't do. Read them before extending an area.
