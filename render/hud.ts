import type { SceneState } from './types.js';
import type { FieldTransform } from './transform.js';

// Single top scorebug carries every piece of game state. Designed to read
// like a real broadcast bug: team blocks on the left, inning indicator,
// count / outs / bases cluster, last-play caption, stadium tag at right.
//
// Bottom panels were removed — the rest of the canvas below SCOREBUG_HEIGHT
// is pure field, with home plate sized into that available space.

export const SCOREBUG_HEIGHT = 64;

const TIER_1_H = 36;
const TIER_2_H = SCOREBUG_HEIGHT - TIER_1_H;

const COLOR_BG = 'rgba(11, 13, 16, 0.92)';
const COLOR_BG_TIER2 = 'rgba(15, 18, 22, 0.92)';
const COLOR_TEXT = '#e8eaee';
const COLOR_DIM = '#7d848d';
const COLOR_ACCENT = '#f1c40f';
const COLOR_DIVIDER = '#2a2f37';

const FONT_SCORE = 'bold 18px ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, monospace';
const FONT_ABBR = 'bold 13px ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, monospace';
const FONT_INNING = 'bold 14px ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, monospace';
const FONT_LABEL = '11px ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, monospace';
const FONT_VALUE = 'bold 13px ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, monospace';
const FONT_PLAY = '12px ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, monospace';

interface TeamBugInfo {
  abbr: string;
  score: number;
  primary: string;
  secondary: string;
}

export const drawHud = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
  teams: { away: TeamBugInfo; home: TeamBugInfo },
): void => {
  // Backgrounds.
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, t.canvasWidth, TIER_1_H);
  ctx.fillStyle = COLOR_BG_TIER2;
  ctx.fillRect(0, TIER_1_H, t.canvasWidth, TIER_2_H);
  // Subtle bottom border to separate from field.
  ctx.fillStyle = COLOR_DIVIDER;
  ctx.fillRect(0, SCOREBUG_HEIGHT - 1, t.canvasWidth, 1);

  // -------- Tier 1: team blocks + inning + stadium --------
  drawTeamBlock(ctx, 0, 0, TIER_1_H / 2, teams.away);
  drawTeamBlock(ctx, 0, TIER_1_H / 2, TIER_1_H / 2, teams.home);
  drawInningPanel(ctx, t.canvasWidth / 2, TIER_1_H / 2, scene);
  drawStadiumLabel(ctx, t.canvasWidth - 12, TIER_1_H / 2, scene);

  // -------- Tier 2: count / outs / bases / last play --------
  let cursor = 14;
  cursor = drawCount(ctx, cursor, TIER_1_H + TIER_2_H / 2, scene);
  cursor = drawOuts(ctx, cursor + 18, TIER_1_H + TIER_2_H / 2, scene);
  cursor = drawBases(ctx, cursor + 18, TIER_1_H + TIER_2_H / 2, scene);

  drawLastPlay(ctx, cursor + 18, t.canvasWidth - 12, TIER_1_H + TIER_2_H / 2, scene);

  if (scene.phase === 'final') drawFinalBanner(ctx, t, scene, teams);
};

// ---------- Tier 1 ----------

const TEAM_BLOCK_W = 144;

const drawTeamBlock = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  team: TeamBugInfo,
): void => {
  // Wider, more saturated color stripe so the team identity reads at a glance.
  ctx.fillStyle = team.primary;
  ctx.fillRect(x, y, 14, h);
  // Stronger team-tint behind the abbr + score.
  ctx.fillStyle = team.primary;
  ctx.globalAlpha = 0.42;
  ctx.fillRect(x + 14, y, TEAM_BLOCK_W - 14, h);
  ctx.globalAlpha = 1;
  // Abbr.
  ctx.font = FONT_ABBR;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText(team.abbr, x + 22, y + h / 2);
  // Score (right-aligned within the block).
  ctx.font = FONT_SCORE;
  ctx.textAlign = 'right';
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText(String(team.score), x + TEAM_BLOCK_W - 12, y + h / 2);
};

const drawInningPanel = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scene: SceneState,
): void => {
  if (scene.phase === 'pre-game') return;
  const half = scene.half === 'top' ? '▲ TOP' : '▼ BOT';
  ctx.font = FONT_INNING;
  ctx.fillStyle = COLOR_ACCENT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${half} ${scene.inning}`, cx, cy);
};

const drawStadiumLabel = (
  ctx: CanvasRenderingContext2D,
  rightX: number,
  cy: number,
  scene: SceneState,
): void => {
  ctx.font = FONT_LABEL;
  ctx.fillStyle = COLOR_DIM;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(scene.stadiumName, rightX, cy);
};

// ---------- Tier 2 ----------

const drawCount = (
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  scene: SceneState,
): number => {
  ctx.font = FONT_LABEL;
  ctx.fillStyle = COLOR_DIM;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('count', x, cy);
  ctx.font = FONT_VALUE;
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText(`${scene.balls}-${scene.strikes}`, x + 38, cy);
  return x + 70;
};

const drawOuts = (
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  scene: SceneState,
): number => {
  ctx.font = FONT_LABEL;
  ctx.fillStyle = COLOR_DIM;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('outs', x, cy);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < scene.outs ? COLOR_ACCENT : '#3a3f47';
    ctx.beginPath();
    ctx.arc(x + 32 + i * 12, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  return x + 32 + 2 * 12 + 8;
};

const drawBases = (
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  scene: SceneState,
): number => {
  ctx.font = FONT_LABEL;
  ctx.fillStyle = COLOR_DIM;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('bases', x, cy);

  // Mini-diamond aligned vertically with the row.
  const diamondX = x + 44;
  const arm = 9;
  drawMiniBase(ctx, diamondX + arm, cy, scene.basesOccupied.first);
  drawMiniBase(ctx, diamondX, cy - arm, scene.basesOccupied.second);
  drawMiniBase(ctx, diamondX - arm, cy, scene.basesOccupied.third);
  return diamondX + arm + 12;
};

const drawMiniBase = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  occupied: boolean,
): void => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = occupied ? COLOR_ACCENT : '#5a6068';
  ctx.fillRect(-4, -4, 8, 8);
  ctx.strokeStyle = COLOR_TEXT;
  ctx.lineWidth = 1;
  ctx.strokeRect(-4, -4, 8, 8);
  ctx.restore();
};

const drawLastPlay = (
  ctx: CanvasRenderingContext2D,
  x: number,
  rightX: number,
  cy: number,
  scene: SceneState,
): void => {
  if (!scene.lastPlay) return;
  ctx.font = FONT_PLAY;
  ctx.fillStyle = COLOR_TEXT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  // Truncate if it would run past rightX.
  const maxW = Math.max(80, rightX - x);
  let text = scene.lastPlay;
  if (ctx.measureText(text).width > maxW) {
    while (text.length > 4 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    text = text + '…';
  }
  ctx.fillText(text, x, cy);
};

const drawFinalBanner = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
  teams: { away: TeamBugInfo; home: TeamBugInfo },
): void => {
  const w = 280;
  const h = 80;
  const x = (t.canvasWidth - w) / 2;
  const y = (t.canvasHeight - h) / 2;
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLOR_ACCENT;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.font = 'bold 18px ui-monospace, monospace';
  ctx.fillStyle = COLOR_ACCENT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FINAL', x + w / 2, y + 24);
  ctx.font = FONT_INNING;
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText(
    `${teams.away.abbr} ${scene.scoreAway}    ${teams.home.abbr} ${scene.scoreHome}`,
    x + w / 2,
    y + 54,
  );
};
