# Phase 2 — Visualization MVP

Date: 2026-04-26

## What ships in Phase 2

- **Browser-based birds-eye renderer** mounted on a `<canvas id="field">`
  in `index.html`. Generates the league, picks a Day-1 game, runs the
  Phase 1 sim once up front, then plays the resulting `SimEvent[]` log
  back at a configurable speed. Bottom controls expose a play/pause
  toggle and a 0.5×/1×/2×/4× speed selector.
- **Pure scene reducer (`/render/scene.ts`).** `buildScene(events, simTime, ctx) → SceneState`
  walks the prefix of the event log up to `simTime` and reconstructs
  what the field looks like — count, outs, score, bases occupied, who
  is on the mound, who's at the plate, where the ball is, where any
  runners are. The renderer holds **no state of its own** between frames
  — exactly what CLAUDE.md means by "the renderer is a pure function of
  the log + tick."
- **Tick decoupling (`/render/loop.ts`).** A `requestAnimationFrame` loop
  advances `simTime` by `wallClockDelta * ticksPerSecond`. Default rate
  is 20 sim-ticks per real second, which lands ~25–28 minutes per full
  game — in line with the screensaver target of 8–10× real time.
- **Smooth interpolation between events.** Three primitives:
  - **Pitch flight**: ball lerps from mound to plate over 4 sim ticks
    after a `pitch` event.
  - **Contact flight**: ball lerps from plate toward `BallPath.landing*`
    over 14 sim ticks after a `contact` event, then settles.
  - **Runner motion**: each runner's most recent non-out `baserunner`
    event drives a base-by-base path lerp at 3 ticks per base. Home
    runs (from=0, to=0) follow the explicit four-base path.
- **Placeholder ballpark (`/render/field.ts`).** Drawn programmatically:
  - Sky background, outfield grass with a quadratic-curve wall arc.
  - Infield dirt diamond with a small grass cutout.
  - Pitcher's mound circle, four bases, white foul lines.
  - Per-stadium quirks (short porches, ivy, hills) are deliberately
    NOT wired in — that's Phase 4 plugin-registry territory. The same
    `Stadium` data already declares them; the renderer just doesn't
    consume them yet.
- **Sprites (`/render/sprites.ts`).** Each player is a two-color
  circle sprite with a black outline (primary body color, secondary
  cap dot). The batter gets a small bat line; the pitcher gets a
  rubber-bar accent. Phase 4 will swap these for proper 8×8 / 16×16
  pixel-art sheets — the call shape (`drawPlayer(ctx, t, scenePlayer)`)
  stays the same.
- **HUD (`/render/hud.ts`).** Top score strip (away abbr / score / @ /
  home abbr / score, plus the inning-arrow indicator and stadium name
  on the right). A "last play" caption tucked under the score strip
  (never overlays the field). Bottom-left count + outs panel; bottom-
  right mini-base diagram with occupied bases highlighted in the team
  accent color.
- **Coordinate system.** Field coordinates use feet, with home plate at
  origin and +Y pointing toward 2nd base. `computeTransform()` maps
  these to the canvas pixel grid given the current viewport. Resize
  works — the loop redraws on `resize` events.

## Architecture notes

- `/render` imports from `/sim/types.js` and `/world/types.js`. It does
  not import from `/sim/game.js` or anywhere that would couple visuals
  to simulation internals — only the canonical `SimEvent` log shape.
- `/sim` still imports nothing from `/render`, `/ui`, `/audio`, or
  `/app`. The boundary lint rule continues to lint-fail anything that
  tries.
- The animation loop is the only piece that holds mutable state
  (`simTime`, `playing`, `lastFrameMs`). Everything visible in a frame
  is derived freshly from `(events, simTime, sceneCtx)`. This means
  pause/resume, jump-to-time, and "what did the field look like at
  tick N" are all O(N) walks of the event log — fine for a single
  game's ~10k events.
- `BoxScoreView` and `SceneState` are independent reducers over the
  same event stream. That's the contract the rest of the project will
  build on: every consumer (UI, audio, persistence, replay) gets its
  view by reducing the same canonical log.

## What is deliberately NOT in Phase 2

- **Stadium quirks affecting visuals or sim.** Phase 4 wires the
  effect-plugin registry; Phase 4 also brings real grass patterns,
  per-stadium seat palettes, and atmosphere.
- **Multiple games / channel-flip switcher.** Phase 3 introduces the
  Web Worker boundary and game-switching UI.
- **Audio.** Phase 4.
- **Final pixel art.** Phase 4 — current sprites are functional
  placeholders.
- **Tooltips / box-score drawer / standings strip.** Phase 3.
- **Errors, wild pitches, pickoffs, manager nudges.** Tracked across
  later phases.

## How to run

```sh
npm install
npm run dev          # vite dev server at http://localhost:5173
npm run build        # production bundle (~45kb gzipped 16kb)
npm run test         # 25 tests (PRNG, players, schedule, sim, scene)
npm run lint         # ESLint with /sim boundary rule
```

URL parameters customize what plays:
- `?seed=42` — change the master league seed (hex `0x` prefix accepted)
- `?day=5` — pick a different schedule day (1–150)
- `?game=3` — pick a different matchup on that day (1–8)

## Frame capture

`docs/phase-2-frame.png` is a 960×720 headless-Chromium screenshot
captured ~8 seconds into the default game. Generated via
`scripts/capture-frame.mjs` (uses Playwright; `playwright` is installed
as a dev-only tool, not committed to package.json).

To re-capture:
```sh
npm install --save-dev --no-save playwright
node scripts/capture-frame.mjs docs/phase-2-frame.png
```

## Test invariants

- `buildScene` is pure: `same (events, simTime, ctx) → identical SceneState`.
- Pre-game (`simTime < 0`) yields `phase: 'pre-game'` with score 0-0.
- Post-`gameEnd` yields `phase: 'final'` with final score matching
  `gameEnd.finalRuns`.
- Live play always shows 9 fielders (P + C + 7 others).
- Bases reset to empty after every `inningEnd`.

## Next: Phase 3 — Multi-game + UI

All 8 daily games run concurrently in a Web Worker. Channel-flip game
switcher (left/right keys cycle channels). Hover-tooltips on batters.
Box-score drawer that toggles open over the field. Standings strip
across the top of the page.
