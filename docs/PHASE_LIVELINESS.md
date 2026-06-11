# Phase — Liveliness Pass: Field Theater + Stand Facades

Goal: the field should never be a still life, and the between-pitch
baserunning the sim already simulates (steals, pickoffs, errant throws)
should finally be *visible*. Plus the real fix for the gaps between stands.

## Shipped

### Between-pitch baserunning theater (`scene.ts`)

The sim has emitted `pickoffAttempt` / `pickoffThrow` / `errantThrow` /
`backupPlay` / `stealAttempt` / `tagAttempt` since the baserunning phase —
audio reacted, the renderer ignored them all. Now:

- **Pickoffs**: the runner dives back from his lead (collapse → hug the bag
  → ease back out), the ball snaps mound → bag and holds, HUD caption
  "pickoff attempt!" / "picked off!".
- **Errant throws**: the arc sails past the bag to the sim's landing point,
  the backup outfielder sprints to it, relays to the advancing runner's
  base, then jogs back to his spot; the runner breaks the moment the ball
  gets away.
- **Steals**: the runner breaks at `stealAttempt` (not at the outcome event
  14 ticks later — a `breakingRunners` overlay renders the sprint before
  the follow-up `baserunner` event enters the prefix, then hands over
  seamlessly because both use the same startT), the defense fires to the
  bag, ball and runner race, caption calls it ("X steals 2nd!" / "caught
  stealing!").
- All theater state clears on the next pitch / inning end.

### Fielder life (`scene.ts`)

- **Idle wander**: every fielder drifts a few feet on a slow two-frequency
  path (per-player phase), ~1.8× larger between at-bats — positions read
  as people, not pins. Catcher stays planted; pitcher barely sways.
- **Pull shifts**: vs power pull hitters the infield slides up to ~13 ft
  toward the pull side (outfield ~16 ft), mirroring the sim's head-coach
  shift on outcome slices. Eased from the previous batter's alignment over
  the first 20 ticks of each at-bat so alignments glide rather than snap.

### Stand gaps actually fixed (`crowd.ts`)

The earlier seam-sealing pass treated antialiasing cracks, but the "gaping
strips" were structural: the upper deck starts 4 px-feet beyond the lower
bowl's outer edge (a designed concourse gap) AND each upper tier is lifted
vertically (`riseLiftPx`) to fake elevation — sky showed through both
bands. New `drawTierRiser` ribbons span lower-outer-edge → upper-inner-edge
(at each tier's lift) as dark facade walls, drawn under the tier fills with
1.5 px overlap. Bowl reads as one solid structure.

## Verification

151 tests passing. Headless probes: steal break renders the full sprint
with the throw arriving just ahead of the tag; pickoff shows dive-back →
ball arc → ease back to the lead; fielders drift 0.4–4 ft over quiet
15-tick windows and shifts ramp smoothly between batters.

## Notes / limits

- The catcher doesn't visibly throw on steals (between-pitch model parks
  the ball at the mound, so the pitcher fires instead — reads fine).
- No tag-swipe animation yet; converging ball + runner + caption carry it.
- Shifted fielders snap up to ~16 ft onto play-choreo paths at contact;
  masked by the action but a future choreo could blend from current pos.
