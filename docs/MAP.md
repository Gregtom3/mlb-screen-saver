# Repo Map — read this before exploring

This file exists so the agent doesn't burn tokens re-running `find`/`ls`/`wc`
to relearn the layout each session. Update it when a module crosses a size
tier or a new hotspot file appears.

Last refreshed: 2026-06-10.

---

## Module sizes

| Module       | Files | Lines  | How to approach                |
|--------------|-------|--------|--------------------------------|
| render       | 21    | 7,541  | **search only** — never full   |
| sim          | 16    | 3,993  | grep first                     |
| ui           | 11    | 2,727  | grep first                     |
| stats        | 13    | 2,206  | grep first                     |
| audio        |  9    | 2,003  | ok to read whole               |
| app          |  7    | 1,906  | ok, but `main.ts` is 929       |
| content      |  7    | 1,144  | ok to read whole               |
| ambience     |  7    | 1,140  | ok to read whole               |
| season       |  7    | 1,002  | ok to read whole               |
| world        |  3    |   431  | read whole                     |
| projections  |  4    |   387  | read whole                     |
| persist      |  1    |    27  | read whole                     |
| director     |  1    |     2  | stub                           |

**Total: ~24.5k lines.**

---

## Hotspots — files >500 lines

Never read these in full. Grep for a symbol, read ±40 lines around the hit.

| File                  | Lines |
|-----------------------|-------|
| render/scene.ts       | 1,606 |
| render/hud.ts         | 1,194 |
| sim/game.ts           | 1,314 |
| app/main.ts           |   929 |
| stats/aggregator.ts   |   817 |
| ui/menu-player.ts     |   614 |
| ambience/reducer.ts   |   603 |
| render/choreo.ts      |   555 |
| season/history.ts     |   493 |

---

## Entry points

- **Web app:** `index.html` → `app/main.ts`
- **Audition (audio dev UI):** `audition.html` → separate vite entry
- **CLI:** `app/cli.ts` (`npm run league:print`), `app/play-game.ts`
  (`npm run game:play`), `app/analyze-plays.ts`

## Tests

- vitest, colocated `*.test.ts` next to source. ~17 test files.
- Run all: `npm test`
- Run one: `npx vitest run path/to/x.test.ts`
- Test files exist under: stats/, sim/, render/, audio/, projections/,
  content/, season/, ambience/.

## Build / lint

- `npm run dev` — vite dev server
- `npm run build` — production build
- `npm run lint` — lint check
