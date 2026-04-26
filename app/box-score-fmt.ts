import type { Player, PlayerId, TeamId } from '../world/types.js';
import type { BoxScoreView, BatterLine, PitcherLine } from '../sim/box-score.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

interface FormatContext {
  readonly playerById: ReadonlyMap<PlayerId, Player>;
  readonly teamById: ReadonlyMap<TeamId, { city: string; nickname: string; abbr: string }>;
}

const lastName = (ctx: FormatContext, id: PlayerId): string =>
  ctx.playerById.get(id)?.lastName ?? id;

const formatIp = (outs: number): string => {
  const innings = Math.floor(outs / 3);
  const frac = outs % 3;
  return `${innings}.${frac}`;
};

const padRight = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const padLeft = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s);

const formatLineScoreTable = (box: BoxScoreView, ctx: FormatContext): string => {
  const homeTeam = ctx.teamById.get(box.homeTeamId);
  const awayTeam = ctx.teamById.get(box.awayTeamId);
  const homeAbbr = homeTeam?.abbr ?? box.homeTeamId.toUpperCase();
  const awayAbbr = awayTeam?.abbr ?? box.awayTeamId.toUpperCase();
  const innings = box.lineScore.innings;
  const ninn = Math.max(9, innings.length);
  const header = ['     ', ...Array.from({ length: ninn }, (_, i) => padLeft(String(i + 1), 3)), '   R', '  H', '  E'].join('');
  const cell = (n: number | null): string => (n === null ? '  -' : padLeft(String(n), 3));
  const awayCells = Array.from({ length: ninn }, (_, i) => {
    const inn = innings[i];
    return cell(inn ? inn.top : 0);
  });
  const homeCells = Array.from({ length: ninn }, (_, i) => {
    const inn = innings[i];
    return cell(inn ? inn.bottom : 0);
  });
  const awayLine = `${padRight(awayAbbr, 5)}${awayCells.join('')}${padLeft(String(box.lineScore.away.runs), 4)}${padLeft(String(box.lineScore.away.hits), 3)}${padLeft(String(box.lineScore.away.errors), 3)}`;
  const homeLine = `${padRight(homeAbbr, 5)}${homeCells.join('')}${padLeft(String(box.lineScore.home.runs), 4)}${padLeft(String(box.lineScore.home.hits), 3)}${padLeft(String(box.lineScore.home.errors), 3)}`;
  return [BOLD + header + RESET, awayLine, homeLine].join('\n');
};

const formatBatters = (
  rows: readonly BatterLine[],
  teamLabel: string,
  ctx: FormatContext,
): string => {
  const out: string[] = [];
  out.push(`${BOLD}${teamLabel} batters${RESET}`);
  out.push(
    `${DIM}${padRight('player', 22)}${padLeft('AB', 4)}${padLeft('R', 3)}${padLeft('H', 3)}${padLeft('RBI', 5)}${padLeft('BB', 4)}${padLeft('K', 4)}${padLeft('HR', 4)}${RESET}`,
  );
  for (const r of rows) {
    out.push(
      `${padRight(lastName(ctx, r.playerId), 22)}${padLeft(String(r.atBats), 4)}${padLeft(String(r.runs), 3)}${padLeft(String(r.hits), 3)}${padLeft(String(r.rbis), 5)}${padLeft(String(r.walks), 4)}${padLeft(String(r.strikeouts), 4)}${padLeft(String(r.homeRuns), 4)}`,
    );
  }
  return out.join('\n');
};

const formatPitchers = (
  rows: readonly PitcherLine[],
  teamLabel: string,
  ctx: FormatContext,
): string => {
  const out: string[] = [];
  out.push(`${BOLD}${teamLabel} pitchers${RESET}`);
  out.push(
    `${DIM}${padRight('player', 22)}${padLeft('IP', 5)}${padLeft('H', 3)}${padLeft('R', 3)}${padLeft('BB', 4)}${padLeft('K', 4)}${padLeft('HR', 4)}${padLeft('Pit', 5)}${RESET}`,
  );
  for (const r of rows) {
    out.push(
      `${padRight(lastName(ctx, r.playerId), 22)}${padLeft(formatIp(r.outs), 5)}${padLeft(String(r.hits), 3)}${padLeft(String(r.runs), 3)}${padLeft(String(r.walks), 4)}${padLeft(String(r.strikeouts), 4)}${padLeft(String(r.homeRunsAllowed), 4)}${padLeft(String(r.pitches), 5)}`,
    );
  }
  return out.join('\n');
};

export const formatBoxScore = (box: BoxScoreView, ctx: FormatContext): string => {
  const homeTeam = ctx.teamById.get(box.homeTeamId);
  const awayTeam = ctx.teamById.get(box.awayTeamId);
  const homeLabel = homeTeam ? `${homeTeam.city} ${homeTeam.nickname}` : box.homeTeamId;
  const awayLabel = awayTeam ? `${awayTeam.city} ${awayTeam.nickname}` : box.awayTeamId;
  const sections: string[] = [];
  sections.push(formatLineScoreTable(box, ctx));
  sections.push('');
  sections.push(formatBatters(box.awayBatters, awayLabel, ctx));
  sections.push('');
  sections.push(formatPitchers(box.awayPitchers, awayLabel, ctx));
  sections.push('');
  sections.push(formatBatters(box.homeBatters, homeLabel, ctx));
  sections.push('');
  sections.push(formatPitchers(box.homePitchers, homeLabel, ctx));
  return sections.join('\n');
};
