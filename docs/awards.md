# Awards-watch formulas

The League view's awards-watch leaderboards use transparent formulas so
viewers can read a leader and see why. They're WAR-flavored, not WAR — the
whole point is legibility.

## Definitions

- **bWPA** — cumulative batter win-probability added (positive = team gained
  WP). Calculated by `/stats/aggregator` and stored on `BattingLine.WPA`.
- **pWPA** — pitcher WPA, sign-flipped so positive = pitcher's team gained
  WP. Stored on `PitchingLine.WPA`.
- **G** — games played; for hitters this is at-least-one-PA games.
- **IP** — innings pitched (stored as outs internally).

## MVP

```
MVP = bWPA + (OPS - .700) × 25 × (G / 150)
```

Plain reading: WPA carries the bulk of the score (clutch matters), but a
pure rate-stat monster who plays full-time can pull ahead via the OPS bonus.

## Cy Young

```
Cy Young = pWPA + (4.00 - ERA) × 0.5 × (IP / 150)
```

A 2.50 ERA over 200 IP gets `+1.0` from the rate term; a high-leverage
lockdown closer can compete via WPA alone.

## Rookie of the Year

```
Rookie = same as MVP, restricted to players with workEthic > 60
```

Until Phase 6 ships actual rookie seasons (with a `seasonsPlayed` counter),
`workEthic > 60` proxies for "young, ascending." Crude — replace once the
career schema lands.

## Manager of the Year

Not yet implemented. Proposed: rank teams by `(actual W) - (preseason
projected W)`. Requires preseason projections, which arrive with Phase 6's
multi-season memory.

## Tied scores

Ties are broken by raw OPS (MVP / Rookie) or ERA (Cy). No additional
sub-rules; Award contests in this league are not lawsuits.

## Where the formulas live

- Code: `/stats/awards.ts` (`mvpRanking`, `cyYoungRanking`, `rookieRanking`).
- UI: League view's "Awards watch" panel (top 5 each, click to drill in).

If you want to change the formula, edit `awards.ts` and update this doc in
the same PR. The numbers are deliberately exposed in the menu so any rebalance
is immediately visible.
