import type { ScenePlayer, SceneState } from './types.js';
import type { Player, PlayerId } from '../world/types.js';
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

// Subtle idle bob applied to every sprite — small sine wave with a
// per-player phase offset so they don't all bob in unison. Adds life
// between pitches without distracting from on-field action.
const phaseHash = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1024;
  return (h / 1024) * Math.PI * 2;
};

const drawPlayer = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  p: ScenePlayer,
  simTime: number,
): void => {
  const s = worldToScreen(p.position, t);
  const pixelSize = Math.max(1.5, t.pixelsPerFoot * SCALE_PX_PER_FT);
  // Vertical bob, ~0.6 px peak for a 12-px sprite.
  const bobY = Math.sin(simTime * 0.55 + phaseHash(p.id)) * pixelSize * 0.4;
  const cy = s.y + bobY;
  drawShadow(ctx, s.x, s.y, pixelSize);
  drawPixelSprite(ctx, PLAYER_SPRITE, s.x, cy, pixelSize, p.primaryColor, p.secondaryColor);

  // Role-specific accents — anchored to the bobbed sprite center.
  if (p.role === 'batter') {
    const dir = p.position.x < 0 ? -1 : 1;
    const swingFrac = p.swingFrac ?? 0;
    const tipReady = { x: -dir * pixelSize * 1.5, y: -pixelSize * 7 };
    const tipFollow = { x: dir * pixelSize * 7, y: pixelSize * 0.5 };
    const tipX = tipReady.x + (tipFollow.x - tipReady.x) * swingFrac;
    const tipY = tipReady.y + (tipFollow.y - tipReady.y) * swingFrac;
    const handleX = dir * pixelSize * 1.5;
    const handleY = -pixelSize * 1.5;
    ctx.strokeStyle = '#d6b78a';
    ctx.lineWidth = Math.max(1.5, pixelSize * 1.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x + handleX, cy + handleY);
    ctx.lineTo(s.x + tipX, cy + tipY);
    ctx.stroke();
  } else if (p.role === 'pitcher') {
    // Rubber strip drawn at the GROUND, not bobbed (it's a fixed mark on the field).
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

// Returns every on-field player in a stable iteration order, used both for
// drawing labels and for hover hit-testing. Catcher first → fielders →
// pitcher → runners → batter so visual stacking matches input precedence:
// when sprites overlap, the topmost-drawn player wins the hover.
const visiblePlayers = (scene: SceneState): readonly ScenePlayer[] => {
  const out: ScenePlayer[] = [];
  if (scene.catcher) out.push(scene.catcher);
  for (const f of scene.fielders) out.push(f);
  if (scene.pitcher) out.push(scene.pitcher);
  for (const r of scene.runners) out.push(r);
  if (scene.batter) out.push(scene.batter);
  return out;
};

// Half-extent of the clickable/hoverable hit area around a sprite center,
// in screen pixels. Slightly larger than the 12-px sprite so the label
// region above the sprite is also targetable.
const hitRadiusPx = (t: FieldTransform): number => {
  const pixelSize = Math.max(1.5, t.pixelsPerFoot * SCALE_PX_PER_FT);
  return Math.max(10, pixelSize * 7);
};

export interface PlayerHit {
  readonly id: PlayerId;
  readonly screen: { x: number; y: number };
}

// Find the topmost player under the given screen coordinates, matching the
// draw order in drawScene so the visually-on-top sprite wins ties.
export const findPlayerAtScreen = (
  scene: SceneState,
  t: FieldTransform,
  screenX: number,
  screenY: number,
): PlayerHit | null => {
  const radius = hitRadiusPx(t);
  let best: PlayerHit | null = null;
  let bestDist = radius * radius;
  // Iterate in reverse so later (topmost) sprites take precedence on overlap.
  const all = visiblePlayers(scene);
  for (let i = all.length - 1; i >= 0; i--) {
    const p = all[i]!;
    const s = worldToScreen(p.position, t);
    const dx = screenX - s.x;
    const dy = screenY - s.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestDist) {
      best = { id: p.id, screen: s };
      bestDist = d2;
    }
  }
  return best;
};

const LABEL_FONT_FAINT = 'bold 10px ui-monospace, "JetBrains Mono", monospace';
const LABEL_FONT_HOVER = 'bold 12px ui-monospace, "JetBrains Mono", monospace';

const drawPlayerLabel = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  p: ScenePlayer,
  fullName: string,
  hovered: boolean,
): void => {
  const s = worldToScreen(p.position, t);
  const pixelSize = Math.max(1.5, t.pixelsPerFoot * SCALE_PX_PER_FT);
  // Sit the label just above the cap. The bobbing sprite has ~6 pixels of
  // headroom; we add a small extra gap so the text never collides.
  const labelY = s.y - pixelSize * 7.5;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = hovered ? LABEL_FONT_HOVER : LABEL_FONT_FAINT;
  // Outline first for legibility against grass.
  ctx.lineWidth = hovered ? 3 : 2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = hovered ? 'rgba(8, 10, 14, 0.95)' : 'rgba(8, 10, 14, 0.55)';
  ctx.strokeText(fullName, s.x, labelY);
  ctx.fillStyle = hovered ? '#ffffff' : 'rgba(232, 234, 238, 0.55)';
  ctx.fillText(fullName, s.x, labelY);
  ctx.restore();
};

export interface DrawSceneOptions {
  readonly playerIndex?: ReadonlyMap<PlayerId, Player>;
  readonly hoveredPlayerId?: PlayerId | null;
}

export const drawScene = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
  opts: DrawSceneOptions = {},
): void => {
  const simTime = scene.simTime;
  if (scene.catcher) drawPlayer(ctx, t, scene.catcher, simTime);
  for (const f of scene.fielders) drawPlayer(ctx, t, f, simTime);
  if (scene.pitcher) drawPlayer(ctx, t, scene.pitcher, simTime);
  for (const r of scene.runners) drawPlayer(ctx, t, r, simTime);
  if (scene.batter) drawPlayer(ctx, t, scene.batter, simTime);
  drawBall(ctx, t, scene);

  // Name labels — draw last so they sit on top of sprites and the ball.
  // Faint by default; crisp + brighter when hovered. Click-to-stats is
  // wired via findPlayerAtScreen() above.
  const idx = opts.playerIndex;
  if (idx) {
    const hoveredId = opts.hoveredPlayerId ?? null;
    for (const sp of visiblePlayers(scene)) {
      const player = idx.get(sp.id);
      if (!player) continue;
      const name = `${player.firstName} ${player.lastName}`;
      drawPlayerLabel(ctx, t, sp, name, sp.id === hoveredId);
    }
  }
};
