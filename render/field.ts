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
const GRASS_OUTFIELD = '#3b6e3a';
const GRASS_INFIELD = '#487a47';
const DIRT = '#9a6a3d';
const DIRT_DARK = '#7c4f2a';
const WALL_LINE = '#1a1a1a';
const FOUL_LINE = '#f3eedb';
const BASE_FILL = '#f8f7e8';

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

export const drawField = (ctx: CanvasRenderingContext2D, t: FieldTransform): void => {
  // Sky / outside-the-park background (covers the foul-territory wedges too).
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, t.canvasWidth, t.canvasHeight);

  // Everything from here in is clipped to fair territory so the dirt and
  // outfield grass can never bleed across the foul lines.
  ctx.save();
  ctx.beginPath();
  fairTerritoryPath(ctx, t);
  ctx.clip();

  // Outfield grass — fills the whole fair territory (the infield shape will
  // overpaint it with dirt below).
  ctx.fillStyle = GRASS_OUTFIELD;
  ctx.fillRect(0, 0, t.canvasWidth, t.canvasHeight);

  // Infield dirt — a smooth circular arc centered behind the mound. This
  // hugs the bases without extending past the foul lines (the clip would
  // catch it anyway, but a rounded shape reads better than a clipped quad).
  drawInfieldDirt(ctx, t);

  // Infield grass cutout — a small diamond inside the dirt.
  drawInfieldGrass(ctx, t);

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

  // Outfield wall outline (drawn outside the clip so it sits on top).
  ctx.strokeStyle = WALL_LINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  const lf = worldToScreen(polarToField(-45, OUTFIELD_DEPTHS.leftFoul), t);
  const lc = worldToScreen(polarToField(-22, OUTFIELD_DEPTHS.leftCenter), t);
  const cf = worldToScreen(polarToField(0, OUTFIELD_DEPTHS.center), t);
  const rc = worldToScreen(polarToField(22, OUTFIELD_DEPTHS.rightCenter), t);
  const rf = worldToScreen(polarToField(45, OUTFIELD_DEPTHS.rightFoul), t);
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

const drawInfieldGrass = (ctx: CanvasRenderingContext2D, t: FieldTransform): void => {
  // A small diamond just inside the bases — the standard "infield grass"
  // cutout that defines the running surface around the bases.
  const inset = 16; // ft inside each base
  const a = worldToScreen({ x: 0, y: 30 }, t);
  const b = worldToScreen({ x: FIRST_BASE.x - inset, y: FIRST_BASE.y - inset }, t);
  const c = worldToScreen({ x: 0, y: SECOND_BASE.y - 14 }, t);
  const d = worldToScreen({ x: THIRD_BASE.x + inset, y: THIRD_BASE.y - inset }, t);
  ctx.fillStyle = GRASS_INFIELD;
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
