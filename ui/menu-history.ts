import type { Team, TeamId } from '../world/types.js';
import type {
  BattingLeaderKey,
  CareerBattingLine,
  CareerPitchingLine,
  HallOfFamer,
  LeagueHistory,
  PitchingLeaderKey,
  RecordBookEntry,
  SeasonRecord,
} from '../season/history.js';
import {
  BATTING_LEADER_KEYS,
  PITCHING_LEADER_KEYS,
  careerBattingScore,
  careerPitchingScore,
  formatLeaderValue,
} from '../season/history.js';
import {
  type MenuContext,
  type MenuViewState,
  emptyState,
  escapeHtml,
  playerNameLink,
} from './menu-shared.js';

// Phase 6 — multi-season history view. The History tab is now a small
// sub-router with its own routes that the orchestrator pushes onto the
// shared back stack. All player-name surfaces use `playerNameLink` so the
// universal back button + click-to-bio navigation works uniformly.

export const renderHistory = (
  host: HTMLElement,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  state: MenuViewState,
  navigate: (next: MenuViewState) => void,
  onPlayerClick: (id: string) => void,
): void => {
  void onPlayerClick;
  const history = ctx.getHistory?.();
  if (!history || history.seasons.length === 0) {
    renderEmpty(host, ctx);
    return;
  }
  const route = state.historyRoute ?? { kind: 'index' };
  switch (route.kind) {
    case 'index':
      renderIndex(host, ctx, history, teamById, navigate);
      break;
    case 'season':
      renderSeasonDetail(host, ctx, history, route.year, teamById, navigate);
      break;
    case 'records':
      renderSingleSeasonRecords(host, ctx, history, navigate);
      break;
    case 'all-time':
      renderAllTime(host, ctx, history, teamById, navigate);
      break;
    case 'hall-of-fame':
      renderHallOfFame(host, ctx, history, navigate);
      break;
  }
};

const renderEmpty = (host: HTMLElement, ctx: MenuContext): void => {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h2>History</h2>';
  const sec = document.createElement('section');
  sec.appendChild(
    emptyState(
      'No prior seasons in this league yet. Pre-simulate them with ?priorSeasons=N (default 2 in browser).',
    ),
  );
  wrap.appendChild(sec);

  const note = document.createElement('div');
  note.className = 'menu-hint';
  note.textContent = `Live league: ${ctx.teams.length} teams, season ${ctx.getAggregates().seasonYear}.`;
  wrap.appendChild(note);
  host.appendChild(wrap);
};

const renderIndex = (
  host: HTMLElement,
  ctx: MenuContext,
  history: LeagueHistory,
  teamById: ReadonlyMap<TeamId, Team>,
  navigate: (s: MenuViewState) => void,
): void => {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h2>History</h2>';

  // ----- Section 1: navigation cards -----
  const navRow = document.createElement('div');
  navRow.className = 'history-nav';
  navRow.innerHTML = `
    <button class="hist-card" data-route="records">
      <div class="hist-card-title">Single-season records</div>
      <div class="hist-card-meta">Top 5 finishes by stat across ${history.seasons.length} season${history.seasons.length === 1 ? '' : 's'}</div>
    </button>
    <button class="hist-card" data-route="all-time">
      <div class="hist-card-title">All-time records</div>
      <div class="hist-card-meta">${history.careerBatting.size} batters · ${history.careerPitching.size} pitchers</div>
    </button>
    <button class="hist-card" data-route="hall-of-fame">
      <div class="hist-card-title">Hall of Fame</div>
      <div class="hist-card-meta">${history.hallOfFame.length} inductee${history.hallOfFame.length === 1 ? '' : 's'}</div>
    </button>
  `;
  navRow.querySelectorAll<HTMLButtonElement>('button[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = btn.dataset['route'] as 'records' | 'all-time' | 'hall-of-fame';
      navigate({ view: 'history', historyRoute: { kind: route } });
    });
  });
  wrap.appendChild(navRow);

  // ----- Section 2: past seasons table -----
  const sec = document.createElement('section');
  sec.innerHTML = '<h3>Past seasons</h3>';
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Year</th><th>Champion</th><th>Runner-up</th>
        <th>MVP</th><th>Cy Young</th><th>Rookie</th><th></th>
      </tr>
    </thead>
    <tbody>
    ${history.seasons.map((s) => seasonRow(s, ctx, teamById)).join('')}
    </tbody>
  `;
  table.querySelectorAll<HTMLTableRowElement>('tr[data-year]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const year = parseInt(tr.dataset['year']!, 10);
      navigate({ view: 'history', historyRoute: { kind: 'season', year } });
    });
  });
  sec.appendChild(table);
  wrap.appendChild(sec);

  // ----- Section 3: footer -----
  const note = document.createElement('div');
  note.className = 'menu-hint';
  note.textContent = `Click a row to drill into one season's standings, leaders, and award race.`;
  wrap.appendChild(note);

  host.appendChild(wrap);
};

const seasonRow = (
  s: SeasonRecord,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
): string => {
  const champ = teamById.get(s.champion);
  const ru = teamById.get(s.runnerUp);
  return `
    <tr data-year="${s.seasonYear}" class="clickable">
      <td>${s.seasonYear}</td>
      <td>${champ ? `${champ.city} ${champ.nickname}` : '—'}</td>
      <td>${ru ? `${ru.city} ${ru.nickname}` : '—'}</td>
      <td>${s.mvp ? playerCell(ctx, s.mvp) : '—'}</td>
      <td>${s.cyYoung ? playerCell(ctx, s.cyYoung) : '—'}</td>
      <td>${s.rookie ? playerCell(ctx, s.rookie) : '—'}</td>
      <td class="hist-go">›</td>
    </tr>
  `;
};

const playerCell = (ctx: MenuContext, playerId: string): string => {
  const p = ctx.playerIndex.get(playerId);
  if (!p) return escapeHtml(playerId);
  return playerNameLink(`${p.firstName} ${p.lastName}`, playerId);
};

const renderSeasonDetail = (
  host: HTMLElement,
  ctx: MenuContext,
  history: LeagueHistory,
  year: number,
  teamById: ReadonlyMap<TeamId, Team>,
  navigate: (s: MenuViewState) => void,
): void => {
  void navigate;
  const season = history.seasons.find((s) => s.seasonYear === year);
  if (!season) {
    renderEmpty(host, ctx);
    return;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>Season ${year}</h2>`;

  const champ = teamById.get(season.champion);
  const ru = teamById.get(season.runnerUp);
  const summary = document.createElement('div');
  summary.className = 'season-summary';
  summary.innerHTML = `
    <div class="ss-trophy">🏆 ${champ ? `${champ.city} ${champ.nickname}` : '—'}</div>
    <div class="ss-runnerup">runner-up: ${ru ? `${ru.city} ${ru.nickname}` : '—'}</div>
    <div class="ss-awards">
      <span>MVP: ${season.mvp ? playerCell(ctx, season.mvp) : '—'}</span>
      <span>Cy Young: ${season.cyYoung ? playerCell(ctx, season.cyYoung) : '—'}</span>
      <span>Rookie: ${season.rookie ? playerCell(ctx, season.rookie) : '—'}</span>
    </div>
  `;
  wrap.appendChild(summary);

  // Final standings
  const standingsSec = document.createElement('section');
  standingsSec.innerHTML = '<h3>Final standings</h3>';
  const standingsTable = document.createElement('table');
  standingsTable.innerHTML = `
    <thead><tr><th>Team</th><th>W</th><th>L</th><th>RS</th><th>RA</th><th>RD</th></tr></thead>
    <tbody>
    ${season.standings.map((line) => {
      const t = teamById.get(line.teamId);
      const sign = line.RS - line.RA >= 0 ? '+' : '';
      return `<tr>
        <td>${t ? `<span class="team-stripe" style="background:${t.colors.primary}"></span> ${t.city} ${t.nickname}` : line.teamId}</td>
        <td>${line.W}</td><td>${line.L}</td>
        <td>${line.RS}</td><td>${line.RA}</td>
        <td>${sign}${line.RS - line.RA}</td>
      </tr>`;
    }).join('')}
    </tbody>
  `;
  standingsSec.appendChild(standingsTable);
  wrap.appendChild(standingsSec);

  // Season leaders
  const leadersSec = document.createElement('section');
  leadersSec.innerHTML = '<h3>Season leaders</h3>';
  const leadersTable = document.createElement('table');
  const leaderRows: string[] = [];
  for (const k of BATTING_LEADER_KEYS) {
    const ent = season.leaders.batting[k];
    leaderRows.push(`
      <tr>
        <td>${k}</td>
        <td>${ent.playerId ? playerCell(ctx, ent.playerId) : '—'}</td>
        <td>${formatLeaderValue(k, ent.value)}</td>
      </tr>`);
  }
  for (const k of PITCHING_LEADER_KEYS) {
    const ent = season.leaders.pitching[k];
    leaderRows.push(`
      <tr>
        <td>${k}</td>
        <td>${ent.playerId ? playerCell(ctx, ent.playerId) : '—'}</td>
        <td>${formatLeaderValue(k, ent.value)}</td>
      </tr>`);
  }
  leadersTable.innerHTML = `
    <thead><tr><th>Stat</th><th>Player</th><th>Value</th></tr></thead>
    <tbody>${leaderRows.join('')}</tbody>
  `;
  leadersSec.appendChild(leadersTable);
  wrap.appendChild(leadersSec);

  host.appendChild(wrap);
};

const renderSingleSeasonRecords = (
  host: HTMLElement,
  ctx: MenuContext,
  history: LeagueHistory,
  navigate: (s: MenuViewState) => void,
): void => {
  void navigate;
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h2>Single-season records</h2>';

  const sec = document.createElement('section');
  sec.innerHTML = '<h3>Batting</h3>';
  for (const k of BATTING_LEADER_KEYS) {
    sec.appendChild(recordTable(k, history.singleSeasonRecords.batting[k], ctx));
  }
  wrap.appendChild(sec);

  const sec2 = document.createElement('section');
  sec2.innerHTML = '<h3>Pitching</h3>';
  for (const k of PITCHING_LEADER_KEYS) {
    sec2.appendChild(recordTable(k, history.singleSeasonRecords.pitching[k], ctx));
  }
  wrap.appendChild(sec2);

  host.appendChild(wrap);
};

const recordTable = (
  key: BattingLeaderKey | PitchingLeaderKey,
  rows: readonly RecordBookEntry<BattingLeaderKey | PitchingLeaderKey>[],
  ctx: MenuContext,
): HTMLElement => {
  const block = document.createElement('div');
  block.className = 'record-block';
  block.innerHTML = `
    <h4>${key}</h4>
    ${rows.length === 0
      ? '<div class="empty-state">No qualified seasons.</div>'
      : `<table>
          <thead><tr><th>#</th><th>Player</th><th>Year</th><th>${key}</th></tr></thead>
          <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${playerCell(ctx, r.playerId)}</td>
              <td>${r.year}</td>
              <td>${formatLeaderValue(key, r.value)}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
  `;
  return block;
};

const renderAllTime = (
  host: HTMLElement,
  ctx: MenuContext,
  history: LeagueHistory,
  teamById: ReadonlyMap<TeamId, Team>,
  navigate: (s: MenuViewState) => void,
): void => {
  void teamById; void navigate;
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h2>All-time records</h2>';

  const battingRows = [...history.careerBatting.values()]
    .sort((a, b) => careerBattingScore(b) - careerBattingScore(a))
    .slice(0, 25);
  const pitchingRows = [...history.careerPitching.values()]
    .sort((a, b) => careerPitchingScore(b) - careerPitchingScore(a))
    .slice(0, 25);

  const battingSec = document.createElement('section');
  battingSec.innerHTML = '<h3>Career batting (top 25 by composite score)</h3>';
  const bTbl = document.createElement('table');
  bTbl.innerHTML = `
    <thead><tr>
      <th>#</th><th>Player</th><th>Yrs</th>
      <th>G</th><th>PA</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>RBI</th>
      <th>BB</th><th>SO</th><th>WPA</th><th>Score</th>
    </tr></thead>
    <tbody>
    ${battingRows.map((c, i) => careerBattingRow(i + 1, c, ctx)).join('')}
    </tbody>`;
  battingSec.appendChild(bTbl);
  wrap.appendChild(battingSec);

  const pitchingSec = document.createElement('section');
  pitchingSec.innerHTML = '<h3>Career pitching (top 25 by composite score)</h3>';
  const pTbl = document.createElement('table');
  pTbl.innerHTML = `
    <thead><tr>
      <th>#</th><th>Player</th><th>Yrs</th>
      <th>G</th><th>GS</th><th>W</th><th>L</th><th>IP</th>
      <th>H</th><th>ER</th><th>BB</th><th>SO</th><th>WPA</th><th>Score</th>
    </tr></thead>
    <tbody>
    ${pitchingRows.map((c, i) => careerPitchingRow(i + 1, c, ctx)).join('')}
    </tbody>`;
  pitchingSec.appendChild(pTbl);
  wrap.appendChild(pitchingSec);

  host.appendChild(wrap);
};

const careerBattingRow = (rank: number, c: CareerBattingLine, ctx: MenuContext): string => `
  <tr>
    <td>${rank}</td>
    <td>${playerCell(ctx, c.playerId)}</td>
    <td>${c.seasons}</td>
    <td>${c.G}</td><td>${c.PA}</td><td>${c.H}</td>
    <td>${c.doubles}</td><td>${c.triples}</td><td>${c.HR}</td><td>${c.RBI}</td>
    <td>${c.BB}</td><td>${c.SO}</td>
    <td>${c.WPA >= 0 ? '+' : ''}${c.WPA.toFixed(1)}</td>
    <td>${careerBattingScore(c).toFixed(0)}</td>
  </tr>`;

const careerPitchingRow = (rank: number, c: CareerPitchingLine, ctx: MenuContext): string => {
  const ip = (c.IPouts / 3).toFixed(1);
  return `
    <tr>
      <td>${rank}</td>
      <td>${playerCell(ctx, c.playerId)}</td>
      <td>${c.seasons}</td>
      <td>${c.G}</td><td>${c.GS}</td><td>${c.W}</td><td>${c.L}</td>
      <td>${ip}</td>
      <td>${c.H}</td><td>${c.ER}</td><td>${c.BB}</td><td>${c.SO}</td>
      <td>${c.WPA >= 0 ? '+' : ''}${c.WPA.toFixed(1)}</td>
      <td>${careerPitchingScore(c).toFixed(0)}</td>
    </tr>`;
};

const renderHallOfFame = (
  host: HTMLElement,
  ctx: MenuContext,
  history: LeagueHistory,
  navigate: (s: MenuViewState) => void,
): void => {
  void navigate;
  const wrap = document.createElement('div');
  wrap.innerHTML = '<h2>Hall of Fame</h2>';

  if (history.hallOfFame.length === 0) {
    wrap.appendChild(
      emptyState(
        'No inductees yet. Hall of Fame is gated on retired players who clear a career composite score; nobody qualifies in the current history snapshot.',
      ),
    );
    host.appendChild(wrap);
    return;
  }

  const list = document.createElement('div');
  list.className = 'hof-list';
  list.innerHTML = history.hallOfFame
    .map((h: HallOfFamer) => {
      const player = ctx.playerIndex.get(h.playerId);
      const name = player ? `${player.firstName} ${player.lastName}` : h.playerId;
      return `
        <div class="hof-card">
          <div class="hof-name">${playerNameLink(name, h.playerId)}</div>
          <div class="hof-meta">${h.tag} · inducted ${h.inductedYear} · score ${h.score.toFixed(0)}</div>
          <div class="hof-summary">${escapeHtml(h.summary)}</div>
        </div>`;
    })
    .join('');
  wrap.appendChild(list);
  host.appendChild(wrap);
};
