import type { Player, PlayerId, StadiumId, TeamId } from '../world/types.js';
import type { SimEvent, AtBatOutcome } from '../sim/types.js';

// Format the canonical SimEvent stream as terminal play-by-play. The formatter
// only consumes the event log — never reaches back into sim internals.

export interface PbpContext {
  readonly playerById: ReadonlyMap<PlayerId, Player>;
  readonly teamById: ReadonlyMap<TeamId, { city: string; nickname: string; abbr: string }>;
  readonly stadiumById: ReadonlyMap<StadiumId, { name: string }>;
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
}

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const RESET = '\x1b[0m';

const ordinal = (n: number): string => {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
};

const playerName = (ctx: PbpContext, id: PlayerId): string => {
  const p = ctx.playerById.get(id);
  if (!p) return id;
  return `${p.firstName} ${p.lastName}`;
};

const playerLast = (ctx: PbpContext, id: PlayerId): string => {
  const p = ctx.playerById.get(id);
  if (!p) return id;
  return p.lastName;
};

const teamName = (ctx: PbpContext, id: TeamId): string => {
  const t = ctx.teamById.get(id);
  return t ? `${t.city} ${t.nickname}` : id;
};

const baseLabel = (b: 0 | 1 | 2 | 3): string => {
  if (b === 0) return 'home';
  if (b === 1) return '1st';
  if (b === 2) return '2nd';
  return '3rd';
};

const describeOutcome = (
  outcome: AtBatOutcome,
  rbis: number,
  runsScored: ReadonlyArray<{ runnerId: PlayerId; from: 0 | 1 | 2 | 3 }>,
  ctx: PbpContext,
  batterId: PlayerId,
): string => {
  const last = playerLast(ctx, batterId);
  const rbiTag = rbis > 0 ? ` ${DIM}(${rbis} RBI)${RESET}` : '';
  const scoredTag =
    runsScored.length > 0
      ? ` ${DIM}— ${runsScored.map((r) => `${playerLast(ctx, r.runnerId)} scores`).join(', ')}${RESET}`
      : '';
  switch (outcome) {
    case 'home-run':
      return `${BOLD}${last} homered${RESET}${rbiTag}${scoredTag}`;
    case 'triple':
      return `${last} tripled${rbiTag}${scoredTag}`;
    case 'double':
      return `${last} doubled${rbiTag}${scoredTag}`;
    case 'single':
      return `${last} singled${rbiTag}${scoredTag}`;
    case 'walk':
      return `${last} walked${scoredTag}`;
    case 'hit-by-pitch':
      return `${last} hit by pitch${scoredTag}`;
    case 'strikeout-swinging':
      return `${last} struck out swinging`;
    case 'strikeout-looking':
      return `${last} struck out looking`;
    case 'groundout':
      return `${last} grounded out${scoredTag}`;
    case 'flyout':
      return `${last} flied out`;
    case 'lineout':
      return `${last} lined out`;
    case 'popout':
      return `${last} popped out`;
    case 'sac-fly':
      return `${last} hit a sacrifice fly${scoredTag}`;
    case 'sac-bunt':
      return `${last} laid down a sacrifice bunt${scoredTag}`;
    case 'fielders-choice':
      return `${last} reached on a fielder's choice${scoredTag}`;
    case 'reached-on-error':
      return `${last} reached on an error${scoredTag}`;
    case 'double-play':
      return `${last} grounded into a double play${scoredTag}`;
    case 'triple-play':
      return `${last} hit into a triple play${scoredTag}`;
  }
};

export const formatPlayByPlay = (
  events: readonly SimEvent[],
  ctx: PbpContext,
): string => {
  const lines: string[] = [];
  let curBatterId: PlayerId | null = null;
  let runsThisAtBat: { runnerId: PlayerId; from: 0 | 1 | 2 | 3 }[] = [];
  let curInning = 1;
  let curHalf: 'top' | 'bottom' = 'top';
  let halfRuns = 0;
  let halfHits = 0;
  let halfPitches = 0;

  for (const ev of events) {
    switch (ev.kind) {
      case 'gameStart': {
        const stadium = ctx.stadiumById.get(ev.stadiumId);
        const home = teamName(ctx, ctx.homeTeamId);
        const away = teamName(ctx, ctx.awayTeamId);
        lines.push('');
        lines.push(
          `${BOLD}${away}${RESET} at ${BOLD}${home}${RESET} — ${stadium?.name ?? ev.stadiumId}`,
        );
        lines.push('');
        lines.push(`${BOLD}Top of the ${ordinal(curInning)}${RESET}`);
        break;
      }
      case 'pitch': {
        curBatterId = ev.batterId;
        halfPitches += 1;
        break;
      }
      case 'contact':
        break;
      case 'baserunner': {
        if (!ev.out && ev.to === 0) {
          runsThisAtBat.push({ runnerId: ev.runnerId, from: ev.from });
          halfRuns += 1;
        }
        break;
      }
      case 'atBatEnd': {
        const batter = curBatterId ?? '?';
        const desc = describeOutcome(ev.outcome, ev.rbis, runsThisAtBat, ctx, batter);
        lines.push(`  ${desc}`);
        if (
          ev.outcome === 'single' ||
          ev.outcome === 'double' ||
          ev.outcome === 'triple' ||
          ev.outcome === 'home-run'
        ) {
          halfHits += 1;
        }
        runsThisAtBat = [];
        break;
      }
      case 'sub': {
        lines.push(
          `  ${ITALIC}${DIM}» pitching change: ${playerName(ctx, ev.outPlayerId)} → ${playerName(ctx, ev.inPlayerId)}${RESET}`,
        );
        break;
      }
      case 'inningEnd': {
        lines.push(
          `  ${DIM}— ${halfRuns} run${halfRuns === 1 ? '' : 's'}, ${halfHits} hit${halfHits === 1 ? '' : 's'} (${halfPitches} pitches)${RESET}`,
        );
        halfRuns = 0;
        halfHits = 0;
        halfPitches = 0;
        if (ev.halfInning === 'top') {
          lines.push('');
          lines.push(`${BOLD}Bottom of the ${ordinal(curInning)}${RESET}`);
          curHalf = 'bottom';
        } else {
          curInning += 1;
          curHalf = 'top';
          lines.push('');
          if (ev.t < Number.MAX_SAFE_INTEGER) {
            // tentative header — last bottom won't get one if game ends
            lines.push(`${BOLD}Top of the ${ordinal(curInning)}${RESET}`);
          }
        }
        break;
      }
      case 'gameEnd': {
        // Drop a trailing inning header that never had any plays — happens when
        // the home team wins at the end of the top half (skip-bottom rule).
        const last = lines[lines.length - 1] ?? '';
        if (/(Top|Bottom) of the /.test(last) && /^\x1b\[1m/.test(last)) {
          lines.pop();
          if (lines[lines.length - 1] === '') lines.pop();
        }
        const home = teamName(ctx, ctx.homeTeamId);
        const away = teamName(ctx, ctx.awayTeamId);
        const winner = ev.finalRuns.home > ev.finalRuns.away ? home : away;
        lines.push('');
        lines.push(
          `${BOLD}Final:${RESET} ${away} ${ev.finalRuns.away}, ${home} ${ev.finalRuns.home}  ${DIM}— ${winner} wins${RESET}`,
        );
        break;
      }
    }
  }

  return lines.join('\n');
};
