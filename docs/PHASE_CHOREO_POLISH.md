# Phase — Choreography & Visual Polish Pass

User-reported issues from watching the live app, all in `/render` plus one
`/app` default. Verified with a headless probe (`buildScene` evaluated at
known ticks around real game events) rather than eyeballing.

## Fixed

1. **Swing read-out** (`sprites.ts`, `scene.ts`). The bat swept from the
   plate-side OUT to the batter's far side — visually a backwards swing —
   and the whole animation lived inside the ~6-tick pitch flight with an
   instant snap-back (~0.12 s wall: "batters don't really swing"). Now a
   quadratic arc (cocked high outside → extended out front → wrapped
   follow-through across the body) driven by an accelerating whip, a
   10-tick follow-through hold, and an 8-tick ease back to ready. The sim's
   whiff rate was already MLB-realistic (~11% of pitches) — it was purely
   unreadable.
2. **Batters now run out balls in play** (`scene.ts`). On air outs there is
   no baserunner event, so the batter used to stand in the box admiring the
   fly. Now any in-play contact belonging to the current at-bat sends the
   batter sprinting up the line (capped at 85% of the way — a retired
   batter never "arrives"), holding near the bag until the catch, and the
   outgoing walk-off then peels toward the dugout from that spot instead of
   teleporting back to the box. Sac flies get the walk-off too.
3. **No more walk-up with three outs** (`scene.ts`). The on-deck batter's
   walk-to-the-box anim fired after every atBatEnd, including the 3rd out —
   he'd stroll to the plate and vanish. With the half over he now shoulders
   the bat and ducks back into his dugout.
4. **Inning-gap pacing is speed-based** (`scene.ts`). The walk-off window
   grew 18 → 46 ticks (the sim's gap is 60), and per-fielder duration is
   now distance ÷ speed (battery ambles at 2.2 ft/tick, others jog at 7.5,
   incoming teams take the field at 12) instead of a fixed 9-tick duration
   that made corner outfielders cover ~270 ft in half a second. Fielders
   vanish into the doorway on arrival and emerge after their stagger delay,
   so the teams trickle naturally — and visibly to *separate* dugouts.
5. **Inning-end ball tosses retired** (`scene.ts`, `anim-cues.ts`). They
   were anchored to the old static 18-tick window; with fielders actually
   leaving on schedule, nobody is home to receive a lob. (This also removes
   a latent audio/visual desync: the toss count was seeded from different
   event times in the two files.) Around-the-horn after mid-inning
   strikeouts is untouched.
6. **Stadium seam gaps** (`crowd.ts`). Adjacent bowl-tier ribbons abutted
   at float coordinates, leaving antialiased hairline seams (plus notches
   where the offset polyline turns sharply) with sky/grass showing through.
   Tier structural fills now overlap by 1.5 px on both edges and are
   stroke-sealed in their own fill color.
7. **Fresh leagues start on day 1** (`app/main.ts`). `HISTORY_DAYS` and
   `PRIOR_SEASONS` default to 0 — no pre-played games, empty record book,
   0-0 standings; stats build on screen from the first pitch. `?history=N`
   / `?priorSeasons=N` still opt back in. Saved-progress resume is
   unaffected.

## Verification

151 tests passing. Headless probes confirm: staggered walk-offs reaching
the correct doorways with everyone inside before inningEnd; on-deck batter
ducking into the dugout after a 3rd out; the batter-runner sprinting to
(55,54) on a fly ball, holding, then peeling to the dugout; swingFrac
tracing 0 → 1 (hold ~9 ticks) → 0 on a swinging strike.
