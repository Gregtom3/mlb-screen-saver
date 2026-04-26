# Phase 3 — Multi-game + UI

Date: 2026-04-26

## What ships in Phase 3

- **8 simultaneous channels.** `/app/main.ts` pre-simulates the full
  schedule of `LIVE_DAY` (default day 5) — 8 games, the full daily
  slate — and keeps each event log around. All 8 share one `simTime`
  clock, so flipping channels mid-game shows what's happening on the
  *other* matchup at the same wall-clock progress.
- **Channel flip.** Left / right arrows cycle through the 8 channels.
  Number keys 1–8 jump directly. Bottom controls strip shows the
  current "ch X/8 · AWAY @ HOME" plus the keybinding hint. The
  scoreboard's stadium row appends `ch X/8` so the channel reads at a
  glance from the field too.
- **Standings strip.** A new 22-px band across the very top of the HUD
  shows all 16 teams sorted by W-L with team-color stripes. Records
  are computed by pre-simulating `HISTORY_DAYS` of full schedule
  (default 4 days) — those event logs are walked just to tally W-L
  and then discarded, so the memory cost stays bounded.
- **Renderer architecture.** `RenderLoopHandle.setActiveGame()` swaps
  the rendered events + scene context without resetting the simTime
  clock. The HUD now takes optional `getStandings()` and
  `getChannelInfo()` providers; both are called every frame and
  rendered when present.

## What is deliberately NOT in Phase 3

- **Web Worker offload.** The full schedule pre-simulation runs on the
  main thread (~480 ms cold start for 48 games). If startup time grows
  past a budget, the league-generation + sim loop will move into a
  worker — the event log being the only contract makes that cheap.
- **Hover tooltips on batters.** Mouse interaction isn't really the
  screensaver's idiom; the batter card already shows the slash-line.
- **Box-score drawer that opens over the field.** The line score is
  visible all the time as a bottom-right panel; a separate drawer is
  redundant for now.
- **Stadium picker / map view.** Not needed yet.

## URL parameters

- `?seed=N` — master league seed
- `?history=N` (default 4) — how many days of completed games roll
  into the standings strip
- `?day=N` (default `history+1`) — the live day to render as channels
- `?game=N` (default 1) — which channel to open on
- `?debug=1` — RENDER_DEBUG overlay

## Test invariants

- Existing 25 tests still pass; Phase 3 didn't alter the sim shape.

## Next: Phase 4

Stadium quirks affecting sim outcomes (started this pass — see
PHASE_4.md). Day/night, weather, chiptune SFX, and screensaver idle/
wake behavior remain ahead.
