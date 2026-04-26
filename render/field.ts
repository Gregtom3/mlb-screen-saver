import {
  HOME_PLATE,
  FIRST_BASE,
  SECOND_BASE,
  THIRD_BASE,
  PITCHERS_MOUND,
} from './field-geometry.js';
import { worldToScreen, type FieldTransform } from './transform.js';

// Phase 2 placeholder ballpark. Drawn programmatically. Phase 4 swaps in
// per-stadium grass patterns, dimensions, and quirks via the registry.

const SKY = '#0e1a26';
const DEFAULT_GRASS_OUTFIELD = '#3b6e3a';
const DIRT = '#9a6a3d';
const DIRT_DARK = '#7c4f2a';
const WALL_LINE = '#1a1a1a';
const FOUL_LINE = '#f3eedb';
const BASE_FILL = '#f8f7e8';

export interface FieldDrawOptions {
  // Per-stadium grass color from the stadium record's atmosphere.grassShade.
  // Falls back to the default field green if not provided.
  readonly grassShade?: string;
  // The background color outside the wall — Phase 6 atmosphere will tint this
  // per-stadium.
  readonly skyColor?: string;
}

// Lighten/darken an #rrggbb hex by a delta (-1..1). Used for mow stripes.
const shiftHex = (hex: string, delta: number): string => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + delta * 255)));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
};

// Approximate outfield arc. From foul-line corners at ±45° and a target depth.
const OUTFIELD_DEPTHS = {
  leftFoul: 335,
  leftCenter: 380,
  center: 410,
  rightCenter: 380,
  rightFoul: 335,
};

const polarToField = (angleDeg: number, distFt: number) => {
  // angle 0 = straight to CF (+Y), -45 = LF foul, +45 = RF foul.
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(rad) * distFt, y: Math.cos(rad) * distFt };
};

// Build the fair-territory polygon path on the current ctx.
const fairTerritoryPath = (ctx: CanvasRenderingContext2D, t: FieldTransform): void => {
  const home = worldToScreen(HOME_PLATE, t);
  const lf = worldToScreen(polarToField(-45, OUTFIELD_DEPTHS.leftFoul), t);
  const lc = worldToScreen(polarToField(-22, OUTFIELD_DEPTHS.leftCenter), t);
  const cf = worldToScreen(polarToField(0, OUTFIELD_DEPTHS.center), t);
  const rc = worldToScreen(polarToField(22, OUTFIELD_DEPTHS.rightCenter), t);
  const rf = worldToScreen(polarToField(45, OUTFIELD_DEPTHS.rightFoul), t);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(lf.x, lf.y);
  ctx.quadraticCurveTo(lc.x, lc.y - 12, cf.x, cf.y);
  ctx.quadraticCurveTo(rc.x, rc.y - 12, rf.x, rf.y);
  ctx.lineTo(home.x, home.y);
  ctx.closePath();
};

export const drawField = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  options: FieldDrawOptions = {},
): void => {
  // Sky / outside-the-park background (covers the foul-territory wedges too).
  ctx.fillStyle = options.skyColor ?? SKY;
  ctx.fillRect(0, 0, t.canvasWidth, t.canvasHeight);

  const grassBase = options.grassShade ?? DEFAULT_GRASS_OUTFIELD;
  const grassDark = shiftHex(grassBase, -0.04);
  const grassLight = shiftHex(grassBase, +0.04);
  const grassInfield = shiftHex(grassBase, +0.08);

  // Everything from here in is clipped to fair territory so the dirt and
  // outfield grass can never bleed across the foul lines.
  ctx.save();
  ctx.beginPath();
  fairTerritoryPath(ctx, t);
  ctx.clip();

  // Outfield grass — fills the whole fair territory.
  ctx.fillStyle = grassBase;
  ctx.fillRect(0, 0, t.canvasWidth, t.canvasHeight);

  // Mow stripes — alternating dark/light wedges radiating from home plate.
  // Carries enormous aesthetic weight per the polish brief.
  drawMowStripes(ctx, t, grassDark, grassLight);

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

  const lf = worldToScreen(polarToField(-45, OUTFIELD_DEPTHS.leftFoul), t);
  const lc = worldToScreen(polarToField(-22, OUTFIELD_DEPTHS.leftCenter), t);
  const cf = worldToScreen(polarToField(0, OUTFIELD_DEPTHS.center), t);
  const rc = worldToScreen(polarToField(22, OUTFIELD_DEPTHS.rightCenter), t);
  const rf = worldToScreen(polarToField(45, OUTFIELD_DEPTHS.rightFoul), t);

  // Stadium frame band — concrete-gray stroke wider than the wall, drawn
  // first so the wall outline overlays cleanly on top. Suggests the back
  // of the stands behind the wall.
  ctx.strokeStyle = '#5a626c';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(lf.x, lf.y);
  ctx.quadraticCurveTo(lc.x, lc.y - 12, cf.x, cf.y);
  ctx.quadraticCurveTo(rc.x, rc.y - 12, rf.x, rf.y);
  ctx.stroke();

  // Wall outline on top, thinner.
  ctx.strokeStyle = WALL_LINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(lf.x, lf.y);
  ctx.quadraticCurveTo(lc.x, lc.y - 12, cf.x, cf.y);
  ctx.quadraticCurveTo(rc.x, rc.y - 12, rf.x, rf.y);
  ctx.stroke();

  // Foul lines (drawn after the clip so they sit cleanly on the boundary).
  ctx.strokeStyle = FOUL_LINE;
  ctx.lineWidth = 2;
  const home = worldToScreen(HOME_PLATE, t);
  ctx.beginPath();
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(lf.x, lf.y);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(rf.x, rf.y);
  ctx.stroke();

  // Bases.
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

// Radial mow stripes from home plate. The fair territory is a 90° wedge
// (roughly 225°→315° in canvas-clockwise radians). We paint alternating
// thin wedges in a dark/light pair so the outfield reads as mowed.
const drawMowStripes = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  darkColor: string,
  lightColor: string,
): void => {
  const home = worldToScreen(HOME_PLATE, t);
  const N_STRIPES = 14;
  // -135° → -45° in canvas radians spans the fair-territory wedge.
  const startRad = (-135 * Math.PI) / 180;
  const endRad = (-45 * Math.PI) / 180;
  const stripeSpan = (endRad - startRad) / N_STRIPES;
  const outerRadius = Math.hypot(t.canvasWidth, t.canvasHeight); // safe-large

  for (let i = 0; i < N_STRIPES; i++) {
    const a1 = startRad + i * stripeSpan;
    const a2 = a1 + stripeSpan;
    ctx.fillStyle = i % 2 === 0 ? darkColor : lightColor;
    ctx.beginPath();
    ctx.moveTo(home.x, home.y);
    ctx.arc(home.x, home.y, outerRadius, a1, a2);
    ctx.closePath();
    ctx.fill();
  }
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
