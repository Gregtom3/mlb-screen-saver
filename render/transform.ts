import type { FieldPoint } from './types.js';
import { SCOREBUG_HEIGHT } from './hud.js';

// Maps field coordinates (feet, home plate at origin, +Y toward outfield)
// to canvas pixels. The renderer asks for a transform once per frame given
// the current canvas size; everything downstream uses worldToScreen().

export interface FieldTransform {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly homePlateScreen: { x: number; y: number };
  readonly pixelsPerFoot: number;
}

const TARGET_OUTFIELD_FT = 420; // a touch past the deepest fence
const TARGET_FOUL_FT = 240; // half of the lateral spread we want visible
const HOME_BOTTOM_MARGIN = 110; // px below home plate, leaves room for catcher + bottom HUD panels

export const computeTransform = (canvasWidth: number, canvasHeight: number): FieldTransform => {
  const fieldTop = SCOREBUG_HEIGHT + 10; // small breathing room below the bug
  const fieldBottom = canvasHeight - HOME_BOTTOM_MARGIN;
  const usableHeight = Math.max(100, fieldBottom - fieldTop);
  const usableWidth = canvasWidth * 0.95;
  const scaleByY = usableHeight / TARGET_OUTFIELD_FT;
  const scaleByX = usableWidth / (TARGET_FOUL_FT * 2);
  const pixelsPerFoot = Math.min(scaleByX, scaleByY);
  const homePlateScreen = {
    x: canvasWidth / 2,
    y: fieldBottom,
  };
  return { canvasWidth, canvasHeight, homePlateScreen, pixelsPerFoot };
};

export const worldToScreen = (p: FieldPoint, t: FieldTransform): { x: number; y: number } => ({
  x: t.homePlateScreen.x + p.x * t.pixelsPerFoot,
  y: t.homePlateScreen.y - p.y * t.pixelsPerFoot,
});
