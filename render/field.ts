import {
  HOME_PLATE,
  FIRST_BASE,
  SECOND_BASE,
  THIRD_BASE,
  PITCHERS_MOUND,
} from './field-geometry.js';
import { worldToScreen, type FieldTransform } from './transform.js';
import { buildWallPath, PLACEHOLDER_DIMENSIONS, type WallPath } from './wall.js';
import {
  drawWarningTrack,
  drawFoulPoles,
  drawBatterBoxes,
  drawOnDeckCircles,
  drawDugouts,
  drawBackstop,
  drawOutfieldWall,
} from './stadium-chrome.js';
import { drawGrassPattern } from './grass-patterns.js';
import {
  drawStadiumBowlBack,
  drawStadiumBowlFront,
} from './crowd.js';
import { buildStadiumBowl, type StadiumBowl } from './stadium-bowl.js';
import { drawSky } from './sky.js';
import {
  drawStadiumCosmetic,
  flagAmplitudeFor,
} from './stadium-cosmetics.js';
import type { Stadium } from '../world/types.js';

// drawField is the static park art. Per CLAUDE.md the renderer is a pure
// function of (event log, tick); this layer paints everything that doesn't
// depend on player positions or the ball. Layer order is:
//
//   1.  sky gradient + skyline silhouette + moon + light towers (back)
//   2.  beyond-wall quirk cosmetics (mountains, ponds, clock tower)
//   3.  stadium bowl BACK     (back-wall concrete + upper deck + roof)
//   3b. foul-territory grass  (fills bowl interior; later layers overpaint
//                              fair territory, leaving foul territory plain)
//   3c. foul-line dirt strips (running lanes on the foul side of each line)
//   4.  outfield wall outline + warning track
//   5.  outfield grass + mow pattern + in-field cosmetics
//   6.  infield dirt + infield grass + mound
//   7.  on-wall quirk cosmetics (ivy, distance signs)
//   8.  foul lines
//   9.  backstop, dugouts, batter's boxes, on-deck circles
//   10. stadium bowl FRONT    (lower-bowl seats + front railing)
//   11. foul poles
//   12. bases
//
// The crucial change vs. the previous implementation: the bowl is one
// continuous shape (see stadium-bowl.ts), drawn in TWO passes around the
// rest of the park art. That kills the "smile" gap behind home plate and
// fills the void above the outfield with a real upper-deck silhouette.

const DEFAULT_GRASS_OUTFIELD = '#3b6e3a';
const DIRT = '#9a6a3d';
const DIRT_DARK = '#7c4f2a';
const FOUL_LINE = '#f3eedb';
const BASE_FILL = '#f8f7e8';

export interface FieldDrawOptions {
  // Per-stadium grass color from the stadium record's atmosphere.grassShade.
  // Falls back to the default field green if not provided.
  readonly grassShade?: string;
  // Per-stadium horizon-glow tint at the very bottom of the sky gradient.
  // Optional — sky.ts has a sensible default warm bloom.
  readonly skyColor?: string;
  // Full stadium record. When provided, the renderer uses its dimensions
  // (per-segment wall arc), atmosphere (grass pattern, seat palette,
  // crowd density curve), and quirk (visual flourish) to flesh out the
  // park. When omitted, drawField falls back to the placeholder ballpark.
  readonly stadium?: Stadium;
  // Optional sim-time (in sim ticks) — drives subtle crowd flicker, foul-
  // pole flag ripple, and the clock-tower hand. Optional so unit tests can
  // call drawField with no animation context.
  readonly simTime?: number;
  // Current inning (1..9). Drives crowd density per the curve. Defaults to
  // 1 if absent.
  readonly inning?: number;
  // Home team's primary color — tints the 1B-side dugout trim. Optional.
  readonly homeTeamPrimary?: string;
  // Away team's primary color — tints the 3B-side dugout trim. Optional.
  readonly awayTeamPrimary?: string;
}

// Lighten/darken an #rrggbb hex by a delta (-1..1).
const shiftHex = (hex: string, delta: number): string => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + delta * 255)));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
};

// Build a Canvas2D path tracing the fair-territory polygon for clipping.
const fairTerritoryPath = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  wall: WallPath,
): void => {
  const home = worldToScreen(HOME_PLATE, t);
  ctx.moveTo(home.x, home.y);
  for (const sample of wall.samples) {
    const p = worldToScreen(sample.point, t);
    ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(home.x, home.y);
  ctx.closePath();
};

export const drawField = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  options: FieldDrawOptions = {},
): void => {
  const stadium = options.stadium;
  const dims = stadium?.dimensions ?? PLACEHOLDER_DIMENSIONS;
  const atmosphere = stadium?.atmosphere;
  const quirk = stadium?.quirk;
  const simTime = options.simTime ?? 0;
  const inning = options.inning ?? 1;
  const wall = buildWallPath(dims);
  const bowl = buildStadiumBowl(
    t,
    wall,
    atmosphere?.seatPalette ? { seatPalette: atmosphere.seatPalette } : {},
  );

  // ---- Layer 1: sky / skyline / moon / light towers -----------------------
  drawSky(
    {
      ctx,
      transform: t,
      wall,
      simTime,
      ...(options.skyColor ? { skyTint: options.skyColor } : {}),
    },
    bowl.lightTowers,
  );

  // ---- Layer 2: beyond-wall quirk decorations -----------------------------
  // Mountains, ponds, clock towers, mascot statues — drawn after the sky
  // but before the bowl so the bowl silhouette occludes any spillover.
  if (atmosphere) {
    drawStadiumCosmetic(quirk, {
      ctx,
      transform: t,
      wall,
      simTime,
      phase: 'beyond-wall',
    });
  }

  // ---- Layer 3: stadium bowl BACK (concrete + upper deck + roof) ----------
  if (atmosphere) {
    drawStadiumBowlBack({
      ctx,
      transform: t,
      atmosphere,
      bowl,
      inning,
      simTime,
    });
  }

  const grassBase = options.grassShade ?? atmosphere?.grassShade ?? DEFAULT_GRASS_OUTFIELD;
  const grassInfield = shiftHex(grassBase, +0.08);

  // ---- Layer 3b: foul-territory grass --------------------------------------
  // Fill the entire bowl interior with plain grass. The wall outline (3),
  // fair-territory mowed grass (5), and infield dirt (6) overpaint
  // everything inside fair territory, so this only remains visible in the
  // foul-territory band between the foul lines and the bowl front edge.
  drawFoulTerritoryGrass(ctx, bowl, grassBase);

  // ---- Layer 3c: foul-line dirt strips -------------------------------------
  // Thin dirt parallelograms on the foul side of each line, home → pole.
  drawFoulLineDirt(ctx, t, wall, DIRT);

  // ---- Layer 4: outfield wall ---------------------------------------------
  drawOutfieldWall(ctx, t, wall);

  // ---- Layer 5: outfield grass + selected pattern --------------------------
  // Everything from here in is clipped to fair territory so the dirt and
  // outfield grass can never bleed across the foul lines.
  ctx.save();
  ctx.beginPath();
  fairTerritoryPath(ctx, t, wall);
  ctx.clip();

  // Outfield grass — fills the whole fair territory.
  ctx.fillStyle = grassBase;
  ctx.fillRect(0, 0, t.canvasWidth, t.canvasHeight);

  // Mow stripes / pattern.
  drawGrassPattern(atmosphere?.grassPattern ?? 'plain', {
    ctx,
    transform: t,
    grassShade: grassBase,
    wall,
  });

  // Hill-CF / wind papers — in-field cosmetics that still sit under the dirt.
  if (atmosphere) {
    drawStadiumCosmetic(quirk, {
      ctx,
      transform: t,
      wall,
      simTime,
      phase: 'in-field',
    });
  }

  // Infield dirt — a smooth circular arc centered behind the mound.
  drawInfieldDirt(ctx, t);

  // Infield grass cutout — a small diamond inside the dirt.
  drawInfieldGrass(ctx, t, grassInfield);

  // Pitcher's mound.
  const mound = worldToScreen(PITCHERS_MOUND, t);
  const moundR = Math.max(6, t.pixelsPerFoot * 9);
  ctx.fillStyle = DIRT_DARK;
  ctx.beginPath();
  ctx.arc(mound.x, mound.y, moundR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5a3a22';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();

  // ---- Layer 6: warning track (drawn unclipped, sits inside the wall) -----
  drawWarningTrack(ctx, t, wall);

  // ---- Layer 7: on-wall quirk cosmetics (ivy, distance signs) -------------
  if (atmosphere) {
    drawStadiumCosmetic(quirk, {
      ctx,
      transform: t,
      wall,
      simTime,
      phase: 'on-wall',
    });
  }

  // ---- Layer 8: foul lines -------------------------------------------------
  ctx.strokeStyle = FOUL_LINE;
  ctx.lineWidth = 2;
  const home = worldToScreen(HOME_PLATE, t);
  const lf = worldToScreen(wall.leftFoul, t);
  const rf = worldToScreen(wall.rightFoul, t);
  ctx.beginPath();
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(lf.x, lf.y);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(rf.x, rf.y);
  ctx.stroke();

  // ---- Layer 9: backstop, dugouts, batter's boxes, on-deck circles -------
  drawBackstop(ctx, t);
  drawDugouts(ctx, t, {
    ...(options.homeTeamPrimary ? { homeTrimColor: options.homeTeamPrimary } : {}),
    ...(options.awayTeamPrimary ? { awayTrimColor: options.awayTeamPrimary } : {}),
  });
  drawBatterBoxes(ctx, t);
  drawOnDeckCircles(ctx, t);

  // ---- Layer 10: stadium bowl FRONT (lower-bowl seats + front railing) ----
  // Drawn AFTER dugouts so the dugouts read as carved into the front of
  // the bowl rather than floating in foul territory.
  if (atmosphere) {
    drawStadiumBowlFront({
      ctx,
      transform: t,
      atmosphere,
      bowl,
      inning,
      simTime,
    });
  }

  // ---- Layer 11: foul poles ------------------------------------------------
  drawFoulPoles(ctx, t, bowl.foulPoleBase, {
    flagAmplitude: flagAmplitudeFor(quirk),
    simTime,
  });

  // ---- Layer 12: bases ------------------------------------------------------
  drawBase(ctx, t, FIRST_BASE);
  drawBase(ctx, t, SECOND_BASE);
  drawBase(ctx, t, THIRD_BASE);
  drawHomePlate(ctx, t);
};

// The infield dirt is approximated by a circular arc. In MLB the dirt is a
// 95-ft-radius arc whose center sits about 9 ft behind the front edge of
// the rubber. We draw the equivalent arc here (radius 95 ft, center near
// the mound), then close it back along a baseline near home plate so the
// shape stays a solid fan, not a full circle that leaks over the bases.
const drawInfieldDirt = (ctx: CanvasRenderingContext2D, t: FieldTransform): void => {
  const ARC_RADIUS_FT = 95;
  const ARC_CENTER_Y_FT = 60.5; // behind the mound, MLB convention
  const center = worldToScreen({ x: 0, y: ARC_CENTER_Y_FT }, t);
  const radiusPx = ARC_RADIUS_FT * t.pixelsPerFoot;
  ctx.fillStyle = DIRT;
  ctx.beginPath();
  // Start at left-foul-side base path
  const leftBase = worldToScreen({ x: -ARC_RADIUS_FT, y: ARC_CENTER_Y_FT }, t);
  ctx.moveTo(leftBase.x, leftBase.y);
  // Sweep the arc through the outfield-side of the infield.
  ctx.arc(center.x, center.y, radiusPx, Math.PI, 0, false);
  // Close back along the home-plate-side: down through the base lines.
  // For a proper fan, drop straight back to home plate.
  const homePoint = worldToScreen(HOME_PLATE, t);
  ctx.lineTo(homePoint.x, homePoint.y);
  ctx.closePath();
  ctx.fill();
};

const drawInfieldGrass = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  fillColor: string,
): void => {
  // A small diamond just inside the bases — the standard "infield grass"
  // cutout that defines the running surface around the bases.
  const inset = 16; // ft inside each base
  const a = worldToScreen({ x: 0, y: 30 }, t);
  const b = worldToScreen({ x: FIRST_BASE.x - inset, y: FIRST_BASE.y - inset }, t);
  const c = worldToScreen({ x: 0, y: SECOND_BASE.y - 14 }, t);
  const d = worldToScreen({ x: THIRD_BASE.x + inset, y: THIRD_BASE.y - inset }, t);
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();
};

const drawBase = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  pt: { x: number; y: number },
): void => {
  const s = worldToScreen(pt, t);
  const sz = Math.max(4, Math.round(t.pixelsPerFoot * 1.6));
  ctx.fillStyle = BASE_FILL;
  ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
  ctx.strokeStyle = '#cdcab1';
  ctx.lineWidth = 1;
  ctx.strokeRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
};

// Plain grass over the entire bowl interior. Drawn after the bowl back so it
// doesn't paint over the upper-deck silhouette, but before the wall outline
// and fair-territory grass so those layers paint over the fair-side area.
// What remains visible is the foul-territory band between the foul lines and
// the lower-bowl front edge.
const drawFoulTerritoryGrass = (
  ctx: CanvasRenderingContext2D,
  bowl: StadiumBowl,
  fillColor: string,
): void => {
  const front = bowl.front;
  if (front.length === 0) return;
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(front[0]!.screen.x, front[0]!.screen.y);
  for (let i = 1; i < front.length; i++) {
    ctx.lineTo(front[i]!.screen.x, front[i]!.screen.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

// A dirt running-lane on the foul side of each foul line, from home plate to
// the foul pole. Drawn as a parallelogram offset perpendicular into foul
// territory. The chalk foul line is drawn later (Layer 8) and sits exactly on
// the inner edge of the dirt.
const drawFoulLineDirt = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  wall: WallPath,
  fillColor: string,
): void => {
  const FOUL_LINE_DIRT_WIDTH_FT = 6;
  const home = worldToScreen(HOME_PLATE, t);
  const widthPx = FOUL_LINE_DIRT_WIDTH_FT * t.pixelsPerFoot;
  ctx.save();
  ctx.fillStyle = fillColor;
  for (const corner of [wall.leftFoul, wall.rightFoul]) {
    const cornerScreen = worldToScreen(corner, t);
    const dx = cornerScreen.x - home.x;
    const dy = cornerScreen.y - home.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Pick the perpendicular pointing into foul territory: same x-sign as the
    // line itself (RF line goes right → foul side is further right; LF line
    // goes left → foul side is further left).
    const perpX = -uy;
    const perpY = ux;
    const sign = Math.sign(perpX) === Math.sign(dx) ? 1 : -1;
    const nx = perpX * sign;
    const ny = perpY * sign;
    ctx.beginPath();
    ctx.moveTo(home.x, home.y);
    ctx.lineTo(home.x + nx * widthPx, home.y + ny * widthPx);
    ctx.lineTo(cornerScreen.x + nx * widthPx, cornerScreen.y + ny * widthPx);
    ctx.lineTo(cornerScreen.x, cornerScreen.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
};

const drawHomePlate = (ctx: CanvasRenderingContext2D, t: FieldTransform): void => {
  const s = worldToScreen(HOME_PLATE, t);
  const sz = Math.max(4, Math.round(t.pixelsPerFoot * 1.4));
  ctx.fillStyle = BASE_FILL;
  ctx.beginPath();
  ctx.moveTo(s.x - sz / 2, s.y - sz / 2);
  ctx.lineTo(s.x + sz / 2, s.y - sz / 2);
  ctx.lineTo(s.x + sz / 2 + 2, s.y);
  ctx.lineTo(s.x, s.y + sz / 2);
  ctx.lineTo(s.x - sz / 2 - 2, s.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#cdcab1';
  ctx.stroke();
};
