import type { Player, PlayerId, Team, TeamId } from '../world/types.js';
import type { SeasonAggregates } from '../stats/types.js';
import {
  battingAvg,
  era,
  formatAvg,
  formatEra,
  formatIp,
  formatRecord,
  formatSigned,
  formatWhip,
  last10,
  ops,
  runDiff,
  sluggingPct,
  streak,
  whip,
  winPct,
} from '../stats/derived.js';
import { isQualifiedBatter, isQualifiedPitcher } from '../stats/qualifiers.js';

// Phase 5.5 stats menu shell. DOM-based overlay over the canvas; the
// renderer keeps drawing the screensaver behind it.

export type MenuView = 'league' | 'teams' | 'players' | 'live' | 'history';

interface MenuViewState {
  view: MenuView;
  // Optional sub-context — e.g. selected player or team — for drill-down.
  selectedPlayer?: PlayerId;
  selectedTeam?: TeamId;
}

export interface MenuContext {
  /** Always-fresh aggregates for the league. */
  getAggregates(): SeasonAggregates;
  /** Team count of games played, used for qualifier thresholds. */
  getTeamGamesPlayed(): number;
  readonly teams: readonly Team[];
  readonly playerIndex: ReadonlyMap<PlayerId, Player>;
}

interface MenuHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  setView(view: MenuView): void;
}

const VIEW_ORDER: readonly MenuView[] = ['league', 'teams', 'players', 'live', 'history'];

export const mountMenu = (host: HTMLElement, ctx: MenuContext): MenuHandle => {
  // Build the overlay DOM once.
  const root = document.createElement('div');
  root.id = 'menu';
  root.className = 'menu hidden';
  root.innerHTML = `
    <div class="menu-header">
      <div class="menu-tabs">
        ${VIEW_ORDER.map(
          (v, i) =>
            `<button data-view="${v}" class="${i === 0 ? 'active' : ''}">[${i + 1}] ${labelFor(v)}</button>`,
        ).join('')}
      </div>
      <div class="menu-breadcrumb"></div>
      <button class="menu-close" type="button">[Esc] close</button>
    </div>
    <div class="menu-content" id="menu-content"></div>
  `;
  host.appendChild(root);

  const tabs = root.querySelectorAll<HTMLButtonElement>('.menu-tabs button');
  const breadcrumb = root.querySelector<HTMLDivElement>('.menu-breadcrumb')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('.menu-close')!;
  const content = root.querySelector<HTMLDivElement>('#menu-content')!;

  let state: MenuViewState = { view: 'league' };
  let isOpen = false;

  const teamById = new Map(ctx.teams.map((t) => [t.id, t]));

  const render = () => {
    // Highlight the active tab.
    for (const tab of tabs) {
      const v = tab.dataset['view'];
      tab.classList.toggle('active', v === state.view);
    }
    breadcrumb.textContent = breadcrumbFor(state, ctx, teamById);
    content.innerHTML = ''; // wipe
    switch (state.view) {
      case 'league':
        renderLeague(content, ctx, teamById, (playerId) => {
          state = { view: 'players', selectedPlayer: playerId };
          render();
        });
        break;
      case 'teams':
        renderStub(content, 'Teams view',
          'Team detail pages (roster, schedule, projections, stadium) ship next.');
        break;
      case 'players':
        if (state.selectedPlayer) {
          const p = ctx.playerIndex.get(state.selectedPlayer);
          if (p) renderPlayer(content, p, ctx, teamById);
          else renderStub(content, 'Player', 'Unknown player id.');
        } else {
          renderPlayerIndex(content, ctx, teamById, (playerId) => {
            state = { view: 'players', selectedPlayer: playerId };
            render();
          });
        }
        break;
      case 'live':
        renderStub(content, 'Live games',
          'Live game grid + win-probability charts ship in part 2 of phase 5.5.');
        break;
      case 'history':
        renderStub(content, 'History',
          'Past seasons, all-time records, hall of fame — empty until phase 6 lands.');
        break;
    }
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const v = tab.dataset['view'] as MenuView | undefined;
      if (v) {
        state = { view: v };
        render();
      }
    });
  }
  closeBtn.addEventListener('click', () => handle.close());

  const handle: MenuHandle = {
    open() {
      isOpen = true;
      root.classList.remove('hidden');
      render();
    },
    close() {
      isOpen = false;
      root.classList.add('hidden');
    },
    toggle() {
      if (isOpen) handle.close();
      else handle.open();
    },
    isOpen() {
      return isOpen;
    },
    setView(view: MenuView) {
      state = { view };
      render();
    },
  };

  return handle;
};

const labelFor = (v: MenuView): string => {
  switch (v) {
    case 'league': return 'League';
    case 'teams': return 'Teams';
    case 'players': return 'Players';
    case 'live': return 'Live';
    case 'history': return 'History';
  }
};

const breadcrumbFor = (
  state: MenuViewState,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
): string => {
  const parts: string[] = [labelFor(state.view)];
  if (state.view === 'players' && state.selectedPlayer) {
    const p = ctx.playerIndex.get(state.selectedPlayer);
    if (p) parts.push(`${p.firstName} ${p.lastName}`);
  }
  if (state.selectedTeam) {
    const t = teamById.get(state.selectedTeam);
    if (t) parts.unshift(`${t.city} ${t.nickname}`);
  }
  return parts.join(' › ');
};

// ============================================== league view =====

const renderLeague = (
  host: HTMLElement,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  onPlayerClick: (id: PlayerId) => void,
): void => {
  const agg = ctx.getAggregates();
  const games = ctx.getTeamGamesPlayed();

  const wrap = document.createElement('div');
  wrap.className = 'league-view';

  // Standings — grouped by conference + division.
  const standingsHeader = document.createElement('h2');
  standingsHeader.textContent = 'Standings';
  wrap.appendChild(standingsHeader);

  const conferences: Array<'West' | 'East'> = ['West', 'East'];
  for (const conf of conferences) {
    const confHeader = document.createElement('h3');
    confHeader.textContent = `${conf}ern Conference`;
    wrap.appendChild(confHeader);

    const divisions = [...new Set(ctx.teams.filter((t) => t.conference === conf).map((t) => t.division))];
    for (const div of divisions) {
      const divHeader = document.createElement('h4');
      divHeader.textContent = `${div} Division`;
      wrap.appendChild(divHeader);

      const divTeams = ctx.teams
        .filter((t) => t.conference === conf && t.division === div)
        .map((t) => ({ team: t, line: agg.teams.get(t.id) }))
        .filter((row) => row.line)
        .sort((a, b) => {
          const pa = winPct(a.line!);
          const pb = winPct(b.line!);
          if (pb !== pa) return pb - pa;
          return runDiff(b.line!) - runDiff(a.line!);
        });

      const table = document.createElement('table');
      table.innerHTML = `
        <thead>
          <tr>
            <th>Team</th><th>W</th><th>L</th><th>PCT</th>
            <th>GB</th><th>Streak</th><th>L10</th>
            <th>RS</th><th>RA</th><th>RD</th>
            <th>HOME</th><th>AWAY</th>
          </tr>
        </thead>
        <tbody>
        ${divTeams
          .map(({ team, line }, idx) => {
            const leader = divTeams[0]!.line!;
            const gb = idx === 0 ? '—' : ((leader.W - line!.W + line!.L - leader.L) / 2).toFixed(1);
            const s = streak(line!);
            const l10 = last10(line!);
            return `
              <tr>
                <td><span class="team-stripe" style="background:${team.colors.primary}"></span> ${team.city} ${team.nickname}</td>
                <td>${line!.W}</td>
                <td>${line!.L}</td>
                <td>${formatAvg(winPct(line!))}</td>
                <td>${gb}</td>
                <td>${s ? s.kind + s.n : '—'}</td>
                <td>${l10.wins}-${l10.losses}</td>
                <td>${line!.RS}</td>
                <td>${line!.RA}</td>
                <td>${formatSigned(runDiff(line!))}</td>
                <td>${line!.homeW}-${line!.homeL}</td>
                <td>${line!.awayW}-${line!.awayL}</td>
              </tr>
            `;
          })
          .join('')}
        </tbody>
      `;
      wrap.appendChild(table);
    }
  }

  // Leaderboards.
  const lbHeader = document.createElement('h2');
  lbHeader.textContent = 'Leaderboards';
  wrap.appendChild(lbHeader);

  const battingHeader = document.createElement('h3');
  battingHeader.textContent = 'Batting (qualified)';
  wrap.appendChild(battingHeader);

  const battingRows = [...agg.batting.values()]
    .filter((b) => isQualifiedBatter(b, games))
    .sort((a, b) => battingAvg(b) - battingAvg(a))
    .slice(0, 12);

  if (battingRows.length === 0) {
    wrap.appendChild(emptyState('No qualified hitters yet — keep watching.'));
  } else {
    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Player</th><th>Team</th>
          <th>G</th><th>PA</th><th>AB</th><th>H</th>
          <th>HR</th><th>RBI</th><th>BB</th><th>SO</th>
          <th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th><th>WPA</th>
        </tr>
      </thead>
      <tbody>
      ${battingRows
        .map((b) => {
          const player = ctx.playerIndex.get(b.playerId);
          const team = teamById.get(b.teamId);
          return `
            <tr data-player="${b.playerId}" class="clickable">
              <td>${player ? player.firstName + ' ' + player.lastName : b.playerId}</td>
              <td>${team ? team.abbr : ''}</td>
              <td>${b.G}</td><td>${b.PA}</td><td>${b.AB}</td><td>${b.H}</td>
              <td>${b.HR}</td><td>${b.RBI}</td><td>${b.BB}</td><td>${b.SO}</td>
              <td>${formatAvg(battingAvg(b))}</td>
              <td>${formatAvg((b.H + b.BB + b.HBP) / Math.max(1, b.AB + b.BB + b.HBP + b.SF))}</td>
              <td>${formatAvg(sluggingPct(b))}</td>
              <td>${formatAvg(ops(b))}</td>
              <td>${formatSigned(b.WPA, 2)}</td>
            </tr>
          `;
        })
        .join('')}
      </tbody>
    `;
    table.querySelectorAll<HTMLTableRowElement>('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = tr.dataset['player'];
        if (id) onPlayerClick(id);
      });
    });
    wrap.appendChild(table);
  }

  const pitchingHeader = document.createElement('h3');
  pitchingHeader.textContent = 'Pitching (qualified)';
  wrap.appendChild(pitchingHeader);

  const pitchingRows = [...agg.pitching.values()]
    .filter((p) => isQualifiedPitcher(p, games))
    .sort((a, b) => era(a) - era(b))
    .slice(0, 12);

  if (pitchingRows.length === 0) {
    wrap.appendChild(emptyState('No qualified pitchers yet.'));
  } else {
    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Player</th><th>Team</th>
          <th>G</th><th>GS</th><th>IP</th>
          <th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>HR</th>
          <th>ERA</th><th>WHIP</th><th>WPA</th>
        </tr>
      </thead>
      <tbody>
      ${pitchingRows
        .map((p) => {
          const player = ctx.playerIndex.get(p.playerId);
          const team = teamById.get(p.teamId);
          return `
            <tr data-player="${p.playerId}" class="clickable">
              <td>${player ? player.firstName + ' ' + player.lastName : p.playerId}</td>
              <td>${team ? team.abbr : ''}</td>
              <td>${p.G}</td><td>${p.GS}</td><td>${formatIp(p)}</td>
              <td>${p.H}</td><td>${p.R}</td><td>${p.ER}</td>
              <td>${p.BB}</td><td>${p.SO}</td><td>${p.HR}</td>
              <td>${formatEra(era(p))}</td>
              <td>${formatWhip(whip(p))}</td>
              <td>${formatSigned(p.WPA, 2)}</td>
            </tr>
          `;
        })
        .join('')}
      </tbody>
    `;
    table.querySelectorAll<HTMLTableRowElement>('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = tr.dataset['player'];
        if (id) onPlayerClick(id);
      });
    });
    wrap.appendChild(table);
  }

  host.appendChild(wrap);
};

// ============================================== player view =====

const renderPlayerIndex = (
  host: HTMLElement,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  onPlayerClick: (id: PlayerId) => void,
): void => {
  const agg = ctx.getAggregates();
  const games = ctx.getTeamGamesPlayed();
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h2>All players</h2>';

  // Group active players by team, list ordered alphabetically.
  for (const team of ctx.teams) {
    const teamHeader = document.createElement('h3');
    teamHeader.innerHTML = `<span class="team-stripe" style="background:${team.colors.primary}"></span> ${team.city} ${team.nickname}`;
    wrap.appendChild(teamHeader);

    const players = [...ctx.playerIndex.values()]
      .filter((p) => p.teamId === team.id && !p.inMinors)
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
          </button>
        `;
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

  // Suppress lint
  void games; void teamById;
  host.appendChild(wrap);
};

const renderPlayer = (
  host: HTMLElement,
  player: Player,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
): void => {
  const agg = ctx.getAggregates();
  const team = player.teamId ? teamById.get(player.teamId) : undefined;
  const wrap = document.createElement('div');
  wrap.className = 'player-view';

  // Header card.
  const header = document.createElement('div');
  header.className = 'player-header';
  header.innerHTML = `
    <div class="player-portrait" style="background:${team?.colors.primary ?? '#333'}">
      <div class="player-portrait-cap" style="background:${team?.colors.secondary ?? '#777'}"></div>
    </div>
    <div class="player-bio">
      <h2>${player.firstName} ${player.lastName}</h2>
      <div class="player-line">${player.primaryPosition} · ${player.bats}/${player.throws} · ${team ? team.city + ' ' + team.nickname : 'free agent'}</div>
      <div class="player-meta">b. ${player.birthYear} · ${player.hometown}</div>
      ${player.personality.length ? `<div class="player-tags">${player.personality.map((t) => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
    </div>
  `;
  wrap.appendChild(header);

  // Season line.
  const isPitcher = player.primaryPosition === 'P';
  const b = agg.batting.get(player.id);
  const p = agg.pitching.get(player.id);

  if (b && b.PA > 0) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3>${isPitcher ? 'Season batting (limited)' : 'Season batting'}</h3>`;
    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr><th>G</th><th>PA</th><th>AB</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>RBI</th>
            <th>BB</th><th>SO</th><th>SB</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th><th>WPA</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${b.G}</td><td>${b.PA}</td><td>${b.AB}</td><td>${b.H}</td>
          <td>${b.doubles}</td><td>${b.triples}</td><td>${b.HR}</td><td>${b.RBI}</td>
          <td>${b.BB}</td><td>${b.SO}</td><td>0</td>
          <td>${formatAvg(battingAvg(b))}</td>
          <td>${formatAvg((b.H + b.BB + b.HBP) / Math.max(1, b.AB + b.BB + b.HBP + b.SF))}</td>
          <td>${formatAvg(sluggingPct(b))}</td>
          <td>${formatAvg(ops(b))}</td>
          <td>${formatSigned(b.WPA, 2)}</td>
        </tr>
      </tbody>
    `;
    sec.appendChild(table);
    wrap.appendChild(sec);
  }

  if (p && p.BF > 0) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3>Season pitching</h3>`;
    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr><th>G</th><th>GS</th><th>BF</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>HR</th>
            <th>ERA</th><th>WHIP</th><th>K/9</th><th>WPA</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${p.G}</td><td>${p.GS}</td><td>${p.BF}</td><td>${formatIp(p)}</td>
          <td>${p.H}</td><td>${p.R}</td><td>${p.ER}</td>
          <td>${p.BB}</td><td>${p.SO}</td><td>${p.HR}</td>
          <td>${formatEra(era(p))}</td>
          <td>${formatWhip(whip(p))}</td>
          <td>${formatEra(p.IPouts > 0 ? (p.SO * 27) / p.IPouts : 0)}</td>
          <td>${formatSigned(p.WPA, 2)}</td>
        </tr>
      </tbody>
    `;
    sec.appendChild(table);
    wrap.appendChild(sec);
  }

  if ((!b || b.PA === 0) && (!p || p.BF === 0)) {
    wrap.appendChild(emptyState('No completed-game stats for this player yet.'));
  }

  // Career placeholder per dev_polish_001 — multi-season fills in Phase 6.
  const careerSec = document.createElement('section');
  careerSec.innerHTML = `<h3>Career</h3>`;
  careerSec.appendChild(emptyState('Multi-season career stats land in phase 6.'));
  wrap.appendChild(careerSec);

  // Suppress lint
  void formatRecord;
  host.appendChild(wrap);
};

// ============================================== shared helpers =====

const renderStub = (host: HTMLElement, title: string, body: string): void => {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>${title}</h2>`;
  wrap.appendChild(emptyState(body));
  host.appendChild(wrap);
};

const emptyState = (text: string): HTMLElement => {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = text;
  return div;
};
