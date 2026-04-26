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
  C: { x: 0, y: -5 },
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
