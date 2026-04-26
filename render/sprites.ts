import type { ScenePlayer, SceneState } from './types.js';
import { worldToScreen, type FieldTransform } from './transform.js';

// 12×12 pixel-art player, top-down ¾ view. Encoded as a string grid:
//   '.' transparent, 'C' cap, 'J' jersey, 'S' skin, 'P' pants, 'B' belt.
// Tinted at draw time by capColor and jerseyColor from the team record.
const PLAYER_SPRITE: readonly string[] = [
  '............',
  '.....CC.....',
  '....CCCC....',
  '....CCCC....',
  '....SSSS....',
  '...JJJJJJ...',
  '..JJJJJJJJ..',
  '..JJJJJJJJ..',
  '...BBBBBB...',
  '...PPPPPP...',
  '...PPPPPP...',
  '....P..P....',
];

const PLAYER_SPRITE_W = 12;
const PLAYER_SPRITE_H = 12;

// Fixed colors for the non-team parts of the sprite.
const SKIN_COLOR = '#c79475';
const PANTS_COLOR = '#3a3f4a';
const BELT_COLOR = '#2a2d33';
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.45)';
const SPRITE_OUTLINE = '#0c0d10';

// Scale chosen so a sprite reads clearly at the default 960×720 viewport.
const SCALE_PX_PER_FT = 0.55;

const drawShadow = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scaleSize: number,
): void => {
  ctx.fillStyle = SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(cx, cy + scaleSize * 5, scaleSize * 4.5, scaleSize * 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
};

const colorForCode = (code: string, capColor: string, jerseyColor: string): string | null => {
  switch (code) {
    case 'C':
      return capColor;
    case 'J':
      return jerseyColor;
    case 'S':
      return SKIN_COLOR;
    case 'P':
      return PANTS_COLOR;
    case 'B':
      return BELT_COLOR;
    case 'O':
      return SPRITE_OUTLINE;
    default:
      return null;
  }
};

const drawPixelSprite = (
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  cx: number,
  cy: number,
  pixelSize: number,
  capColor: string,
  jerseyColor: string,
): void => {
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  const left = cx - (w * pixelSize) / 2;
  const top = cy - (h * pixelSize) / 2;
  for (let r = 0; r < h; r++) {
    const line = rows[r]!;
    for (let c = 0; c < w; c++) {
      const code = line[c]!;
      if (code === '.' || code === ' ') continue;
      const color = colorForCode(code, capColor, jerseyColor);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(
        Math.floor(left + c * pixelSize),
        Math.floor(top + r * pixelSize),
        Math.ceil(pixelSize),
        Math.ceil(pixelSize),
      );
    }
  }
};

const drawPlayer = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  p: ScenePlayer,
): void => {
  const s = worldToScreen(p.position, t);
  const pixelSize = Math.max(1.5, t.pixelsPerFoot * SCALE_PX_PER_FT);
  drawShadow(ctx, s.x, s.y, pixelSize);
  drawPixelSprite(ctx, PLAYER_SPRITE, s.x, s.y, pixelSize, p.primaryColor, p.secondaryColor);

  // Role-specific accents.
  if (p.role === 'batter') {
    const dir = p.position.x < 0 ? -1 : 1;
    ctx.strokeStyle = '#d6b78a';
    ctx.lineWidth = Math.max(1.5, pixelSize * 1.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x + dir * pixelSize * 4, s.y - pixelSize * 1);
    ctx.lineTo(s.x + dir * pixelSize * 7, s.y - pixelSize * 5);
    ctx.stroke();
  } else if (p.role === 'pitcher') {
    // Rubber strip behind the pitcher.
    ctx.fillStyle = '#f3eedb';
    ctx.fillRect(
      Math.floor(s.x - pixelSize * 3),
      Math.floor(s.y + pixelSize * 6),
      Math.ceil(pixelSize * 6),
      Math.max(1, Math.ceil(pixelSize * 0.6)),
    );
  }
};

// Ball constants
const VERTICAL_SCALE = 0.8;
const SHADOW_FALLOFF_FT = 80;

const drawBall = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  if (!scene.ball.visible) return;
  const ground = worldToScreen(scene.ball.position, t);
  const heightPx = scene.ball.heightFt * t.pixelsPerFoot * VERTICAL_SCALE;
  const baseRadius = 3;
  const ballRadius = baseRadius + scene.ball.heightFt * 0.04;

  if (scene.ball.inFlight && scene.ball.heightFt > 0.1) {
    const heightFactor = Math.min(1, scene.ball.heightFt / SHADOW_FALLOFF_FT);
    const shadowAlpha = 0.55 * (1 - heightFactor * 0.55);
    const shadowR = baseRadius * (1.1 - heightFactor * 0.4);
    ctx.fillStyle = `rgba(8, 12, 16, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, shadowR + 1, shadowR * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const bx = ground.x;
  const by = ground.y - heightPx;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bx, by, ballRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (scene.ball.heightFt > 12) {
    ctx.fillStyle = '#c4262e';
    ctx.beginPath();
    ctx.arc(bx + ballRadius * 0.2, by - ballRadius * 0.2, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
};

export const drawScene = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  // Order: catcher (back), fielders, pitcher, runners, batter, ball (top).
  if (scene.catcher) drawPlayer(ctx, t, scene.catcher);
  for (const f of scene.fielders) drawPlayer(ctx, t, f);
  if (scene.pitcher) drawPlayer(ctx, t, scene.pitcher);
  for (const r of scene.runners) drawPlayer(ctx, t, r);
  if (scene.batter) drawPlayer(ctx, t, scene.batter);
  drawBall(ctx, t, scene);
};
