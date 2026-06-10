# Phase — Living League: Playoffs, Winters, Ticker, Director, Weather

Five additions in one pass, turning the endless loop into a world worth
tracking. Everything stays inside the architectural lanes: new pure logic in
`/season`, a DOM overlay in `/ui`, a draw-only effect in `/render`, viewer
intent in `/director`, and all glue in `/app`.

## What shipped

### 1. Playoffs (`/season/playoffs.ts` + app wiring)

- Top two teams per conference (W → run diff → teamId) meet in a best-of-5
  Conference Series; winners meet in a best-of-7 Final. Home field follows
  the classic 2-2-1 / 2-2-1-1-1 pattern; Final home field goes to the
  better overall seed.
- One game per active series per playoff day, played live on the usual
  channels with series tags in the HUD label (`East CS G3`).
- Postseason games stay **out** of season aggregates — leaderboards and
  qualifiers remain regular-season stats; standings freeze after the last
  scheduled day.
- The champion/runner-up override the win-leader fallback in
  `buildLeagueHistory`, so the History menu shows real pennant winners.

### 2. Offseason (`/season/offseason.ts`)

- `runOffseason` ages every player along grouped curves (physical tools
  fall hardest, skills hold longest, talent peaks in the late 20s; work
  ethic bends the slope after 30), retires veterans probabilistically from
  age 33 (guaranteed at 41, sooner when the core tools fade), and drafts a
  same-position rookie (age 21–24) per retiree so roster shapes never
  change.
- Runs at every rollover. Retirees accumulate into the Hall-of-Fame gate;
  rookies join the all-time player index so menus and careers resolve.
- `content` exports `FOUNDING_YEAR` + `generateReplacementPlayer`;
  `playerAgeInSeason` maps the 1-based season counter onto calendar birth
  years (menus now show live ages instead of hardcoded 2026).
- Save format bumped to v2 (`playoffDay` field; v1 saves still load).
  Resume replays completed seasons **including** their brackets and
  winters, so the same champions, retirees, and rookies come back.

### 3. News ticker (`/ui/ticker.ts`)

- A thin strip between field and controls rotating headlines every 7 s:
  yesterday's finals, the league's best record, the HR leader, playoff
  series status, and a day/year stamp.
- Breaking items jump the queue: home runs on the active channel (grand
  slams get the red tag), channel finals, `OCTOBER!` when the bracket is
  seeded, the champion banner, winter retirement/rookie counts, and Hall
  of Fame inductions.
- Pure DOM + strings; knows nothing about the sim.

### 4. Manager nudges (`/director`, was a 2-line stub)

- Adopt a franchise and set a posture (cautious / balanced / aggressive)
  from two selects in the controls bar. The director converts posture into
  coaching-staff deltas (3B aggression/judgment, 1B baserunning coaching)
  threaded into `buildGameInput` — the sim core is untouched.
- The broadcast opens on your team's game each day; the ticker announces
  regime changes; settings persist per league seed.
- Nudges apply uniformly to resume replays: an unchanged setup keeps the
  league byte-identical across reloads (changing posture mid-season makes
  the replayed past an approximation; the future is what the knob is for).

### 5. Weather (`/render/weather.ts`)

- Deterministic per-game rain / snow / fog (hash of gameId; snow reserved
  for the late season and October). Sky tints toward storm grey; particle
  overlays draw between sprites and HUD from hashed indices + simTime, so
  every frame is reproducible. Cosmetic only — the sim never sees weather;
  clear is a no-op.

## Tests

151 passing (was 141 at the start of this pass). New: playoff seeding /
progression / hosting patterns / game-entry integrity (5), offseason
determinism / rating bounds / roster conservation / age caps / retirement
curve (5).

## Known limits / next steps

- No wildcard round or division races — straight top-2-per-conference.
- Offseason has no free agency or trades; teams never tank or rebuild.
- The ticker doesn't yet track in-progress no-hitters or hitting streaks.
- Director postures are coarse (one knob); per-game decisions (pinch-hit,
  intentional walk) would need the planned sim-input channel.
- Weather is cosmetic; a `/sim` stadium-effect plugin could someday make
  rain suppress carry distance.
