# Visual Polish Checklist

Drop this in the repo (e.g. `docs/TASK_visual_polish.md`) and point Claude Code at it.

## Ground Rules

- **All work in `/render` and `/ui` only.** Do not touch `/sim`, `/world`, or the event log shape. If a task seems to require a sim change, stop and surface it.
- Work top to bottom. Commit after each section. Each section gets a screenshot in `/docs/screenshots/`.
- If a task is unclear, propose an interpretation in 1–2 sentences and proceed; do not block on questions.
- No new dependencies without justification. Pixel fonts can come from a local `.woff2` (e.g. "Press Start 2P" or similar) — vendor it, don't CDN it.
- Keep frame rate ≥ 30fps with all 8 concurrent games running.

---

## Section 1 — Identity (highest priority)

- [ ] **1.1** Replace the circle player markers with pixel-art sprite players. Start with one shared sprite (16×16 or 24×24, your call) drawn programmatically or as a small spritesheet. Body + cap + torso minimum.
- [ ] **1.2** Tint each sprite by team. Sprite should accept `capColor` and `jerseyColor` props sourced from the team record in `/world`. Home team and away team must be instantly distinguishable.
- [ ] **1.3** Add a 1px drop shadow / dark pixel offset under each player sprite so they sit on the field rather than float.
- [ ] **1.4** Add mow-stripe pattern to outfield grass (alternating slightly lighter/darker bands, ~16px wide, radiating from home plate). Pure cosmetic — this single change carries enormous aesthetic weight.
- [ ] **1.5** Confirm stadium grass color is being read from the stadium record (per the architecture, grass shade is per-stadium). If it's hardcoded right now, plumb it through. Verify by spot-checking 3 different stadiums render with 3 different greens.

## Section 2 — Field geometry

- [ ] **2.1** Draw the four bases. White squares, ~10×10px, at 1B / 2B / 3B / home. Home plate stays as a pentagon if you want.
- [ ] **2.2** Fix the infield shape. The current "green triangle pointing at the pitcher" reads as a cone. Use the standard layout: dirt around home (catcher's area), dirt baselines connecting the bases, dirt around the pitcher's mound, grass infield interior between the baselines.
- [ ] **2.3** Render the pitcher's mound as a small dirt-colored circle (~20px) with a white rubber on top, instead of the current single white pixel.
- [ ] **2.4** Add an outfield wall. Arc from foul pole to foul pole at the stadium's defined dimensions. ~4px thick, dark color. Foul lines must terminate at the wall, not extend off-screen.
- [ ] **2.5** Add a thin stadium frame band outside the outfield wall (~6–10px), suggesting the back of the stands. Pick a neutral concrete-gray or team-tinted color.
- [ ] **2.6** Fix the catcher and batter positioning. Catcher behind home plate facing the mound. Batter in either L or R batter's box (driven by the batter's handedness from the player record). Currently they overlap.
- [ ] **2.7** Identify and remove the stray blue/dark element near home plate visible in the current screenshot. Likely a debug artifact or misrendered umpire. If it's the umpire, render it properly behind the catcher in a distinct color.

## Section 3 — Scoreboard / HUD

- [ ] **3.1** Build a proper scoreboard strip across the top of the screen. Layout: `[AWAY logo+abbrev] [away score] [inning indicator ▲/▼ N] [home score] [HOME logo+abbrev]`. Use a chunky pixel font.
- [ ] **3.2** Stop clipping the stadium name. Move it to its own line, or shrink the font, or expand the container — pick whichever fits the new HUD layout.
- [ ] **3.3** Enlarge the bases diamond indicator (currently barely visible). Diamond ~40×40px, fill occupied bases bright yellow or in the batting team's color.
- [ ] **3.4** Render the count as discrete ball/strike pixel icons (e.g. ●●○ for 2 balls, etc.) instead of "0-0" text.
- [ ] **3.5** Outs indicator: 3 dots, filled = out recorded, hollow = remaining. Make them at least 8×8px each.
- [ ] **3.6** Build a current-batter card (persistent, lower-left or lower-right corner): batter name, position, season slash line (AVG/OBP/SLG). Updates on every plate appearance event.
- [ ] **3.7** Add an on-deck indicator near the batter card: "On deck: <name>".
- [ ] **3.8** Add a line score row (innings 1–9 with R H E columns) somewhere in the HUD. This is the box-score-glance most baseball UIs have.

## Section 4 — Play-by-play

- [ ] **4.1** Replace the plain "Rangel singles" text with a pixel-font ticker bar (top or bottom edge of screen). Last event animates in (slide or fade) and persists ~3s before the next.
- [ ] **4.2** Add a brief on-field event popup for big moments — `SINGLE!` `DOUBLE!` `HR!` `K!` — chunky pixel font, appears over the field for ~600ms with a small scale/pop animation. Drive entirely off the existing event log; do not add new event types in `/sim`.

## Section 5 — Motion

- [ ] **5.1** Render the ball. On every `pitch` event, the ball should travel mound → home over the pitch duration. On `contact`, it should travel along the BallPath from the event log to wherever the fielder receives it.
- [ ] **5.2** Animate baserunners. On `baserunner` events, interpolate the runner sprite from `from` base to `to` base over the event's duration. Hold them at the destination base.
- [ ] **5.3** Animate the batter swing. Even a 2-frame sprite swap (stance → follow-through) on a contact or swinging-strike event is enough.
- [ ] **5.4** Add a subtle screen-edge flash on extra-base hits and home runs. ~150ms, low opacity, team color.

## Section 6 — Atmosphere

- [ ] **6.1** Add a pixel-art crowd ring outside the stadium frame: a 3–5px tall band of mixed-color pixels (skin tones + jersey colors). Densities can vary by inning and game importance later — for now, static is fine.
- [ ] **6.2** Tint the background sky color slightly per stadium (and eventually per day/night, but day-only is fine for this pass).

## Section 7 — Cleanup

- [ ] **7.1** Audit the renderer for any remaining hardcoded colors, dimensions, or stadium-specific values. Move them to the stadium record in `/content` or `/world`.
- [ ] **7.2** Add a `RENDER_DEBUG` flag that overlays sprite bounding boxes, base positions, fielder zones, and the pitcher rubber. Off by default. This will save hours later.
- [ ] **7.3** Update `/docs/PHASE_N.md` (whichever phase this lands in) with before/after screenshots of all 16 stadiums.

---

## Acceptance Criteria

When done, a fresh viewer glancing at the screen should be able to:

1. Tell which two teams are playing by sprite color alone.
2. Read the score, inning, count, outs, and baserunners in under 2 seconds.
3. See the ball travel and runners advance on every event.
4. Identify which stadium they're watching by its grass and dimensions.
5. Describe the look as "8-bit baseball" without prompting.

If any of those five fail, the section is not done.

## What NOT To Do In This Pass

- No audio work.
- No new manager-knob UI (Phase 5).
- No weather, no day/night cycle (those are part of stadium identity in Phase 4 proper).
- No changes to sim event types, sim timing, or the PRNG.
- No "while I'm in here" refactors of `/sim` or `/world`.

Surface anything that feels like it belongs in a later phase rather than doing it now.