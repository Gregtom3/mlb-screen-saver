# Phase 6 — Persistence Across Seasons

Date: 2026-04-26

This pass lifts the league out of its single-season cocoon. The History
tab now reads multi-season state instead of empty-state copy: past
champions, year-over-year career arcs, a single-season record book, and
a Hall of Fame hook ready to fill once retirements ship.

Two adjacent ergonomics asks landed alongside it: every game-log entry
now hyperlinks the opposing starting pitcher (with a back button that
walks the menu's navigation stack), and the league leaderboards are
sortable by every visible column.

---

## What ships in this pass

### `/season/history.ts` — multi-season records

A new module owning every history-shaped type.

```
SeasonRecord       — final standings, champion/runner-up, MVP/Cy/Rookie,
                     leaders for AVG/OPS/HR/RBI/H/WPA + W/ERA/WHIP/SO/IP/WPA,
                     plus top-10 batting / pitching lines for the year.
CareerBattingLine  — per-player career totals + byYear[] map for the
                     player view's career table.
CareerPitchingLine — same shape for pitchers.
SingleSeasonRecords — top-5 single-season finishes by stat, across every
                     season in history.
HallOfFamer        — id, induction year, composite score, tag, summary.
LeagueHistory      — bundles all of the above + retiredPlayers + HoF.
```

Builders:

- `summarizeSeason(year, agg, teams, teamGames, playerIndex)` — folds a
  finished `SeasonAggregates` into one `SeasonRecord`.
- `buildLeagueHistory({ seasons, teams, playerIndex, retiredPlayers })`
  — runs all summaries, accumulates career totals, computes single-season
  records, and inducts retired players who clear the composite score
  threshold.
- `careerBattingScore` / `careerPitchingScore` — transparent linear
  formulas (TB + RBI/R/BB modifiers + WPA bonus for hitters; Wins + IP
  + SO + WPA − ERA penalty for pitchers). Documented inline so future
  tuning has a clear surface.

### `/app/main.ts` — pre-simulate prior seasons

Two new query parameters:

- `?priorSeasons=N` — pre-simulate N full prior seasons before the live
  day. Each prior season uses a distinct seed offset
  (`SEED ^ Math.imul(0x9e3779b9, i + 1)`) so outcomes vary
  year-over-year. Default: `1`.
- `?priorSeasonDays=N` — truncate prior-season simulation to the first N
  days (lets the smoke test stay fast). Default: full 150-day schedule.

Roster aging and retirements are deliberately not in this pass — the
pipeline is wired for them (LeagueHistory carries `retiredPlayers`), but
the actual aging/draft logic is the next chunk. With the current empty
retired set, the Hall of Fame view shows a friendly empty-state
explaining what's needed.

### History UI — `/ui/menu-history.ts`

The previous stub gave way to a four-route sub-router:

- **Index.** Three nav cards (Single-season records, All-time records,
  Hall of Fame) plus a "Past seasons" table. Each season row has the
  champion, runner-up, MVP, Cy Young, Rookie — every player name a
  clickable link to their bio.
- **Season detail (`?historyRoute=season&year=N`).** Trophy header,
  full standings table, per-stat season leaders.
- **Single-season record book.** Top-5 by stat (batting and pitching),
  every entry linked to the player.
- **All-time records.** Top-25 career batters and pitchers ranked by
  composite score.
- **Hall of Fame.** Card grid over inductees once retirements arrive.

### Player view career table

The Player view's old "Career" empty-state is now a real per-year
breakdown table for batters and pitchers, with a totals row at the
bottom (`career-total` styled in gold). Tables degrade gracefully when
no prior seasons were simulated.

### Game-log player links + back button

- Every game-log row now carries an "Opp SP" column with the opposing
  team's starting pitcher rendered as an underlined link (`.player-link`).
  Clicking jumps to that pitcher's bio.
- The menu header has a new `← back` button that walks a navigation
  stack maintained by `mountMenu`. Drill-down clicks (player → opposing
  pitcher → hall of fame) push prior states; back pops them. Tab
  switches reset the stack so they always feel like top-level jumps.
- `MenuContext` gained `getGameMetadata(gameId)` so any view can ask for
  a game's home/away starting pitchers without re-running the sim.
- `/ui/menu-shared.ts` ships the shared `playerNameLink(name, id)` and
  `wirePlayerLinks(host, onClick)` helpers. Every renderer that wants a
  link just emits the markup; the orchestrator wires the click handler
  globally on each render.

### Sortable leaderboards — `/ui/menu-league.ts`

The league Batting and Pitching tables are now sortable on every visible
column. Clicking a column header toggles the sort direction; clicking a
new column resets to that column's sensible default (`AVG` desc, `ERA`
asc, `SO`-the-pitcher desc, `SO`-the-batter asc, etc.). The active
column shows a ▲/▼ marker and a subtly highlighted header. Implementation
is a small generic `buildSortableLeaderboard` so future tables can opt
in cheaply.

---

## What's deliberately NOT in this pass

- **Aging + retirement.** Players' birth years are static; no one ages
  out. The data path is ready (`retiredPlayers` flows into
  `buildLeagueHistory`) but the transition logic is the next chunk.
- **Draft + free agency.** Rookie generation is still single-shot at
  league founding. A real offseason needs a draft pool and a free-agent
  market.
- **Awards ceremony / highlight reel.** The data exists; the
  presentation pass (a guided "watch the season's biggest moments"
  intermezzo) is downstream of audio polish.
- **Persistence to disk.** `/persist` still runs in-memory; landing
  IndexedDB is a follow-up, gated on offseason logic so the schema
  doesn't churn.
- **Multi-league save slots.** Falls out of disk persistence above.

## Tests

- 63 tests pass (was 58 → +5 new).
- New: `season/history.test.ts` (5):
  - `summarizeSeason` records a champion and at least one award.
  - `buildLeagueHistory` rolls up career stats across two seasons.
  - HoF inducts only retired players past the score threshold.
  - Career batting score rewards more counting stats.
  - Career pitching score penalizes higher ERA.
- All previously-green tests still green — the aggregator and
  determinism contracts didn't change.

## Type-check & build

- `tsc --noEmit` clean.
- `eslint .` clean.
- `vite build` clean. Bundle: `dist/index.html` 17.5 kB / 3.2 kB gz;
  `main-*.js` 144.8 kB / 46.9 kB gz (was 126 / 41.8 — history view +
  career table + sortable leaderboards account for the delta).

## How to use

1. `npm run dev`.
2. Append `?priorSeasons=2&priorSeasonDays=20` to the URL while iterating;
   default `?priorSeasons=1` simulates a full 150-day prior season
   (~3-5 s startup).
3. **Tab** opens the menu. **5** jumps to the History tab.
4. From any leaderboard, click a column header to sort by that stat.
5. Click an opposing pitcher in a game log to drill in; **← back** in
   the menu header walks back up the navigation stack.
