import type { FieldPoint } from './types.js';
import { TOP_HUD_HEIGHT, bottomHudReserved } from './hud.js';

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
// Pixels reserved between home plate and the BOTTOM of the bottom HUD
// panels — i.e. the catcher sprite + a small gap. The HUD itself reserves
// its own height via bottomHudReserved(canvasWidth).
const CATCHER_CLEAR = 30;

export const computeTransform = (canvasWidth: number, canvasHeight: number): FieldTransform => {
  const fieldTop = TOP_HUD_HEIGHT + 10; // small breathing room below the bug
  const homeBottomMargin = CATCHER_CLEAR + bottomHudReserved(canvasWidth);
  const fieldBottom = canvasHeight - homeBottomMargin;
  const usableHeight = Math.max(100, fieldBottom - fieldTop);
  const usableWidth = canvasWidth * 0.95;
  const scaleByY = usableHeight / TARGET_OUTFIELD_FT;
  const scaleByX = usableWidth / (TARGET_FOUL_FT * 2);
  const pixelsPerFoot = Math.min(scaleByX, scaleByY);
  // Anchor home plate so the field is vertically centered in the usable
  // band when the X scale is the limiting factor (e.g. portrait phones).
  // Otherwise the field hugs the bottom margin and leaves a yawning gap
  // beneath the top HUD.
  const fieldHeight = TARGET_OUTFIELD_FT * pixelsPerFoot;
  const centerY = (fieldTop + fieldBottom) / 2;
  const homePlateY = Math.min(fieldBottom, centerY + fieldHeight / 2);
  const homePlateScreen = {
    x: canvasWidth / 2,
    y: homePlateY,
  };
  return { canvasWidth, canvasHeight, homePlateScreen, pixelsPerFoot };
};

export const worldToScreen = (p: FieldPoint, t: FieldTransform): { x: number; y: number } => ({
  x: t.homePlateScreen.x + p.x * t.pixelsPerFoot,
  y: t.homePlateScreen.y - p.y * t.pixelsPerFoot,
});
