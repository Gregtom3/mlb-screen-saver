import type { FieldPoint } from './types.js';

// Canonical landmarks in field coordinates (feet, home plate = origin).
// Used by the scene reducer for entity placement and by the field drawer
// for the static park art.

export const HOME_PLATE: FieldPoint = { x: 0, y: 0 };
export const PITCHERS_MOUND: FieldPoint = { x: 0, y: 60.5 };
const BASE_OFFSET = 90 / Math.SQRT2;
export const FIRST_BASE: FieldPoint = { x: BASE_OFFSET, y: BASE_OFFSET };
export const SECOND_BASE: FieldPoint = { x: 0, y: BASE_OFFSET * 2 };
export const THIRD_BASE: FieldPoint = { x: -BASE_OFFSET, y: BASE_OFFSET };

// Default fielder home positions for the placeholder ballpark.
// Phase 4 will let stadium quirks shift these (e.g. a deep CF pulls the
// outfielders back, a no-doubles defense shifts everyone toward the lines).
export const FIELDER_HOME_POSITIONS = {
  P: PITCHERS_MOUND,
  C: { x: 0, y: -8 },
  '1B': { x: 60, y: 80 },
  '2B': { x: 36, y: 118 },
  SS: { x: -36, y: 118 },
  '3B': { x: -60, y: 80 },
  LF: { x: -130, y: 230 },
  CF: { x: 0, y: 280 },
  RF: { x: 130, y: 230 },
} as const satisfies Record<string, FieldPoint>;

export const BATTER_BOX_LEFT: FieldPoint = { x: -3.5, y: 0 };
export const BATTER_BOX_RIGHT: FieldPoint = { x: 3.5, y: 0 };

// Chalk box dimensions (4ft × 6ft each, MLB-spec). The batter stands at the
// center; the box runs from the front of the plate forward toward the
// pitcher and backward toward the catcher.
export const BATTER_BOX_WIDTH_FT = 4;
export const BATTER_BOX_DEPTH_FT = 6;

// On-deck circles — a stride or two outside the batter's-box pair, between
// the boxes and the dugouts. Standard MLB diameter is 5ft; the renderer
// uses the world-coord radius below.
export const ON_DECK_LEFT: FieldPoint = { x: -22, y: -4 };
export const ON_DECK_RIGHT: FieldPoint = { x: 22, y: -4 };
export const ON_DECK_RADIUS_FT = 2.5;

// Dugouts — recessed rectangles in foul territory, flanking the foul lines
// roughly a third of the way from home toward 1B / 3B. Sit between the
// chalk lines and the lower-bowl front edge so they read as part of the
// stadium silhouette instead of stranded boxes behind home plate (the
// previous y=-22 placement put them between home and the floating "smile"
// arc, which looked broken).
//
// Shape sized to read at screensaver scale: ~42ft wide × ~9ft deep, parallel
// to the baseline. Sim-side runner walk-offs (in /render/scene.ts) read
// these constants so the path-out still ends at the dugout.
export const DUGOUT_LEFT_RECT = {
  cx: -75,
  cy: 26,
  widthFt: 42,
  depthFt: 9,
} as const;
export const DUGOUT_RIGHT_RECT = {
  cx: 75,
  cy: 26,
  widthFt: 42,
  depthFt: 9,
} as const;

// Backstop arc — the rounded fence behind the catcher. Sits ~60ft behind
// home plate at its deepest point, sweeping foul-line to foul-line.
export const BACKSTOP = {
  centerY: -32,
  radiusFt: 38,
} as const;

export const baseFor = (
  base: 0 | 1 | 2 | 3,
): FieldPoint => {
  switch (base) {
    case 0: return HOME_PLATE;
    case 1: return FIRST_BASE;
    case 2: return SECOND_BASE;
    case 3: return THIRD_BASE;
  }
};

export const lerpPoint = (a: FieldPoint, b: FieldPoint, t: number): FieldPoint => {
  const u = Math.max(0, Math.min(1, t));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
};
