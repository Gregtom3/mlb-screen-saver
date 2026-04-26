import type { SceneState } from './types.js';
import type { FieldTransform } from './transform.js';
import type { Player, PlayerId, TeamId } from '../world/types.js';

interface TeamStanding {
  readonly wins: number;
  readonly losses: number;
}

interface ChannelInfo {
  readonly currentIdx: number;
  readonly total: number;
}

export interface HudExtras {
  readonly standings?: ReadonlyMap<TeamId, TeamStanding>;
  readonly channel?: ChannelInfo;
  readonly teamColors: ReadonlyMap<TeamId, { primary: string; secondary: string; accent: string }>;
  readonly teamAbbr: ReadonlyMap<TeamId, string>;
}

// HUD overhaul per docs/visual_polish_001.md Section 3.
//
// Layout:
//   Top scoreboard strip (~70px tall):
//     Tier 1 (40px): away color block | inning indicator | home color block
//     Tier 2 (30px): count icons | outs dots | bases diamond | last-play ticker
//   Bottom-left batter card (~96×240) — name, position, current-game line.
//   Bottom-right line-score box — innings 1-9 + R/H/E.

export const STANDINGS_HEIGHT = 22;
export const SCOREBUG_HEIGHT = 70;
export const TOP_HUD_HEIGHT = STANDINGS_HEIGHT + SCOREBUG_HEIGHT;
const TIER_1_H = 40;
const TIER_2_H = SCOREBUG_HEIGHT - TIER_1_H;

const PANEL_BOTTOM_INSET = 12;
const PANEL_HEIGHT = 86;
const BATTER_CARD_W = 240;
const LINE_SCORE_W = 320;

const COLOR_BG = 'rgba(11, 13, 16, 0.92)';
const COLOR_BG_TIER2 = 'rgba(15, 18, 22, 0.92)';
const COLOR_TEXT = '#e8eaee';
const COLOR_DIM = '#7d848d';
const COLOR_ACCENT = '#f1c40f';
const COLOR_DIVIDER = '#2a2f37';
const COLOR_PANEL = 'rgba(11, 13, 16, 0.86)';
const COLOR_PANEL_BORDER = '#2a2f37';

const FONT_SCORE = 'bold 22px ui-monospace, "JetBrains Mono", monospace';
const FONT_ABBR = 'bold 15px ui-monospace, "JetBrains Mono", monospace';
const FONT_INNING = 'bold 16px ui-monospace, "JetBrains Mono", monospace';
const FONT_LABEL = '11px ui-monospace, "JetBrains Mono", monospace';
const FONT_VALUE = 'bold 13px ui-monospace, "JetBrains Mono", monospace';
const FONT_PLAY = '12px ui-monospace, "JetBrains Mono", monospace';
const FONT_PANEL_HEADING = 'bold 11px ui-monospace, "JetBrains Mono", monospace';
const FONT_PANEL_BIG = 'bold 16px ui-monospace, "JetBrains Mono", monospace';
const FONT_PANEL_SMALL = '11px ui-monospace, "JetBrains Mono", monospace';
const FONT_LINE_HEADER = 'bold 11px ui-monospace, "JetBrains Mono", monospace';
const FONT_LINE_VALUE = 'bold 13px ui-monospace, "JetBrains Mono", monospace';

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
  playerIndex: ReadonlyMap<PlayerId, Player>,
  extras: HudExtras = { teamColors: new Map(), teamAbbr: new Map() },
): void => {
  // Standings strip across the very top.
  drawStandingsStrip(ctx, t, extras);

  // Top scorebug below standings.
  const sbY = STANDINGS_HEIGHT;
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, sbY, t.canvasWidth, TIER_1_H);
  ctx.fillStyle = COLOR_BG_TIER2;
  ctx.fillRect(0, sbY + TIER_1_H, t.canvasWidth, TIER_2_H);
  ctx.fillStyle = COLOR_DIVIDER;
  ctx.fillRect(0, sbY + SCOREBUG_HEIGHT - 1, t.canvasWidth, 1);

  drawTeamBlock(ctx, 0, sbY, TIER_1_H, teams.away, 'left');
  drawTeamBlock(ctx, t.canvasWidth - 168, sbY, TIER_1_H, teams.home, 'right');
  drawInningPanel(ctx, t.canvasWidth / 2, sbY + TIER_1_H / 2, scene, extras.channel);

  let cursor = 16;
  cursor = drawCount(ctx, cursor, sbY + TIER_1_H + TIER_2_H / 2, scene);
  cursor = drawOuts(ctx, cursor + 22, sbY + TIER_1_H + TIER_2_H / 2, scene);
  cursor = drawBases(ctx, cursor + 22, sbY + TIER_1_H + TIER_2_H / 2, scene);
  drawLastPlay(ctx, cursor + 18, t.canvasWidth - 12, sbY + TIER_1_H + TIER_2_H / 2, scene);

  drawBatterCard(ctx, t, scene, playerIndex, teams);
  drawLineScore(ctx, t, scene, teams);

  drawScreenFlash(ctx, t, scene);
  drawBigPlayPopup(ctx, t, scene);

  if (scene.phase === 'final') drawFinalBanner(ctx, t, scene, teams);
};

// =================================================== standings strip =====

const drawStandingsStrip = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  extras: HudExtras,
): void => {
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, t.canvasWidth, STANDINGS_HEIGHT);
  ctx.fillStyle = '#1d2129';
  ctx.fillRect(0, STANDINGS_HEIGHT - 1, t.canvasWidth, 1);

  const standings = extras.standings;
  if (!standings || standings.size === 0) {
    ctx.font = FONT_LABEL;
    ctx.fillStyle = COLOR_DIM;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('standings — opening day', 12, STANDINGS_HEIGHT / 2);
    return;
  }

  // Sort: best W-L first.
  const rows = [...standings.entries()]
    .map(([teamId, s]) => ({ teamId, ...s }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.losses - b.losses;
    });

  const colW = (t.canvasWidth - 16) / rows.length;
  ctx.font = 'bold 11px ui-monospace, "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const x = 8 + i * colW;
    const colors = extras.teamColors.get(row.teamId);
    const abbr = extras.teamAbbr.get(row.teamId) ?? row.teamId;
    if (colors) {
      ctx.fillStyle = colors.primary;
      ctx.fillRect(x, 4, 4, STANDINGS_HEIGHT - 8);
    }
    ctx.fillStyle = COLOR_TEXT;
    ctx.textAlign = 'left';
    ctx.fillText(abbr, x + 8, STANDINGS_HEIGHT / 2);
    ctx.fillStyle = COLOR_DIM;
    ctx.textAlign = 'right';
    ctx.fillText(`${row.wins}-${row.losses}`, x + colW - 4, STANDINGS_HEIGHT / 2);
  }
};

// ============================================================ big play ===

// Visual durations in sim ticks (≈ seconds). At default 20 ticks/wall sec,
// these are 0.7 sec popup, 0.2 sec flash.
const POPUP_DURATION_TICKS = 14;
const FLASH_DURATION_TICKS = 4;

const drawBigPlayPopup = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  if (!scene.lastBigPlay) return;
  const age = scene.simTime - scene.lastBigPlay.firedAtT;
  if (age < 0 || age > POPUP_DURATION_TICKS) return;

  const big = scene.lastBigPlay;
  const frac = age / POPUP_DURATION_TICKS;
  // 3-phase pop animation: scale up → settle → fade.
  let scale: number;
  let alpha: number;
  if (frac < 0.18) {
    // overshoot in
    scale = 0.4 + (frac / 0.18) * 0.95;
    alpha = (frac / 0.18);
  } else if (frac < 0.32) {
    // settle
    scale = 1.35 - ((frac - 0.18) / 0.14) * 0.35;
    alpha = 1;
  } else if (frac < 0.78) {
    // hold
    scale = 1;
    alpha = 1;
  } else {
    // fade
    scale = 1;
    alpha = Math.max(0, 1 - (frac - 0.78) / 0.22);
  }

  const cx = t.canvasWidth / 2;
  const cy = t.canvasHeight / 2 - 40;
  const fontSize = Math.round(56 * scale);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${fontSize}px ui-monospace, "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, fontSize * 0.1);
  ctx.strokeStyle = '#0c0d10';
  ctx.strokeText(big.label, cx, cy);
  ctx.fillStyle = big.teamColor;
  ctx.fillText(big.label, cx, cy);
  ctx.restore();
};

const drawScreenFlash = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  if (!scene.lastBigPlay || scene.lastBigPlay.intensity !== 'extra-base') return;
  const age = scene.simTime - scene.lastBigPlay.firedAtT;
  if (age < 0 || age > FLASH_DURATION_TICKS) return;

  // Border-only flash so the field stays readable.
  const frac = age / FLASH_DURATION_TICKS;
  const alpha = (1 - frac) * 0.35;
  const borderW = 28;
  ctx.save();
  ctx.fillStyle = scene.lastBigPlay.teamColor;
  ctx.globalAlpha = alpha;
  // top
  ctx.fillRect(0, 0, t.canvasWidth, borderW);
  // bottom
  ctx.fillRect(0, t.canvasHeight - borderW, t.canvasWidth, borderW);
  // left
  ctx.fillRect(0, 0, borderW, t.canvasHeight);
  // right
  ctx.fillRect(t.canvasWidth - borderW, 0, borderW, t.canvasHeight);
  ctx.restore();
};


// ============================================================ tier 1 ===

const TEAM_BLOCK_W = 168;

const drawTeamBlock = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  team: TeamBugInfo,
  side: 'left' | 'right',
): void => {
  // Solid color stripe pinned to the outer edge for instant identification.
  if (side === 'left') {
    ctx.fillStyle = team.primary;
    ctx.fillRect(x, y, 14, h);
  } else {
    ctx.fillStyle = team.primary;
    ctx.fillRect(x + TEAM_BLOCK_W - 14, y, 14, h);
  }
  // Tinted background for the abbr+score pad.
  ctx.fillStyle = team.primary;
  ctx.globalAlpha = 0.42;
  if (side === 'left') ctx.fillRect(x + 14, y, TEAM_BLOCK_W - 14, h);
  else ctx.fillRect(x, y, TEAM_BLOCK_W - 14, h);
  ctx.globalAlpha = 1;
  // Abbr + score, mirrored by side.
  ctx.font = FONT_ABBR;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLOR_TEXT;
  if (side === 'left') {
    ctx.textAlign = 'left';
    ctx.fillText(team.abbr, x + 24, y + h / 2);
    ctx.font = FONT_SCORE;
    ctx.textAlign = 'right';
    ctx.fillText(String(team.score), x + TEAM_BLOCK_W - 22, y + h / 2);
  } else {
    ctx.textAlign = 'right';
    ctx.fillText(team.abbr, x + TEAM_BLOCK_W - 24, y + h / 2);
    ctx.font = FONT_SCORE;
    ctx.textAlign = 'left';
    ctx.fillText(String(team.score), x + 22, y + h / 2);
  }
};

const drawInningPanel = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scene: SceneState,
  channel?: ChannelInfo,
): void => {
  // Stadium name + (optional) channel indicator, then inning.
  const topLine = channel
    ? `${scene.stadiumName} · ch ${channel.currentIdx + 1}/${channel.total}`
    : scene.stadiumName;
  ctx.font = FONT_LABEL;
  ctx.fillStyle = COLOR_DIM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(topLine, cx, cy - 11);
  if (scene.phase === 'pre-game') return;
  const half = scene.half === 'top' ? '▲ TOP' : '▼ BOT';
  ctx.font = FONT_INNING;
  ctx.fillStyle = COLOR_ACCENT;
  ctx.fillText(`${half} ${scene.inning}`, cx, cy + 8);
};

// ============================================================ tier 2 ===

// Count rendered as discrete icons: balls 0–3 (3 dots), strikes 0–2 (2 dots).
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
  ctx.fillText('B', x, cy);
  let cursor = x + 12;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < scene.balls ? '#5cb45c' : '#3a3f47'; // green dot for taken balls
    ctx.beginPath();
    ctx.arc(cursor + 6, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    cursor += 14;
  }
  cursor += 4;
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText('S', cursor, cy);
  cursor += 12;
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = i < scene.strikes ? '#e25e5e' : '#3a3f47'; // red dot for strikes
    ctx.beginPath();
    ctx.arc(cursor + 6, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    cursor += 14;
  }
  return cursor;
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
  ctx.fillText('OUT', x, cy);
  let cursor = x + 28;
  for (let i = 0; i < 3; i++) {
    if (i < scene.outs) {
      ctx.fillStyle = COLOR_ACCENT;
      ctx.fillRect(cursor, cy - 4, 8, 8);
    } else {
      ctx.strokeStyle = COLOR_DIM;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cursor + 0.5, cy - 4 + 0.5, 7, 7);
    }
    cursor += 12;
  }
  return cursor;
};

const drawBases = (
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  scene: SceneState,
): number => {
  // Bigger bases diamond — ~40×24 wide, 1B / 2B / 3B drawn as rotated squares.
  ctx.font = FONT_LABEL;
  ctx.fillStyle = COLOR_DIM;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('BASES', x, cy);
  const diamondX = x + 50;
  const arm = 12;
  drawMiniBase(ctx, diamondX + arm, cy, scene.basesOccupied.first);
  drawMiniBase(ctx, diamondX, cy - arm, scene.basesOccupied.second);
  drawMiniBase(ctx, diamondX - arm, cy, scene.basesOccupied.third);
  return diamondX + arm + 16;
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
  ctx.fillRect(-7, -7, 14, 14);
  ctx.strokeStyle = COLOR_TEXT;
  ctx.lineWidth = 1;
  ctx.strokeRect(-7, -7, 14, 14);
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
  const maxW = Math.max(80, rightX - x);
  let text = scene.lastPlay;
  if (ctx.measureText(text).width > maxW) {
    while (text.length > 4 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    text = text + '…';
  }
  ctx.fillText(text, x, cy);
};

// =================================================== bottom panels =====

const drawBatterCard = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
  playerIndex: ReadonlyMap<PlayerId, Player>,
  teams: { away: TeamBugInfo; home: TeamBugInfo },
): void => {
  const x = 12;
  const y = t.canvasHeight - PANEL_HEIGHT - PANEL_BOTTOM_INSET;
  // Background.
  ctx.fillStyle = COLOR_PANEL;
  ctx.fillRect(x, y, BATTER_CARD_W, PANEL_HEIGHT);
  ctx.strokeStyle = COLOR_PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, BATTER_CARD_W - 1, PANEL_HEIGHT - 1);

  // Heading.
  ctx.font = FONT_PANEL_HEADING;
  ctx.fillStyle = COLOR_DIM;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('AT BAT', x + 12, y + 8);

  // Nothing yet?
  if (scene.phase === 'pre-game' || scene.phase === 'final') {
    ctx.font = FONT_PANEL_SMALL;
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText(scene.phase === 'pre-game' ? 'pre-game' : 'final', x + 12, y + 32);
    return;
  }

  // Determine current batter id from the lineup using innings + outs as a
  // proxy isn't reliable — instead, the scene reducer hands us batterStats
  // for the active batter. We need the player id too, which we can derive
  // from the on-deck calculation: the batter currently up is the one whose
  // baserunner-event hasn't fired AND who's the previous lineup slot of the
  // on-deck. Simpler: pass currentBatterId via scene if we want this clean —
  // for now, look up the batter via the on-deck index minus one.
  const battingTeamColors = scene.half === 'top' ? teams.away : teams.home;
  const battingOrder = scene.half === 'top'
    ? scene.awayTeamId // we don't have direct order here — read from teams below
    : scene.homeTeamId;
  void battingOrder;

  // Resolve the active batter id: prefer the batter sprite's id (on-screen).
  const activeBatterId = scene.batter?.id ?? null;
  const batter = activeBatterId ? playerIndex.get(activeBatterId) : null;

  if (!batter) {
    ctx.font = FONT_PANEL_SMALL;
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText('—', x + 12, y + 32);
    return;
  }

  // Team color stripe down the left edge of the card.
  ctx.fillStyle = battingTeamColors.primary;
  ctx.fillRect(x, y, 4, PANEL_HEIGHT);

  // Batter name + position.
  ctx.font = FONT_PANEL_BIG;
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText(`${batter.firstName} ${batter.lastName}`, x + 12, y + 24);
  ctx.font = FONT_PANEL_SMALL;
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText(`${batter.primaryPosition}  ${batter.bats}/${batter.throws}`, x + 12, y + 44);

  // Current-game line: H-for-AB (HR, RBI). Phase 1 doesn't track season yet.
  if (scene.batterStats) {
    const s = scene.batterStats;
    const line = `${s.hits}-for-${s.atBats}` +
      (s.homeRuns > 0 ? `  ${s.homeRuns} HR` : '') +
      (s.rbis > 0 ? `  ${s.rbis} RBI` : '');
    ctx.font = FONT_PANEL_SMALL;
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(line, x + 12, y + 60);
  }

  // On-deck.
  if (scene.onDeckBatterId) {
    const onDeck = playerIndex.get(scene.onDeckBatterId);
    if (onDeck) {
      ctx.font = FONT_PANEL_SMALL;
      ctx.fillStyle = COLOR_DIM;
      ctx.textAlign = 'right';
      ctx.fillText(`on deck: ${onDeck.lastName}`, x + BATTER_CARD_W - 12, y + 60);
    }
  }
};

const drawLineScore = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
  teams: { away: TeamBugInfo; home: TeamBugInfo },
): void => {
  const x = t.canvasWidth - LINE_SCORE_W - 12;
  const y = t.canvasHeight - PANEL_HEIGHT - PANEL_BOTTOM_INSET;
  ctx.fillStyle = COLOR_PANEL;
  ctx.fillRect(x, y, LINE_SCORE_W, PANEL_HEIGHT);
  ctx.strokeStyle = COLOR_PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, LINE_SCORE_W - 1, PANEL_HEIGHT - 1);

  // Header row.
  const NUM_INNINGS = 9;
  const headerY = y + 18;
  const colWidth = (LINE_SCORE_W - 60 - 60) / NUM_INNINGS; // 60 left, 60 right (R H E)
  ctx.font = FONT_LINE_HEADER;
  ctx.fillStyle = COLOR_DIM;
  ctx.textBaseline = 'middle';
  for (let i = 0; i < NUM_INNINGS; i++) {
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x + 60 + colWidth * (i + 0.5), headerY);
  }
  // R H E header
  const rheStartX = x + 60 + colWidth * NUM_INNINGS;
  const rheCol = 60 / 3;
  ctx.fillText('R', rheStartX + rheCol * 0.5, headerY);
  ctx.fillText('H', rheStartX + rheCol * 1.5, headerY);
  ctx.fillText('E', rheStartX + rheCol * 2.5, headerY);

  // Away row.
  drawLineScoreRow(
    ctx,
    x,
    y + 38,
    NUM_INNINGS,
    colWidth,
    teams.away.abbr,
    scene.lineScore.innings.map((i) => i.top),
    scene.lineScore.away,
    teams.away.primary,
  );
  // Home row.
  drawLineScoreRow(
    ctx,
    x,
    y + 64,
    NUM_INNINGS,
    colWidth,
    teams.home.abbr,
    scene.lineScore.innings.map((i) => i.bottom),
    scene.lineScore.home,
    teams.home.primary,
  );
};

const drawLineScoreRow = (
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  numInnings: number,
  colWidth: number,
  abbr: string,
  inningRuns: readonly (number | null)[],
  totals: { runs: number; hits: number; errors: number },
  primaryColor: string,
): void => {
  ctx.font = FONT_LINE_VALUE;
  ctx.textBaseline = 'middle';

  // Team-tinted abbr cell.
  ctx.fillStyle = primaryColor;
  ctx.globalAlpha = 0.32;
  ctx.fillRect(x + 6, cy - 12, 48, 22);
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'center';
  ctx.fillText(abbr, x + 30, cy);

  // Inning runs.
  for (let i = 0; i < numInnings; i++) {
    const v = inningRuns[i];
    ctx.fillStyle = COLOR_TEXT;
    ctx.textAlign = 'center';
    ctx.fillText(v === null || v === undefined ? '·' : String(v), x + 60 + colWidth * (i + 0.5), cy);
  }

  // R H E.
  const rheStartX = x + 60 + colWidth * numInnings;
  const rheCol = 60 / 3;
  ctx.fillStyle = COLOR_ACCENT;
  ctx.textAlign = 'center';
  ctx.fillText(String(totals.runs), rheStartX + rheCol * 0.5, cy);
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText(String(totals.hits), rheStartX + rheCol * 1.5, cy);
  ctx.fillText(String(totals.errors), rheStartX + rheCol * 2.5, cy);
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
