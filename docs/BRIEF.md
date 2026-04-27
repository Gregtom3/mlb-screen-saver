# Project Brief — 8-Bit Baseball Screensaver

This is the original design brief. `CLAUDE.md` carries the architectural rules
and engineering conventions that need to be in-context every session; this
document carries the concept, flavor, and phased build plan that you only need
to consult when working in those areas.

## The Concept

A retro 8-bit, birds-eye-view baseball screensaver featuring a persistent simulated league. While the user is away, fictional games unfold across a 16-team league. The user can wake the screensaver, flip between live games like changing TV channels, peek at lineups and box scores, and — when the mood strikes — nudge a game with a pinch hitter or defensive swap.

A full season + playoffs lasts **24 hours of real time**. Then the offseason runs, players age and retire, rookies arrive, and the next season begins automatically.

**Vibe:** *Out of the Park Baseball* meets a Game Boy meets a fish-tank screensaver. Pleasant to leave on for months.

---

## League Structure

- **16 teams**: 2 conferences × 2 divisions × 4 teams.
- Teams placed in real U.S. cities **without** existing MLB or Triple-A franchises. Original, civically-rooted names — playful but not punny-cringe. Seed examples: Louisville Spiders, Boise Steelheads, Anchorage Halibut, Tucson Saguaros, Des Moines Drovers, Wichita Jetstream, Spokane Lumberjacks, Burlington Maple Kings.
- Each team gets identity colors, a primary mascot, a home city, and a stadium with one signature quirk.

## Stadium Identity

Every ballpark has personality, expressed through:

- **Grass:** custom shade and pattern (checkerboard, radial, ringed, plain).
- **Dimensions:** outfield wall distances and heights, foul territory size, mound height variation.
- **Signature quirk:** ivy-covered wall, hill in center field, a small pond beyond the right-field fence, a clock tower in play, a giant mascot statue, a wind tunnel from the bay.
- **Atmosphere:** crowd density curves, seat color palette, day/night biases (some teams play more day games).

Stadium quirks **affect simulation, not just rendering.** A short porch in right means more home runs there. A 420 ft center field means more triples. The plugin interface for stadium effects is the same one used for weather and personality flags — see *Architecture* in `CLAUDE.md`.

## Player System

- ~25 active + ~15 minor-leaguers per team at league founding (~640 players total).
- Hidden true stats (contact, power, eye, speed, fielding, arm, stamina, composure) drive behavior. Visible counting stats accumulate through play.
- **Aging curves**: rookies arrive via fictional draft each offseason; players peak in their late 20s; veterans decline and retire.
- **Personality flags**: clutch, streaky, injury-prone, durable, hot-headed, glove-first. These modulate behavior subtly, not deterministically.
- **Name pools** by region — a player from Anchorage feels different from one from San Antonio. Avoid uncanny-valley name generation; lean into a curated pool.

## Game Flow

- Pace: ~8–10× real time. A full game runs ~25–40 minutes of wall-clock.
- All daily games run concurrently in the background. Schedule staggers them like real MLB.
- On screensaver wake, the user sees a default "game of the night" view. Left/right arrow or click cycles channels.
- Persistent UI elements: small standings strip, "next up" carousel, optional box score / play-by-play drawer.
- Hover a batter: tooltip with season slash line. Click: full player card with career arc.

## 24-Hour Season Cadence

- 162 games per team scaled to fit ~21 hours.
- Hours 1–21: regular season (~7–8 games per team per day).
- Hours 22–23: playoffs.
- Hour 24: championship + offseason recap (highlight reel, awards, retirements, draft, free agency).
- Then auto-rolls into next season. The league lives forever.

## Manager Knobs (Phase 5+)

When the user is actively watching, they can nudge:

- Recommend a pinch hitter
- Suggest a defensive swap or shift
- Warm up a reliever
- Issue an intentional walk
- Toggle steal signs / hit-and-run

The sim has its own manager AI; user nudges are *suggestions* the in-game manager weighs (and sometimes overrides if the suggestion is silly given context). The system tracks if the user becomes the de facto GM of one team across a season.

---

## Phased Build Plan

Each phase ends with a demonstrable, playable artifact and a `/docs/PHASE_N.md` changelog. Resist the urge to start in Phase 4.

### Phase 0 — Foundation
Stack lock-in, repo setup, lint/format/test/CI, core type system, seedable PRNG, persistence adapter stub.

### Phase 1 — Simulation MVP
League generator (16 teams, 16 stadiums, ~640 players, schedule). Pitch-by-pitch sim of one game. CLI output only — box score + play-by-play log. Deterministic given a seed.

### Phase 2 — Visualization MVP
Browser-based birds-eye renderer for one game. Tick-rate decoupled from sim rate; smooth interpolation between events. Basic pixel sprites for batter/runners/fielders. One placeholder ballpark.

### Phase 3 — Multi-game + UI
All 8 daily games run concurrently in a Web Worker. Channel-flip game switcher. Hover tooltips, basic box score drawer, standings strip.

### Phase 4 — Stadium Identity + Polish
Per-stadium grass, dimensions, quirks — and quirks influencing sim. Day/night, weather, crowd density curves. Chiptune SFX + ambient. Screensaver idle/wake behavior.

### Phase 5 — Manager Knobs
Pinch hitter, defensive swap, intentional walk, bullpen warmup. Nudges threaded into sim cleanly via `/director` without breaking determinism (re-seed forward from user intervention point).

### Phase 6 — Persistence Across Seasons
Offseason: retirements, draft, free agency, awards ceremony. Career stats, record book, hall of fame. Multi-league save slots.

### Phase 7+ — Stretch Ideas

- Trade deadline events with simple GM AI per team
- Rivalry tracking + dynamic narrative beats ("These teams have split the last 6 meetings…")
- Highlight reels: replay the day's key plays during the offseason hour
- Time-travel mode: boot up the league at any past date from the save
- Subtle broadcast overlay with chiptune commentary blips
- Hot/cold streaks visualized as auras around player sprites
- Injury system with recovery timelines
- Minor league call-ups visible in the news ticker
- Weather affecting fly ball carry, fielder visibility
- "Sandlot mode" — generate a one-off exhibition with custom rosters

---

## Tone & Aesthetics

- **8-bit but generous.** 32×32 sprites are fine if they read better than 16×16 at glance distance. This isn't NES-hardware cosplay; it's a screensaver someone will glance at for months.
- **Color palette:** warm and limited per stadium, but not retro-puke. Modern pixel-art indie, not 1986 constraints.
- **Audio:** minimal, melodic, never chip-loud. Bat crack, glove pop, scattered crowd, occasional organ riff. Muted by default; sound is opt-in.
- **UI overlays:** thin, almost diegetic. The field is the show.
- **Naming taste matters.** Team names, player names, and stadium quirks are flavor — get them right and the whole thing feels lived-in. Get them wrong and it feels generated.
