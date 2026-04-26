import type { FieldPoint } from './types.js';

// Maps the abstract field coordinate system (feet, home plate at origin,
// +Y toward outfield) to canvas pixels. The renderer asks for a transform
// once per frame given the current canvas size; everything downstream
// just uses worldToScreen().

export interface FieldTransform {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly homePlateScreen: { x: number; y: number };
  readonly pixelsPerFoot: number;
}

const TARGET_OUTFIELD_FT = 420; // a bit beyond the deepest fence
const TARGET_FOUL_FT = 250; // half of the lateral spread we want visible
const HUD_TOP_FT = 30; // reserved space above the field for the HUD

export const computeTransform = (canvasWidth: number, canvasHeight: number): FieldTransform => {
  // Solve for a px/ft scale that fits both the deep CF and the foul lines.
  const usableHeight = canvasHeight * 0.92; // leave a little for the bottom HUD
  const usableWidth = canvasWidth * 0.95;
  const scaleByY = usableHeight / (TARGET_OUTFIELD_FT + HUD_TOP_FT);
  const scaleByX = usableWidth / (TARGET_FOUL_FT * 2);
  const pixelsPerFoot = Math.min(scaleByX, scaleByY);
  // Place home plate near the bottom-center, with a margin.
  const homePlateScreen = {
    x: canvasWidth / 2,
    y: canvasHeight - 32,
  };
  return { canvasWidth, canvasHeight, homePlateScreen, pixelsPerFoot };
};

export const worldToScreen = (p: FieldPoint, t: FieldTransform): { x: number; y: number } => ({
  x: t.homePlateScreen.x + p.x * t.pixelsPerFoot,
  y: t.homePlateScreen.y - p.y * t.pixelsPerFoot,
});
