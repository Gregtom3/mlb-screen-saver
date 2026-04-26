# Phase 5.5 — Statistics & Information Menu

A user-facing menu system for exploring the league: leaderboards, player cards, team pages, schedules, playoff projections, and live win-probability tracking. This is the layer that turns the screensaver from "ambient baseball" into "ambient baseball you can fall down a rabbit hole in."

This phase sits between Phase 5 (manager knobs) and Phase 6 (multi-season persistence). It works on a single season's data on day one, and expands naturally when Phase 6 lands.

---

## Why This Phase Earns Its Slot

Baseball's depth comes from its statistical texture. A screensaver that simulates 24-hour seasons but doesn't let you *look at* anything is a missed opportunity. Conversely, a stats menu without the live simulation is just a fake Baseball Reference. Both halves need each other.

The hardest part isn't the UI — it's deciding what's the source of truth (the event log) versus what's an aggregate (computed from events) versus what's a projection (computed from aggregates plus a model). Get the data flow right and every future stat is a one-day add.

---

## Ground Rules

- All work in `/ui`, plus a new `/stats` module and a new `/projections` module. Do **not** add per-game state to `/sim`.
- Stats are **always derived from the event log**, never written to by the sim directly. Aggregates exist only as a performance cache.
- Win probability uses a static lookup table for now. The path to bootstrapping from this league's own historical data lands in Phase 6+.
- Menu UI is keyboard-navigable first, mouse-friendly second. The screensaver context means a viewer might be far from the screen.
- Opening the menu does **not** pause the league. Background games keep simulating. Closing the menu returns the user to the same channel they were on.

---

## New Modules

```
/stats         Aggregation and derived-stat computation. Reads event log, writes aggregate tables.
/projections   Monte Carlo playoff odds, Pythagorean records, ELO-ish team strength.
/ui/menu       The new menu shell, navigation, and all stats views.
```

`/stats` and `/projections` are pure: in → out, no rendering, no DOM. They can run in a Web Worker.

---

## Data Model

### Three tiers of statistical data

**Tier 1 — Event log** (already exists in `/sim`). Source of truth. Immutable. Every pitch, contact, baserunner movement, sub, inning end. Replayable.

**Tier 2 — Aggregate tables** (new, in `/world`). Rebuilt from the event log. Two refresh strategies:
- *Incremental*: on every `inningEnd` and `gameEnd` event, update affected player and team rows.
- *Full rebuild*: on demand (debug, save migration, sanity check). Must produce identical output to incremental — this is a tested invariant.

**Tier 3 — Derived stats** (computed at read time). Rate stats (AVG, OBP, ERA, WHIP), splits (vs L/R, home/away, RISP), and projections. Cheap enough to compute on view; cache only if profiling demands it.

### Aggregate row shape (illustrative)

```ts
interface BattingLine {
  playerId: string;
  seasonId: string;
  teamId: string;       // current team for the line; multi-team players get one line per stint
  G: number; PA: number; AB: number; R: number; H: number;
  doubles: number; triples: number; HR: number; RBI: number;
  BB: number; IBB: number; SO: number; HBP: number;
  SF: number; SH: number; SB: number; CS: number; GIDP: number;
  // Splits stored as nested maps keyed by split name:
  splits: {
    vsLHP?: BattingLine;
    vsRHP?: BattingLine;
    home?: BattingLine;
    away?: BattingLine;
    RISP?: BattingLine;
    risp2Out?: BattingLine;
    lateAndClose?: BattingLine;  // 7th+ inning, tying run on/at bat/on deck
    byMonth?: Record<string, BattingLine>;
  };
  WPA: number;          // win probability added, sum across all PAs
  hitChart: HitLocation[];  // for spray-chart visualization
}

interface PitchingLine {
  playerId: string; seasonId: string; teamId: string;
  G: number; GS: number; CG: number; SHO: number;
  W: number; L: number; SV: number; BS: number; HLD: number;
  IP: number;          // store as outs, present as innings.fraction
  H: number; R: number; ER: number; HR: number;
  BB: number; IBB: number; SO: number; HBP: number;
  BK: number; WP: number; BF: number;
  splits: { /* same shape as batting */ };
  WPA: number;         // pitcher WPA (negative is good for the pitcher's team in this convention; pick one and document it)
}

interface FieldingLine {
  playerId: string; seasonId: string; teamId: string;
  position: Position;
  G: number; GS: number; innings: number;
  TC: number; PO: number; A: number; E: number; DP: number;
}

interface TeamLine {
  teamId: string; seasonId: string;
  W: number; L: number;
  RS: number; RA: number;          // runs scored / against
  divW: number; divL: number;      // intra-division
  homeW: number; homeL: number;
  awayW: number; awayL: number;
  last10: string;                  // "7-3"
  streak: { kind: 'W'|'L'; n: number };
  // Aggregations of player lines:
  batting: BattingLine;
  pitching: PitchingLine;
}
```

### Player career data (Phase 6 expands this; lay the groundwork now)

```ts
interface PlayerCareer {
  playerId: string;
  bio: { firstName, lastName, dob, hometown, batsHand, throwsHand, height, weight };
  bySeason: Record<string, { teamId: string; batting?: BattingLine; pitching?: PitchingLine; fielding?: FieldingLine[] }>;
  teamsPlayed: { teamId: string; fromSeason: string; toSeason: string }[];
  awards: { season: string; award: AwardKind }[];
  milestones: { date: string; description: string }[];   // "100th career HR", etc.
}
```

The single-season version of this is the core deliverable for Phase 5.5. Multi-season fields can be empty arrays for now and fill in once Phase 6 lands.

---

## Menu Structure

A modal overlay that takes over the screen when invoked (key: `Tab` or `M`). Five top-level views, navigable by number keys or tabs:

1. **League** — standings, leaders, playoff picture
2. **Teams** — pick a team → roster, schedule, stats, projections
3. **Players** — search/browse all players → career card
4. **Live** — currently in-progress games with WP charts
5. **History** — past seasons, records, hall of fame *(stub for Phase 5.5; full in Phase 6)*

Every view supports:
- Sorting any column ascending/descending
- A "qualified players only" toggle (≥ 3.1 PA per team game for hitters, ≥ 1 IP per team game for pitchers)
- Filtering by team / position / handedness
- A breadcrumb back path (`League › Teams › Spokane Lumberjacks › Player`)

### View 1 — League

- **Standings**: by division, conference, and overall. Columns: W L PCT GB Streak L10 RS RA RD HOME AWAY. Highlight playoff seeds (top 4 per conference for now; tune later).
- **Leaderboards**: tabs for Batting, Pitching, Fielding. Default sorts by AVG, ERA, FPCT respectively. Every column is sortable. Top 25 with infinite scroll.
- **Playoff picture**: division leaders, wild card race, magic numbers, elimination numbers. Visual bracket of projected playoffs based on current standings.
- **Awards watch**: live MVP / Cy Young / Rookie / Manager-of-the-Year leaderboards using a transparent formula. Document the formula in `/docs/awards.md`.

### View 2 — Team

- **Header**: city, name, record, division standing, last 10, streak, current win streak record-holder if relevant.
- **Roster** tab: active roster grouped by position, with key season stats. Click a player → Player view.
- **Schedule** tab: full 162-game schedule. Past games show result and WP-defining moment ("L 4-3 — 8th inning grand slam allowed"). Future games show opponent and venue. Today's game highlighted.
- **Stats** tab: team batting/pitching/fielding lines, plus rank in each major category league-wide.
- **Projections** tab: playoff odds, projected final record, magic numbers, strength-of-schedule remaining.
- **Stadium** tab: ballpark name, dimensions, signature quirk, home/road splits, park factors *(park factors are Phase 6 data; show "—" until N seasons of data exist).*

### View 3 — Player

- **Header**: name, photo (a 64×64 pixel-art portrait — generated from a small face/skin/hair/cap palette + seed; fine to be procedural), position, team, jersey number, B/T (bats/throws), age, hometown.
- **Hot/cold indicator**: rolling-window performance vs season baseline. Aura color subtle (red/blue/none).
- **Splits panel**: dropdown selector (vs L, vs R, Home, Away, RISP, RISP+2 outs, Late & Close, by month). All counting + rate stats recompute for the selected split.
- **Game log**: every game played this season. Click a game → that game's box score and WP chart.
- **Spray chart**: birds-eye field with a dot per batted ball, colored by outcome (out / single / double / triple / HR). Pixel-art rendering matching the in-game style. This is the kind of thing that looks incredible and costs nothing because the data is already in the event log.
- **Career stats**: a year-by-year table. Empty in Phase 5.5 except for the current season; fills in over time.
- **Teams played for**: list with seasons. (Trivial in season 1; meaningful later.)
- **Milestones / streaks**: longest hit streak this season, multi-HR games, complete games, etc.

### View 4 — Live

- A grid of all in-progress games. Each tile shows score, inning, baserunners, count, and a tiny inline WP curve.
- Click a tile → full game view with the big WP chart described in the next section.
- This is also where "biggest play of the day so far" surfaces — top 5 WPA-delta plays across the league today.

### View 5 — History (stub)

- Last season's final standings and award winners (empty in season 1).
- All-time records (single-season, career) — empty in season 1.
- Hall of fame — empty in season 1.

Phase 5.5 ships the page with empty states; Phase 6 fills it.

---

## Win Probability System

The crown jewel of this phase. Done right, this is the most fun feature in the project after the simulation itself.

### What we're computing

- **WP (Win Probability)**: probability that the home team wins, given the current game state. State = `(inning, half, outs, base_state, score_diff)`.
- **WPA (Win Probability Added)**: the change in WP caused by a single play. Credited to the batter/pitcher (and eventually fielder for big defensive plays).
- **LI (Leverage Index)**: how high-stakes the current state is, normalized so 1.0 = average. Optional but cheap.

### Implementation

1. Build a static **WP lookup table** seeded from MLB historical data (publicly available — Tom Tango's Run Expectancy / Win Expectancy tables are the standard reference). Vendor it as a JSON or generate at build time. Store as `/stats/wpTable.json`.
2. On every event from the sim that changes game state, look up the new WP. Store `{ eventIdx, wpHome }` on the game record.
3. WPA for a play = `wpAfter - wpBefore`, sign-adjusted for which team batted.
4. Cumulative WPA per player updates on `gameEnd`.

### Live game WP chart

Per-game line chart, x-axis = play index, y-axis = home team WP from 0 to 1. Pixel-art styling: 1px line, dot markers on big swings (>10% WPA), color-coded by which team gained probability. Annotations on the biggest swings ("8th: 3-run HR by Rangel, +24% HOME").

This is **the** thing the user asked for: "see when certain at-bats spiked or dropped a team's win percentage." Make it the centerpiece of the live game view and the post-game box score.

### Performance

WP lookup is a hash table read — sub-microsecond. WPA per play is two reads and a subtraction. There is no performance concern here; resist any temptation to over-engineer.

---

## Playoff Projection System

Lives in `/projections`.

### Method

Monte Carlo: simulate the remainder of the schedule N times (N = 1000 to start, tunable) using a simple team-strength model derived from current performance.

**Team strength model (start simple):**
- Pythagorean win expectation from RS/RA: `RS² / (RS² + RA²)`.
- Optional: blend with a regressed prior based on preseason ratings.
- Per-game win probability for team A vs team B: log5 formula on Pythagorean expectations, with a small home-field adjustment.

**Per simulation:**
- Roll every remaining game using the per-game win probability.
- Tally final standings, apply tiebreakers (head-to-head, division record, RD), build playoff bracket, simulate playoffs the same way.

**Outputs per team:**
- P(make playoffs)
- P(win division)
- P(secure top seed)
- P(win conference)
- P(win championship)
- Distribution of final win totals (5th / 50th / 95th percentile)

### When to run it

- Once per simulated game-day (cheap; cache results).
- On demand from the menu if the user wants a fresher number.
- Bake into a small "playoff odds" widget that's visible on team pages and in the league standings view.

### Don't over-fit

The model will be wrong in interesting ways. That's fine. Document the methodology in `/docs/projections.md` so it's transparent and easy to improve.

---

## Implementation Order Within This Phase

Each step ends in a working, demonstrable artifact. Don't merge straight to step 7.

- [ ] **5.5.1 — Aggregate tables foundation.** Build `/stats` module. Define aggregate row shapes. Implement incremental update from `gameEnd` events. Implement full rebuild from event log. Test that they produce identical results on a 10-game fixture.
- [ ] **5.5.2 — Stats catalog v1.** Compute all standard counting and rate stats (batting, pitching, fielding) at read time from aggregates. Unit-test each formula against hand-calculated examples.
- [ ] **5.5.3 — Splits.** Add vs L/R, home/away, RISP, RISP+2, late & close, by-month splits. Stored as nested aggregate rows.
- [ ] **5.5.4 — WP table + WPA.** Vendor the WP table. Compute WP at every state-changing event. Compute WPA per play. Add cumulative WPA to player aggregates.
- [ ] **5.5.5 — Menu shell + navigation.** Build the modal overlay, keyboard nav, breadcrumbs, view switching. No content yet — placeholder text per view.
- [ ] **5.5.6 — League view.** Standings, leaderboards (with sorting and qualified filter), playoff picture, awards watch.
- [ ] **5.5.7 — Team view.** Header, roster, schedule, stats, projections. Stadium tab can be minimal.
- [ ] **5.5.8 — Player view.** Header, splits panel, game log, career stats (single-season for now), teams played for.
- [ ] **5.5.9 — Spray charts.** Pixel-art hit charts on player view. Reuse the field renderer from `/render` (treat it as a library; do not duplicate).
- [ ] **5.5.10 — Live view + WP chart.** Grid of in-progress games with inline WP curves. Detail view with big WP chart and biggest-play annotations.
- [ ] **5.5.11 — Projections.** Build `/projections` Monte Carlo. Wire into team and league views. Daily refresh.
- [ ] **5.5.12 — History stub.** Empty-state pages with hooks ready for Phase 6.
- [ ] **5.5.13 — Polish pass.** Player portrait generator (procedural pixel-art faces). Hot/cold indicators. Awards-watch leaderboards. `/docs/PHASE_5_5.md` with screenshots.

---

## Acceptance Criteria

A user opening the menu should be able to do all of the following without leaving the screensaver:

1. Find the league's current home run leader, sorted descending, in two key presses.
2. Click that player and see his full season stats, splits vs LHP, last 10 games, and a spray chart of every batted ball.
3. Navigate to the player's team and see their full schedule, current playoff odds, and projected final record.
4. Drop into the live view and watch a game's win probability evolve in real time as plays happen.
5. Click any past play and see "this play moved WP by X%."
6. Close the menu and find the screensaver exactly where they left it, with the right game still on.

If any of those six fail, the phase is not done.

---

## What NOT To Do In This Phase

- No multi-season career data filling — that's Phase 6. Career-stats tables show the current season only; surface empty-state UI for years past.
- No trades, free agency, or roster changes mid-season. Phase 6.
- No fancy projection models (ELO, SRS, neural anything). Pythagorean + log5 + Monte Carlo is the contract for now. Document and move on.
- No "live commentary" text generation in this phase — that's a Phase 7 stretch idea. The play-by-play ticker from Phase 4 is enough.
- No injuries, no DL, no minor-league call-ups in the menu. Stub them.
- No new sim event types. Every stat must be derivable from the existing event log. If it isn't, surface what's missing as a separate proposal — do not edit `/sim` to add a "stat hint" event.

---

## Open Questions to Surface (Don't Decide Solo)

- **Playoff format.** Brief says "playoffs" without specifying. Propose 8-team (top 4 per conference, best-of-5 div round, best-of-7 championship). Wait for confirmation before implementing.
- **Qualified-player thresholds.** MLB uses 3.1 PA/team-game for hitters, 1.0 IP/team-game for pitchers. Confirm this matches the 162-game scaled season or adjust.
- **WPA convention.** Pitcher WPA can be reported as "negative is good" (the pitcher is shrinking the opponent's WP) or sign-flipped to "positive is good." Pick one, document, never change.
- **Awards formula.** MVP isn't a stat, it's a vote. Propose a transparent point formula (e.g. weighted sum of WAR-like stats) and make it visible in the menu so users can see why a leader is leading.