import type { Player, Team, TeamId } from '../world/types.js';
import type { Schedule } from '../season/types.js';
import type { LeagueHistory } from '../season/history.js';
import type { ProjectionSet } from '../projections/types.js';
import type { GameWPTimeline, SeasonAggregates } from '../stats/types.js';

// Shared types + helpers for the stats menu views. The MenuContext is
// constructed once in /app and passed through to each per-view renderer.

export type MenuView = 'league' | 'teams' | 'players' | 'live' | 'history';

export interface MenuViewState {
  view: MenuView;
  selectedPlayer?: string;
  selectedTeam?: TeamId;
  selectedGameId?: string;
  /** History sub-routes — Phase 6 deep links inside the History tab. */
  historyRoute?:
    | { kind: 'index' }
    | { kind: 'season'; year: number }
    | { kind: 'records' }
    | { kind: 'all-time' }
    | { kind: 'hall-of-fame' };
}

export interface LiveGameSummary {
  readonly gameId: string;
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly score: { home: number; away: number };
  readonly inning: number;
  readonly half: 'top' | 'bottom';
  readonly outs: number;
  readonly isDay: boolean;
  readonly wpTimeline: GameWPTimeline | undefined;
}

/** Lookup hook for surfaced game-log links (opposing pitcher etc.). */
export interface GameMetadata {
  readonly gameId: string;
  readonly day: number;
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly homeStartingPitcher: string;
  readonly awayStartingPitcher: string;
}

export interface MenuContext {
  /** Always-fresh aggregates for the league. */
  getAggregates(): SeasonAggregates;
  /** Team count of games played, used for qualifier thresholds. */
  getTeamGamesPlayed(): number;
  /** Current calendar year, for player ages. Defaults to the founding year. */
  getCalendarYear?(): number;
  readonly teams: readonly Team[];
  readonly playerIndex: ReadonlyMap<string, Player>;
  readonly schedule: Schedule;
  /** Lazy projections — computed on first read, cached until invalidated. */
  getProjections(): ProjectionSet;
  /** Live channel grid — populated by the renderer. */
  getLiveGames(): readonly LiveGameSummary[];
  /** Best-effort jump-to-channel hook, for the Live view's "watch" button. */
  setLiveChannel?(gameId: string): void;
  /** Phase 6 — multi-season history. Empty if no prior seasons simulated. */
  getHistory?(): LeagueHistory;
  /** Per-game metadata for game-log link surfaces (opposing pitcher etc.). */
  getGameMetadata?(gameId: string): GameMetadata | undefined;
}

export const emptyState = (text: string): HTMLElement => {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = text;
  return div;
};

export const renderStub = (host: HTMLElement, title: string, body: string): void => {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>${title}</h2>`;
  wrap.appendChild(emptyState(body));
  host.appendChild(wrap);
};

export const labelForView = (v: MenuView): string => {
  switch (v) {
    case 'league': return 'League';
    case 'teams': return 'Teams';
    case 'players': return 'Players';
    case 'live': return 'Live';
    case 'history': return 'History';
  }
};

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Anchor-styled name button used everywhere a player name should jump to
 * the player view. Underlined to read as a hyperlink.
 */
export const playerNameLink = (
  fullName: string,
  playerId: string,
  className = '',
): string => {
  const safe = escapeHtml(fullName);
  return `<button type="button" class="player-link ${className}" data-player-link="${escapeHtml(playerId)}">${safe}</button>`;
};

/** Wires every `[data-player-link]` element under `host` to `onClick`. */
export const wirePlayerLinks = (
  host: HTMLElement,
  onClick: (playerId: string) => void,
): void => {
  host.querySelectorAll<HTMLElement>('[data-player-link]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = el.dataset['playerLink'];
      if (id) onClick(id);
    });
  });
};
