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
  drawOutfieldStands,
  drawHomeBowlStands,
} from './crowd.js';
import {
  drawStadiumCosmetic,
  flagAmplitudeFor,
} from './stadium-cosmetics.js';
import type { Stadium } from '../world/types.js';

// drawField is the static park art. Per CLAUDE.md the renderer is a pure
// function of (event log, tick); this layer paints everything that doesn't
// depend on player positions or the ball. The layering is deliberate —
// see the order in `drawField` below — so stadium chrome (warning track,
// foul poles, dugouts) overlays the grass pattern but sits beneath sprites.

const SKY = '#0e1a26';
const DEFAULT_GRASS_OUTFIELD = '#3b6e3a';
const DIRT = '#9a6a3d';
const DIRT_DARK = '#7c4f2a';
const FOUL_LINE = '#f3eedb';
const BASE_FILL = '#f8f7e8';

export interface FieldDrawOptions {
  // Per-stadium grass color from the stadium record's atmosphere.grassShade.
  // Falls back to the default field green if not provided.
  readonly grassShade?: string;
  // The background color outside the wall — Phase 6 atmosphere will tint this
  // per-stadium.
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
  // Home team's primary color — tints the dugout trim. Optional.
  readonly homeTeamPrimary?: string;
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

  // ---- Layer 1: sky / outside-the-park background --------------------------
  ctx.fillStyle = options.skyColor ?? SKY;
  ctx.fillRect(0, 0, t.canvasWidth, t.canvasHeight);

  // ---- Layer 2: distant silhouette / beyond-wall quirk decorations --------
  // (mountains, ponds, clock tower — drawn in sky band before stands so
  // stands occlude any spillover.)
  if (atmosphere) {
    drawStadiumCosmetic(quirk, {
      ctx,
      transform: t,
      wall,
      simTime,
      phase: 'beyond-wall',
    });
  }

  // ---- Layer 3: stands & roof bowl ----------------------------------------
  if (atmosphere) {
    drawOutfieldStands({
      ctx,
      transform: t,
      atmosphere,
      wall,
      inning,
      simTime,
    });
  }

  const grassBase = options.grassShade ?? atmosphere?.grassShade ?? DEFAULT_GRASS_OUTFIELD;
  const grassInfield = shiftHex(grassBase, +0.08);

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

  // Re-clip for the on-wall decorations that need to read as painted on
  // the wall surface (numbers, ivy). Without a clip the ivy would bleed
  // into the foul band; with this clip it tucks against the inside of
  // the wall outline.
  if (atmosphere) {
    drawStadiumCosmetic(quirk, {
      ctx,
      transform: t,
      wall,
      simTime,
      phase: 'on-wall',
    });
  }

  // ---- Layer 7: foul poles --------------------------------------------------
  drawFoulPoles(ctx, t, wall, {
    flagAmplitude: flagAmplitudeFor(quirk),
    simTime,
  });

  // ---- Layer 8: foul lines --------------------------------------------------
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

  // ---- Layer 9: home-plate stands (behind dugouts) ------------------------
  if (atmosphere) {
    drawHomeBowlStands({
      ctx,
      transform: t,
      atmosphere,
      wall,
      inning,
      simTime,
    });
  }

  // ---- Layer 10: backstop, dugouts, batter's boxes, on-deck circles -------
  drawBackstop(ctx, t);
  drawDugouts(
    ctx,
    t,
    options.homeTeamPrimary ? { trimColor: options.homeTeamPrimary } : {},
  );
  drawBatterBoxes(ctx, t);
  drawOnDeckCircles(ctx, t);

  // ---- Layer 11: bases ------------------------------------------------------
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
