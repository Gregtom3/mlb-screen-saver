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

// Dugouts — recessed rectangles in foul territory, **rotated to lie parallel
// to the foul lines** rather than the baseline. The diagonal orientation
// matches real ballparks (the dugouts hug the foul-line edge of the bowl)
// and gives the on-deck batter a natural sightline to the plate.
//
// Convention: the 1B-side (right) dugout belongs to the **home** team; the
// 3B-side (left) dugout belongs to the **away** team. Walk-offs in scene.ts
// pick which dugout to head toward based on team membership, not x-sign.
//
// Shape: ~46 ft long along the foul line × ~9 ft deep into foul territory.
// Center is offset so the dugout sits ~13 ft into foul (clear of the foul-
// line dirt strip) and starts ~30 ft from home plate along the foul line.
export const DUGOUT_RIGHT_RECT = {
  cx: 70,
  cy: 30,
  lengthFt: 46,
  depthFt: 9,
  // Long axis parallel to the 1B foul line (45° in field coords).
  angleRad: Math.PI / 4,
} as const;
export const DUGOUT_LEFT_RECT = {
  cx: -70,
  cy: 30,
  lengthFt: 46,
  depthFt: 9,
  // Long axis parallel to the 3B foul line.
  angleRad: -Math.PI / 4,
} as const;

// Structural shape — both DUGOUT_*_RECT consts widen to this so callers
// (the doorway helper, the chrome renderer) can treat them uniformly even
// though TS narrows each `as const` literal to its own distinct type.
export interface DugoutRect {
  readonly cx: number;
  readonly cy: number;
  readonly lengthFt: number;
  readonly depthFt: number;
  readonly angleRad: number;
}

// "Doorway" points — where players appear to disappear into / emerge from
// the dugout. Picked at the front edge midpoint of each rotated rectangle,
// closer to home plate so the walk-off path is short and the on-deck circle
// can sit just in front of it without overlapping.
const dugoutDoorway = (rect: DugoutRect): FieldPoint => {
  const cos = Math.cos(rect.angleRad);
  const sin = Math.sin(rect.angleRad);
  // Front edge (toward fair territory) midpoint, then nudged toward home
  // plate along the long axis so the doorway sits at the home-plate end.
  const halfLen = rect.lengthFt * 0.42;
  const halfDepth = rect.depthFt * 0.45;
  // Direction "toward fair territory" is the inward perpendicular —
  // for the right dugout the perp pointing into fair is (-sin, +cos)
  // rotated; equivalently the field-side perp.
  // The right dugout's fair side is up-and-left of the long axis, so
  // perp into fair = (-sin, cos). For the left dugout (angle = -π/4),
  // (-sin, cos) = (sin45, cos45) — points up-right, into fair. Good.
  const fairPerpX = -sin;
  const fairPerpY = cos;
  // Home-plate end of the long axis — toward home plate so the doorway sits
  // closer to the action, near the on-deck circle.
  const towardHomeX = rect.cx > 0 ? -cos : cos;
  const towardHomeY = rect.cx > 0 ? -sin : sin;
  return {
    x: rect.cx + halfLen * towardHomeX + halfDepth * fairPerpX,
    y: rect.cy + halfLen * towardHomeY + halfDepth * fairPerpY,
  };
};

// Walk-off / walk-on anchor for each side. The home team's dugout is the
// 1B-side rectangle; the away team's is the 3B-side rectangle.
export const DUGOUT_DOORWAY_HOME: FieldPoint = dugoutDoorway(DUGOUT_RIGHT_RECT);
export const DUGOUT_DOORWAY_AWAY: FieldPoint = dugoutDoorway(DUGOUT_LEFT_RECT);

// On-deck circles — sit just in front of (toward home plate from) each
// dugout doorway, on the foul side of the line so the on-deck batter's
// silhouette doesn't crowd the diamond. Standard MLB diameter is 5ft; the
// renderer uses the world-coord radius below.
const onDeckPoint = (doorway: FieldPoint, sign: -1 | 1): FieldPoint => ({
  // Pulled ~6 ft toward home along the foul line and slightly back into
  // foul territory so the swinging on-deck batter doesn't visually
  // overlap with the dugout doorway.
  x: doorway.x - sign * 5,
  y: doorway.y - 7,
});
export const ON_DECK_RIGHT: FieldPoint = onDeckPoint(DUGOUT_DOORWAY_HOME, +1);
export const ON_DECK_LEFT: FieldPoint = onDeckPoint(DUGOUT_DOORWAY_AWAY, -1);
export const ON_DECK_RADIUS_FT = 2.5;

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
