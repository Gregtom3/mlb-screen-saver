import type { Player, PlayerId, Team, TeamId } from '../world/types.js';
import {
  battingAvg, era, formatAvg, formatEra,
} from '../stats/derived.js';
import {
  type MenuContext, type MenuView, type MenuViewState,
  labelForView, wirePlayerLinks,
} from './menu-shared.js';
import { renderLeague } from './menu-league.js';
import { renderTeam } from './menu-team.js';
import { renderPlayer } from './menu-player.js';
import { renderLive } from './menu-live.js';
import { renderHistory } from './menu-history.js';

// Phase 5.5 stats menu — orchestrator. Wires the per-view renderers behind a
// modal overlay and handles tab + breadcrumb state. Phase 6 adds a back
// navigation stack so deep-links (e.g. game log → opposing pitcher → hall
// of fame entry) can be reversed without losing context.

const VIEW_ORDER: readonly MenuView[] = ['league', 'teams', 'players', 'live', 'history'];

interface MenuHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  setView(view: MenuView): void;
  /** Force a re-render — e.g. after live-game scores ticked. */
  refresh(): void;
}

export const mountMenu = (
  host: HTMLElement,
  ctx: MenuContext & { stadiums?: ReadonlyMap<string, import('../world/types.js').Stadium> },
): MenuHandle => {
  const root = document.createElement('div');
  root.id = 'menu';
  root.className = 'menu hidden';
  root.innerHTML = `
    <div class="menu-header">
      <div class="menu-tabs">
        ${VIEW_ORDER.map(
          (v, i) =>
            `<button data-view="${v}" class="${i === 0 ? 'active' : ''}">[${i + 1}] ${labelForView(v)}</button>`,
        ).join('')}
      </div>
      <button class="menu-back" type="button" aria-label="Back" hidden>← back</button>
      <div class="menu-breadcrumb"></div>
      <button class="menu-close" type="button">[Esc] close</button>
    </div>
    <div class="menu-content" id="menu-content"></div>
  `;
  host.appendChild(root);

  const tabs = root.querySelectorAll<HTMLButtonElement>('.menu-tabs button');
  const breadcrumb = root.querySelector<HTMLDivElement>('.menu-breadcrumb')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('.menu-close')!;
  const backBtn = root.querySelector<HTMLButtonElement>('.menu-back')!;
  const content = root.querySelector<HTMLDivElement>('#menu-content')!;

  let state: MenuViewState = { view: 'league' };
  // Back stack: every navigation that drills deeper pushes the prior state.
  const backStack: MenuViewState[] = [];
  let isOpen = false;

  const teamById = new Map<TeamId, Team>(ctx.teams.map((t) => [t.id, t]));

  const navigate = (next: MenuViewState) => {
    backStack.push(state);
    state = next;
    render();
  };

  const goBack = () => {
    const prev = backStack.pop();
    if (prev) {
      state = prev;
      render();
    }
  };

  const goToPlayer = (playerId: PlayerId) => {
    navigate({ view: 'players', selectedPlayer: playerId });
  };
  const goToTeam = (teamId: TeamId) => {
    navigate({ view: 'teams', selectedTeam: teamId });
  };

  const render = () => {
    for (const tab of tabs) {
      const v = tab.dataset['view'];
      tab.classList.toggle('active', v === state.view);
    }
    breadcrumb.textContent = breadcrumbFor(state, ctx, teamById);
    backBtn.hidden = backStack.length === 0;
    content.innerHTML = '';
    switch (state.view) {
      case 'league':
        renderLeague(content, ctx, teamById, goToPlayer, goToTeam);
        break;
      case 'teams': {
        if (state.selectedTeam) {
          const team = teamById.get(state.selectedTeam);
          if (team) {
            const stadium = ctx.stadiums?.get(team.stadiumId);
            renderTeam(content, team, stadium, ctx, teamById, goToPlayer);
          }
        } else {
          renderTeamIndex(content, ctx, teamById, goToTeam);
        }
        break;
      }
      case 'players':
        if (state.selectedPlayer) {
          const p = ctx.playerIndex.get(state.selectedPlayer);
          if (p) renderPlayer(content, p, ctx, teamById, goToPlayer);
          else content.appendChild(emptyText('Unknown player.'));
        } else {
          renderPlayerIndex(content, ctx, teamById, goToPlayer);
        }
        break;
      case 'live':
        renderLive(content, ctx, teamById, state.selectedGameId, (gameId) => {
          state = { ...state, view: 'live', selectedGameId: gameId };
          render();
        });
        break;
      case 'history':
        renderHistory(content, ctx, teamById, state, navigate, goToPlayer);
        break;
    }
    // Wire every `[data-player-link]` rendered by the views to navigate.
    wirePlayerLinks(content, goToPlayer);
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const v = tab.dataset['view'] as MenuView | undefined;
      if (v) {
        // Tab clicks reset state for that view and clear the back stack;
        // they're a "you are here" jump, not a drill-down.
        backStack.length = 0;
        state = { view: v };
        render();
      }
    });
  }
  closeBtn.addEventListener('click', () => handle.close());
  backBtn.addEventListener('click', () => goBack());

  const handle: MenuHandle = {
    open() { isOpen = true; root.classList.remove('hidden'); render(); },
    close() { isOpen = false; root.classList.add('hidden'); },
    toggle() { if (isOpen) handle.close(); else handle.open(); },
    isOpen() { return isOpen; },
    setView(view: MenuView) {
      backStack.length = 0;
      state = { view };
      render();
    },
    refresh() { if (isOpen) render(); },
  };

  return handle;
};

const breadcrumbFor = (
  state: MenuViewState,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
): string => {
  const parts: string[] = [labelForView(state.view)];
  if (state.view === 'teams' && state.selectedTeam) {
    const t = teamById.get(state.selectedTeam);
    if (t) parts.push(`${t.city} ${t.nickname}`);
  }
  if (state.view === 'players' && state.selectedPlayer) {
    const p = ctx.playerIndex.get(state.selectedPlayer);
    if (p) parts.push(`${p.firstName} ${p.lastName}`);
  }
  if (state.view === 'history' && state.historyRoute) {
    switch (state.historyRoute.kind) {
      case 'season':
        parts.push(`Season ${state.historyRoute.year}`);
        break;
      case 'records':
        parts.push('Single-season records');
        break;
      case 'all-time':
        parts.push('All-time records');
        break;
      case 'hall-of-fame':
        parts.push('Hall of Fame');
        break;
    }
  }
  return parts.join(' › ');
};

const renderTeamIndex = (
  host: HTMLElement,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  onTeamClick: (id: TeamId) => void,
): void => {
  void teamById;
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h2>Teams</h2>';
  for (const conf of ['West', 'East'] as const) {
    const confH = document.createElement('h3');
    confH.textContent = `${conf}ern Conference`;
    wrap.appendChild(confH);
    const grid = document.createElement('div');
    grid.className = 'team-grid';
    grid.innerHTML = ctx.teams
      .filter((t) => t.conference === conf)
      .map((t) => {
        const line = ctx.getAggregates().teams.get(t.id);
        const record = line ? `${line.W}-${line.L}` : '0-0';
        return `
          <button data-team="${t.id}" class="team-card" style="border-color:${t.colors.primary}">
            <div class="tc-name" style="color:${t.colors.primary}">${t.city}</div>
            <div class="tc-nickname">${t.nickname}</div>
            <div class="tc-meta">${t.division} · ${record}</div>
          </button>`;
      })
      .join('');
    grid.querySelectorAll<HTMLButtonElement>('button[data-team]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['team'];
        if (id) onTeamClick(id);
      });
    });
    wrap.appendChild(grid);
  }
  host.appendChild(wrap);
};

const renderPlayerIndex = (
  host: HTMLElement,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  onPlayerClick: (id: PlayerId) => void,
): void => {
  void teamById;
  const agg = ctx.getAggregates();
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h2>All players</h2>';
  for (const team of ctx.teams) {
    const teamHeader = document.createElement('h3');
    teamHeader.innerHTML = `<span class="team-stripe" style="background:${team.colors.primary}"></span> ${team.city} ${team.nickname}`;
    wrap.appendChild(teamHeader);
    const players = [...ctx.playerIndex.values()]
      .filter((p: Player) => p.teamId === team.id && !p.inMinors)
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
    const list = document.createElement('div');
    list.className = 'player-grid';
    list.innerHTML = players
      .map((p) => {
        const b = agg.batting.get(p.id);
        const pp = agg.pitching.get(p.id);
        const note =
          b && b.PA > 0 && (!pp || pp.IPouts === 0)
            ? `${formatAvg(battingAvg(b))} · ${b.HR} HR`
            : pp && pp.IPouts > 0
            ? `${formatEra(era(pp))} · ${pp.SO} K`
            : '';
        return `
          <button data-player="${p.id}" class="player-card-mini">
            <div class="pcm-name">${p.firstName} ${p.lastName}</div>
            <div class="pcm-meta">${p.primaryPosition} · ${p.bats}/${p.throws}</div>
            <div class="pcm-stat">${note}</div>
          </button>`;
      })
      .join('');
    list.querySelectorAll<HTMLButtonElement>('button.player-card-mini').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['player'];
        if (id) onPlayerClick(id);
      });
    });
    wrap.appendChild(list);
  }
  host.appendChild(wrap);
};

const emptyText = (text: string): HTMLElement => {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = text;
  return div;
};
