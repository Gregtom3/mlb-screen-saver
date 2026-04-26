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

export const drawField = (ctx: CanvasRenderingContext2D, t: FieldTransform): void => {
  // Sky / behind-stadium background.
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, t.canvasWidth, t.canvasHeight);

  // Outfield grass — fill area from foul lines outward to the wall.
  ctx.fillStyle = GRASS_OUTFIELD;
  ctx.beginPath();
  const home = worldToScreen(HOME_PLATE, t);
  const lf = worldToScreen(polarToField(-45, OUTFIELD_DEPTHS.leftFoul), t);
  const lc = worldToScreen(polarToField(-22, OUTFIELD_DEPTHS.leftCenter), t);
  const cf = worldToScreen(polarToField(0, OUTFIELD_DEPTHS.center), t);
  const rc = worldToScreen(polarToField(22, OUTFIELD_DEPTHS.rightCenter), t);
  const rf = worldToScreen(polarToField(45, OUTFIELD_DEPTHS.rightFoul), t);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(lf.x, lf.y);
  // Smooth curve through the wall — cubic-ish via three quadratic segments.
  ctx.quadraticCurveTo(lc.x, lc.y - 12, cf.x, cf.y);
  ctx.quadraticCurveTo(rc.x, rc.y - 12, rf.x, rf.y);
  ctx.lineTo(home.x, home.y);
  ctx.closePath();
  ctx.fill();

  // Outfield wall outline.
  ctx.strokeStyle = WALL_LINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(lf.x, lf.y);
  ctx.quadraticCurveTo(lc.x, lc.y - 12, cf.x, cf.y);
  ctx.quadraticCurveTo(rc.x, rc.y - 12, rf.x, rf.y);
  ctx.stroke();

  // Infield dirt — diamond bounded by the four bases, expanded a bit.
  const padFt = 18;
  const infield: { x: number; y: number }[] = [
    worldToScreen({ x: 0, y: -padFt }, t),
    worldToScreen({ x: FIRST_BASE.x + padFt, y: FIRST_BASE.y - padFt }, t),
    worldToScreen({ x: SECOND_BASE.x, y: SECOND_BASE.y + padFt }, t),
    worldToScreen({ x: THIRD_BASE.x - padFt, y: THIRD_BASE.y - padFt }, t),
  ];
  ctx.fillStyle = DIRT;
  ctx.beginPath();
  ctx.moveTo(infield[0]!.x, infield[0]!.y);
  for (let i = 1; i < infield.length; i++) {
    ctx.lineTo(infield[i]!.x, infield[i]!.y);
  }
  ctx.closePath();
  ctx.fill();

  // Infield grass cutout (small, centered on the diamond, not extending to bases).
  const cutoutFt = 26;
  ctx.fillStyle = GRASS_INFIELD;
  ctx.beginPath();
  const c1 = worldToScreen({ x: 0, y: 30 }, t);
  const c2 = worldToScreen({ x: cutoutFt, y: 60 }, t);
  const c3 = worldToScreen({ x: 0, y: 90 }, t);
  const c4 = worldToScreen({ x: -cutoutFt, y: 60 }, t);
  ctx.moveTo(c1.x, c1.y);
  ctx.lineTo(c2.x, c2.y);
  ctx.lineTo(c3.x, c3.y);
  ctx.lineTo(c4.x, c4.y);
  ctx.closePath();
  ctx.fill();

  // Pitcher's mound (small dirt circle).
  const mound = worldToScreen(PITCHERS_MOUND, t);
  const moundR = Math.max(6, t.pixelsPerFoot * 9);
  ctx.fillStyle = DIRT_DARK;
  ctx.beginPath();
  ctx.arc(mound.x, mound.y, moundR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5a3a22';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Foul lines.
  ctx.strokeStyle = FOUL_LINE;
  ctx.lineWidth = 2;
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
