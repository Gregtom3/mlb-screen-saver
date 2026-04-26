import type { Team, TeamId } from '../world/types.js';
import type { BattingLine, PitchingLine } from '../stats/types.js';
import {
  battingAvg, era, formatAvg, formatEra, formatIp, formatSigned, formatWhip,
  last10, onBasePct, ops, runDiff, sluggingPct, streak, whip, winPct,
} from '../stats/derived.js';
import { isQualifiedBatter, isQualifiedPitcher } from '../stats/qualifiers.js';
import { mvpRanking, cyYoungRanking, rookieRanking } from '../stats/awards.js';
import type { MenuContext } from './menu-shared.js';
import { emptyState, playerNameLink } from './menu-shared.js';

// Phase 5.5 League view, with Phase 6 sortable leaderboards. Each table
// stores its current sort state on a closure so re-renders preserve it
// across clicks without a full menu re-render.

interface LeaderboardCol<L> {
  readonly key: string;
  readonly label: string;
  readonly value: (line: L) => number;
  /** Default sort direction when this column is first selected. */
  readonly defaultDir: 'asc' | 'desc';
  /** Cell renderer; defaults to integer formatting. */
  readonly format?: (line: L) => string;
}

const BATTING_COLUMNS: readonly LeaderboardCol<BattingLine>[] = [
  { key: 'G', label: 'G', value: (b) => b.G, defaultDir: 'desc' },
  { key: 'PA', label: 'PA', value: (b) => b.PA, defaultDir: 'desc' },
  { key: 'AB', label: 'AB', value: (b) => b.AB, defaultDir: 'desc' },
  { key: 'H', label: 'H', value: (b) => b.H, defaultDir: 'desc' },
  { key: 'HR', label: 'HR', value: (b) => b.HR, defaultDir: 'desc' },
  { key: 'RBI', label: 'RBI', value: (b) => b.RBI, defaultDir: 'desc' },
  { key: 'BB', label: 'BB', value: (b) => b.BB, defaultDir: 'desc' },
  { key: 'SO', label: 'SO', value: (b) => b.SO, defaultDir: 'asc' },
  { key: 'AVG', label: 'AVG', value: (b) => battingAvg(b), defaultDir: 'desc',
    format: (b) => formatAvg(battingAvg(b)) },
  { key: 'OBP', label: 'OBP', value: (b) => onBasePct(b), defaultDir: 'desc',
    format: (b) => formatAvg(onBasePct(b)) },
  { key: 'SLG', label: 'SLG', value: (b) => sluggingPct(b), defaultDir: 'desc',
    format: (b) => formatAvg(sluggingPct(b)) },
  { key: 'OPS', label: 'OPS', value: (b) => ops(b), defaultDir: 'desc',
    format: (b) => formatAvg(ops(b)) },
  { key: 'WPA', label: 'WPA', value: (b) => b.WPA, defaultDir: 'desc',
    format: (b) => formatSigned(b.WPA, 2) },
];

const PITCHING_COLUMNS: readonly LeaderboardCol<PitchingLine>[] = [
  { key: 'G', label: 'G', value: (p) => p.G, defaultDir: 'desc' },
  { key: 'GS', label: 'GS', value: (p) => p.GS, defaultDir: 'desc' },
  { key: 'IP', label: 'IP', value: (p) => p.IPouts, defaultDir: 'desc',
    format: (p) => formatIp(p) },
  { key: 'H', label: 'H', value: (p) => p.H, defaultDir: 'asc' },
  { key: 'R', label: 'R', value: (p) => p.R, defaultDir: 'asc' },
  { key: 'ER', label: 'ER', value: (p) => p.ER, defaultDir: 'asc' },
  { key: 'BB', label: 'BB', value: (p) => p.BB, defaultDir: 'asc' },
  { key: 'SO', label: 'SO', value: (p) => p.SO, defaultDir: 'desc' },
  { key: 'HR', label: 'HR', value: (p) => p.HR, defaultDir: 'asc' },
  { key: 'ERA', label: 'ERA', value: (p) => era(p), defaultDir: 'asc',
    format: (p) => formatEra(era(p)) },
  { key: 'WHIP', label: 'WHIP', value: (p) => whip(p), defaultDir: 'asc',
    format: (p) => formatWhip(whip(p)) },
  { key: 'WPA', label: 'WPA', value: (p) => p.WPA, defaultDir: 'desc',
    format: (p) => formatSigned(p.WPA, 2) },
];

interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export const renderLeague = (
  host: HTMLElement,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  onPlayerClick: (id: string) => void,
  onTeamClick: (id: TeamId) => void,
): void => {
  const agg = ctx.getAggregates();
  const games = ctx.getTeamGamesPlayed();
  const wrap = document.createElement('div');
  wrap.className = 'league-view';

  // ----- Standings -----
  const standingsHeader = document.createElement('h2');
  standingsHeader.textContent = 'Standings';
  wrap.appendChild(standingsHeader);

  for (const conf of ['West', 'East'] as const) {
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
        ${divTeams.map(({ team, line }, idx) => {
          const leader = divTeams[0]!.line!;
          const gb = idx === 0 ? '—' : ((leader.W - line!.W + line!.L - leader.L) / 2).toFixed(1);
          const s = streak(line!);
          const l10 = last10(line!);
          return `
            <tr data-team="${team.id}" class="clickable">
              <td><span class="team-stripe" style="background:${team.colors.primary}"></span> ${team.city} ${team.nickname}</td>
              <td>${line!.W}</td><td>${line!.L}</td><td>${formatAvg(winPct(line!))}</td>
              <td>${gb}</td>
              <td>${s ? s.kind + s.n : '—'}</td>
              <td>${l10.wins}-${l10.losses}</td>
              <td>${line!.RS}</td><td>${line!.RA}</td><td>${formatSigned(runDiff(line!))}</td>
              <td>${line!.homeW}-${line!.homeL}</td>
              <td>${line!.awayW}-${line!.awayL}</td>
            </tr>
          `;
        }).join('')}
        </tbody>`;
      table.querySelectorAll<HTMLTableRowElement>('tr.clickable').forEach((tr) => {
        tr.addEventListener('click', () => {
          const id = tr.dataset['team'];
          if (id) onTeamClick(id);
        });
      });
      wrap.appendChild(table);
    }
  }

  // ----- Awards watch -----
  const awardsHeader = document.createElement('h2');
  awardsHeader.textContent = 'Awards watch';
  wrap.appendChild(awardsHeader);

  const mvp = mvpRanking(agg.batting, ctx.playerIndex, games);
  const cy = cyYoungRanking(agg.pitching, ctx.playerIndex, games);
  const rk = rookieRanking(agg.batting, ctx.playerIndex, games);

  const awardsRow = document.createElement('div');
  awardsRow.className = 'awards-row';
  const awardCol = (title: string, items: string[]) => `
    <div class="awards-col">
      <h3>${title}</h3>
      <ol>${items.join('')}</ol>
    </div>`;
  const awardItem = (
    c: { playerId: string; player: { firstName: string; lastName: string } | undefined; score: number },
  ): string => {
    const name = c.player ? `${c.player.firstName} ${c.player.lastName}` : c.playerId;
    return `<li data-player="${c.playerId}">
      <span class="aw-name">${name}</span>
      <span class="aw-score">${formatSigned(c.score, 2)}</span></li>`;
  };
  awardsRow.innerHTML =
    awardCol('MVP', mvp.slice(0, 5).map(awardItem)) +
    awardCol('Cy Young', cy.slice(0, 5).map(awardItem)) +
    awardCol('Rookie', rk.slice(0, 5).map(awardItem));
  awardsRow.querySelectorAll<HTMLLIElement>('li[data-player]').forEach((li) => {
    li.addEventListener('click', () => {
      const id = li.dataset['player'];
      if (id) onPlayerClick(id);
    });
    li.classList.add('clickable');
  });
  wrap.appendChild(awardsRow);

  // ----- Leaderboards -----
  const lbHeader = document.createElement('h2');
  lbHeader.textContent = 'Leaderboards';
  wrap.appendChild(lbHeader);

  const battingHeader = document.createElement('h3');
  battingHeader.textContent = 'Batting (qualified · click a column to sort)';
  wrap.appendChild(battingHeader);

  const battingRows = [...agg.batting.values()].filter((b) => isQualifiedBatter(b, games));
  if (battingRows.length === 0) {
    wrap.appendChild(emptyState('No qualified hitters yet — keep watching.'));
  } else {
    wrap.appendChild(
      buildSortableLeaderboard(
        battingRows,
        BATTING_COLUMNS,
        { key: 'AVG', dir: 'desc' },
        (b) => {
          const player = ctx.playerIndex.get(b.playerId);
          const team = teamById.get(b.teamId);
          const name = player ? `${player.firstName} ${player.lastName}` : b.playerId;
          return {
            playerId: b.playerId,
            nameCell: playerNameLink(name, b.playerId),
            teamCell: team ? team.abbr : '',
          };
        },
        onPlayerClick,
      ),
    );
  }

  const pitchingHeader = document.createElement('h3');
  pitchingHeader.textContent = 'Pitching (qualified · click a column to sort)';
  wrap.appendChild(pitchingHeader);

  const pitchingRows = [...agg.pitching.values()].filter((p) => isQualifiedPitcher(p, games));
  if (pitchingRows.length === 0) {
    wrap.appendChild(emptyState('No qualified pitchers yet.'));
  } else {
    wrap.appendChild(
      buildSortableLeaderboard(
        pitchingRows,
        PITCHING_COLUMNS,
        { key: 'ERA', dir: 'asc' },
        (p) => {
          const player = ctx.playerIndex.get(p.playerId);
          const team = teamById.get(p.teamId);
          const name = player ? `${player.firstName} ${player.lastName}` : p.playerId;
          return {
            playerId: p.playerId,
            nameCell: playerNameLink(name, p.playerId),
            teamCell: team ? team.abbr : '',
          };
        },
        onPlayerClick,
      ),
    );
  }

  host.appendChild(wrap);
};

const buildSortableLeaderboard = <L extends { playerId: string; teamId: string }>(
  rows: readonly L[],
  columns: readonly LeaderboardCol<L>[],
  initialSort: SortState,
  describe: (line: L) => { playerId: string; nameCell: string; teamCell: string },
  onPlayerClick: (id: string) => void,
): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.className = 'leaderboard';
  const sort: SortState = { ...initialSort };

  const draw = () => {
    const col = columns.find((c) => c.key === sort.key)!;
    const sorted = [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      return sort.dir === 'asc' ? va - vb : vb - va;
    }).slice(0, 12);

    const headerCells = columns.map((c) => {
      const isActive = c.key === sort.key;
      const arrow = isActive ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th data-col="${c.key}" class="sortable ${isActive ? 'active-sort' : ''}">${c.label}${arrow}</th>`;
    }).join('');

    wrap.innerHTML = `
      <table class="sortable-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Team</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
        ${sorted.map((line) => {
          const d = describe(line);
          const cells = columns.map((c) => {
            const txt = c.format ? c.format(line) : String(c.value(line));
            return `<td>${txt}</td>`;
          }).join('');
          return `<tr data-player="${d.playerId}">
            <td>${d.nameCell}</td>
            <td>${d.teamCell}</td>
            ${cells}
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll<HTMLTableHeaderCellElement>('th[data-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const colKey = th.dataset['col']!;
        const colDef = columns.find((c) => c.key === colKey);
        if (!colDef) return;
        if (sort.key === colKey) {
          sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sort.key = colKey;
          sort.dir = colDef.defaultDir;
        }
        draw();
      });
    });
    wrap.querySelectorAll<HTMLTableRowElement>('tbody tr[data-player]').forEach((tr) => {
      // Clicking a row navigates, but only when the click didn't land on the
      // dedicated player-link button (which the orchestrator already wires).
      tr.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement;
        if (target.closest('[data-player-link]')) return;
        const id = tr.dataset['player'];
        if (id) onPlayerClick(id);
      });
      tr.classList.add('clickable');
    });
  };

  draw();
  return wrap;
};
