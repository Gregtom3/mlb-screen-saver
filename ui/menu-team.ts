import type { Coach, Stadium, Team, TeamId } from '../world/types.js';
import {
  battingAvg, era, formatAvg, formatEra, formatIp, formatRecord,
  formatSigned, formatWhip, last10, ops, runDiff,
  streak, whip, winPct,
} from '../stats/derived.js';
import { computeMagicNumber } from '../projections/montecarlo.js';
import type { MenuContext } from './menu-shared.js';
import { emptyState } from './menu-shared.js';
import { coachPortraitDataUrl } from './portrait.js';
import { starRating, starsToGlyphs } from '../stats/grades.js';

export const renderTeam = (
  host: HTMLElement,
  team: Team,
  stadium: Stadium | undefined,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  onPlayerClick: (id: string) => void,
): void => {
  const agg = ctx.getAggregates();
  const line = agg.teams.get(team.id);
  const wrap = document.createElement('div');
  wrap.className = 'team-view';

  // ----- Header -----
  const header = document.createElement('div');
  header.className = 'team-header';
  const s = line ? streak(line) : null;
  const l10 = line ? last10(line) : { wins: 0, losses: 0 };
  header.innerHTML = `
    <div class="team-banner" style="background:${team.colors.primary}; border-color:${team.colors.secondary}">
      <div class="team-mascot">${team.mascot}</div>
    </div>
    <div class="team-bio">
      <h2>${team.city} ${team.nickname}</h2>
      <div class="team-line">${team.conference} · ${team.division} · ${stadium ? stadium.name : ''}</div>
      <div class="team-meta">
        ${line ? formatRecord(line) : '0-0'} ·
        PCT ${line ? formatAvg(winPct(line)) : '.000'} ·
        L10 ${l10.wins}-${l10.losses} ·
        Streak ${s ? s.kind + s.n : '—'} ·
        RD ${line ? formatSigned(runDiff(line)) : '+0'}
      </div>
    </div>
  `;
  wrap.appendChild(header);

  // ----- Tabs -----
  const tabs = document.createElement('div');
  tabs.className = 'team-tabs';
  tabs.innerHTML = `
    <button data-tab="roster" class="active">Roster</button>
    <button data-tab="schedule">Schedule</button>
    <button data-tab="stats">Stats</button>
    <button data-tab="projections">Projections</button>
    <button data-tab="stadium">Stadium</button>
    <button data-tab="staff">Staff</button>
  `;
  wrap.appendChild(tabs);
  const body = document.createElement('div');
  body.className = 'team-tab-body';
  wrap.appendChild(body);

  const renderTab = (tab: string) => {
    body.innerHTML = '';
    if (tab === 'roster') renderRoster(body, team, ctx, onPlayerClick);
    else if (tab === 'schedule') renderSchedule(body, team, ctx, teamById);
    else if (tab === 'stats') renderTeamStats(body, team, ctx);
    else if (tab === 'projections') renderProjections(body, team, ctx);
    else if (tab === 'stadium') renderStadium(body, stadium);
    else if (tab === 'staff') renderStaff(body, team);
  };
  tabs.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.dataset['tab']!);
    });
  });
  renderTab('roster');

  host.appendChild(wrap);
};

const renderRoster = (
  host: HTMLElement,
  team: Team,
  ctx: MenuContext,
  onPlayerClick: (id: string) => void,
): void => {
  const agg = ctx.getAggregates();
  const roster = [...ctx.playerIndex.values()].filter((p) => p.teamId === team.id && !p.inMinors);
  const groups: Record<string, typeof roster> = { P: [], C: [], INF: [], OF: [], DH: [] };
  for (const p of roster) {
    const pos = p.primaryPosition;
    if (pos === 'P') groups.P!.push(p);
    else if (pos === 'C') groups.C!.push(p);
    else if (pos === '1B' || pos === '2B' || pos === '3B' || pos === 'SS') groups.INF!.push(p);
    else if (pos === 'LF' || pos === 'CF' || pos === 'RF') groups.OF!.push(p);
    else if (pos === 'DH') groups.DH!.push(p);
  }
  for (const [group, list] of Object.entries(groups)) {
    if (list.length === 0) continue;
    const h = document.createElement('h3');
    h.textContent = group === 'INF' ? 'Infielders' : group === 'OF' ? 'Outfielders' : group;
    host.appendChild(h);
    const table = document.createElement('table');
    const isPitcher = group === 'P';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th><th>Pos</th><th>B/T</th><th>Age</th>
          ${isPitcher
            ? '<th>G</th><th>GS</th><th>IP</th><th>ERA</th><th>WHIP</th><th>SO</th>'
            : '<th>G</th><th>PA</th><th>H</th><th>HR</th><th>AVG</th><th>OPS</th>'}
        </tr>
      </thead>
      <tbody>
      ${list.sort((a, b) => a.lastName.localeCompare(b.lastName)).map((p) => {
        const age = (ctx.getCalendarYear?.() ?? 2026) - p.birthYear;
        if (isPitcher) {
          const pl = agg.pitching.get(p.id);
          return `<tr data-player="${p.id}" class="clickable">
            <td>${p.firstName} ${p.lastName}</td><td>${p.primaryPosition}</td><td>${p.bats}/${p.throws}</td><td>${age}</td>
            <td>${pl?.G ?? 0}</td><td>${pl?.GS ?? 0}</td>
            <td>${pl ? formatIp(pl) : '0.0'}</td>
            <td>${pl ? formatEra(era(pl)) : '—'}</td>
            <td>${pl ? formatWhip(whip(pl)) : '—'}</td>
            <td>${pl?.SO ?? 0}</td>
          </tr>`;
        }
        const bl = agg.batting.get(p.id);
        return `<tr data-player="${p.id}" class="clickable">
          <td>${p.firstName} ${p.lastName}</td><td>${p.primaryPosition}</td><td>${p.bats}/${p.throws}</td><td>${age}</td>
          <td>${bl?.G ?? 0}</td><td>${bl?.PA ?? 0}</td><td>${bl?.H ?? 0}</td><td>${bl?.HR ?? 0}</td>
          <td>${bl ? formatAvg(battingAvg(bl)) : '—'}</td>
          <td>${bl ? formatAvg(ops(bl)) : '—'}</td>
        </tr>`;
      }).join('')}
      </tbody>`;
    table.querySelectorAll<HTMLTableRowElement>('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = tr.dataset['player'];
        if (id) onPlayerClick(id);
      });
    });
    host.appendChild(table);
  }
};

const renderSchedule = (
  host: HTMLElement,
  team: Team,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
): void => {
  const games = ctx.schedule.entries.filter(
    (e) => e.homeTeamId === team.id || e.awayTeamId === team.id,
  );
  const playedDays = ctx.getTeamGamesPlayed();
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr><th>Day</th><th>Home/Away</th><th>Opponent</th><th>Status</th></tr>
    </thead>
    <tbody>
    ${games.map((g) => {
      const isHome = g.homeTeamId === team.id;
      const opp = teamById.get(isHome ? g.awayTeamId : g.homeTeamId);
      const played = g.day <= playedDays;
      return `<tr ${played ? 'class="dim"' : ''}>
        <td>${g.day}</td>
        <td>${isHome ? 'vs' : '@'}</td>
        <td>${opp ? opp.city + ' ' + opp.nickname : '?'}</td>
        <td>${played ? 'final' : 'scheduled'}</td>
      </tr>`;
    }).join('')}
    </tbody>`;
  host.appendChild(table);
};

const renderTeamStats = (host: HTMLElement, team: Team, ctx: MenuContext): void => {
  const agg = ctx.getAggregates();
  const line = agg.teams.get(team.id);
  if (!line) {
    host.appendChild(emptyState('No team stats yet.'));
    return;
  }
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>Metric</th><th>Value</th><th>League rank</th></tr></thead>
    <tbody>
      <tr><td>Record</td><td>${formatRecord(line)}</td><td>—</td></tr>
      <tr><td>Win pct</td><td>${formatAvg(winPct(line))}</td><td>${rankFor(ctx, team.id, (l) => winPct(l), 'desc')}</td></tr>
      <tr><td>Runs scored</td><td>${line.RS}</td><td>${rankFor(ctx, team.id, (l) => l.RS, 'desc')}</td></tr>
      <tr><td>Runs allowed</td><td>${line.RA}</td><td>${rankFor(ctx, team.id, (l) => l.RA, 'asc')}</td></tr>
      <tr><td>Run diff</td><td>${formatSigned(runDiff(line))}</td><td>${rankFor(ctx, team.id, (l) => runDiff(l), 'desc')}</td></tr>
      <tr><td>Home</td><td>${line.homeW}-${line.homeL}</td><td>—</td></tr>
      <tr><td>Away</td><td>${line.awayW}-${line.awayL}</td><td>—</td></tr>
      <tr><td>Division</td><td>${line.divW}-${line.divL}</td><td>—</td></tr>
    </tbody>`;
  host.appendChild(table);
};

const rankFor = (
  ctx: MenuContext,
  teamId: TeamId,
  metric: (l: NonNullable<ReturnType<MenuContext['getAggregates']>['teams'] extends Map<TeamId, infer V> ? V : never>) => number,
  dir: 'asc' | 'desc',
): string => {
  const agg = ctx.getAggregates();
  const lines = [...agg.teams.values()];
  lines.sort((a, b) => (dir === 'desc' ? metric(b) - metric(a) : metric(a) - metric(b)));
  const idx = lines.findIndex((l) => l.teamId === teamId);
  return idx >= 0 ? `#${idx + 1}` : '—';
};

const renderProjections = (host: HTMLElement, team: Team, ctx: MenuContext): void => {
  const proj = ctx.getProjections();
  const tp = proj.teams.get(team.id);
  if (!tp) { host.appendChild(emptyState('No projections yet.')); return; }
  const divisionRivals = [...proj.teams.values()].filter((t) => {
    const rival = ctx.teams.find((ct) => ct.id === t.teamId);
    return rival && rival.division === team.division && rival.conference === team.conference;
  });
  const totalGames = ctx.schedule.totalDays; // ~150 games per team
  const { magic, elimination } = computeMagicNumber(tp, divisionRivals, totalGames);
  const table = document.createElement('table');
  const fmtPct = (n: number) => (n * 100).toFixed(1) + '%';
  table.innerHTML = `
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Pythagorean</td><td>${formatAvg(tp.pythagoreanWinPct)}</td></tr>
      <tr><td>Projected wins (5/50/95)</td><td>${tp.winsP05} / ${tp.winsP50} / ${tp.winsP95}</td></tr>
      <tr><td>P(make playoffs)</td><td>${fmtPct(tp.pPlayoffs)}</td></tr>
      <tr><td>P(win division)</td><td>${fmtPct(tp.pDivision)}</td></tr>
      <tr><td>P(top seed)</td><td>${fmtPct(tp.pTopSeed)}</td></tr>
      <tr><td>P(win conference)</td><td>${fmtPct(tp.pConference)}</td></tr>
      <tr><td>P(championship)</td><td>${fmtPct(tp.pTitle)}</td></tr>
      <tr><td>Strength of remaining schedule</td><td>${formatAvg(tp.sosRemaining)}</td></tr>
      <tr><td>Magic / elimination</td><td>${magic ?? '—'} / ${elimination ?? '—'}</td></tr>
    </tbody>`;
  host.appendChild(table);
  const note = document.createElement('div');
  note.className = 'menu-hint';
  note.textContent = `Based on ${proj.simulations} Monte Carlo sims (Pythagorean + log5).`;
  host.appendChild(note);
};

const renderStadium = (host: HTMLElement, stadium: Stadium | undefined): void => {
  if (!stadium) {
    host.appendChild(emptyState('Stadium data unavailable.'));
    return;
  }
  const dim = stadium.dimensions;
  const quirk = stadium.quirk;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h3>${stadium.name}</h3>
    <table>
      <tbody>
        <tr><td>Left field</td><td>${dim.leftFt} ft</td></tr>
        <tr><td>Left-center</td><td>${dim.leftCenterFt} ft</td></tr>
        <tr><td>Center field</td><td>${dim.centerFt} ft</td></tr>
        <tr><td>Right-center</td><td>${dim.rightCenterFt} ft</td></tr>
        <tr><td>Right field</td><td>${dim.rightFt} ft</td></tr>
        <tr><td>Wall height</td><td>${dim.wallHeightFt} ft</td></tr>
        <tr><td>Foul territory</td><td>${dim.foulTerritoryRating}/10</td></tr>
        <tr><td>Quirk</td><td>${quirkLabel(quirk)}</td></tr>
        <tr><td>Grass pattern</td><td>${stadium.atmosphere.grassPattern}</td></tr>
      </tbody>
    </table>
  `;
  host.appendChild(wrap);
  const note = document.createElement('div');
  note.className = 'menu-hint';
  note.textContent = 'Park factors land with multi-season history (Phase 6).';
  host.appendChild(note);
};

// Per-role label and the subset of CoachRatings to show.
const COACH_ROLE_META: Record<Coach['role'], {
  title: string;
  ratings: { key: keyof Coach['ratings']; label: string; desc: string }[];
}> = {
  head: {
    title: 'Manager',
    ratings: [
      { key: 'tactics',  label: 'Tactics',  desc: 'Shifts infield coverage toward pull hitters' },
      { key: 'morale',   label: 'Morale',   desc: 'Team-wide leadership & clubhouse cohesion (Phase 6+)' },
    ],
  },
  'third-base': {
    title: '3B Coach',
    ratings: [
      { key: 'aggression', label: 'Aggression', desc: 'Willingness to send runners home from second' },
      { key: 'judgment',   label: 'Judgment',   desc: 'Avoids unnecessary outs on the basepaths' },
    ],
  },
  'first-base': {
    title: '1B Coach',
    ratings: [
      { key: 'baserunningCoaching', label: 'Baserunning',      desc: 'Stolen-base technique boost (active when steals ship)' },
      { key: 'pickoffAwareness',    label: 'Pickoff Awareness', desc: 'Reduces pickoff vulnerability (active when pickoffs ship)' },
    ],
  },
};

const renderStaff = (host: HTMLElement, team: Team): void => {
  const { head, firstBase, thirdBase } = team.coachingStaff;
  const coaches: Coach[] = [head, thirdBase, firstBase];

  const list = document.createElement('div');
  list.className = 'staff-list';

  for (const coach of coaches) {
    const meta = COACH_ROLE_META[coach.role];
    const card = document.createElement('div');
    card.className = 'staff-card';

    // Portrait.
    const img = document.createElement('img');
    img.src = coachPortraitDataUrl(coach, team, 64);
    img.width = 64;
    img.height = 64;
    img.className = 'player-portrait-canvas';
    img.alt = `${coach.firstName} ${coach.lastName}`;
    card.appendChild(img);

    // Bio + ratings.
    const bio = document.createElement('div');
    bio.className = 'staff-bio';
    bio.innerHTML = `
      <h3>${coach.firstName} ${coach.lastName}</h3>
      <div class="staff-role">${meta.title}</div>
    `;

    const ratingList = document.createElement('div');
    ratingList.className = 'attr-list';
    for (const r of meta.ratings) {
      const value = coach.ratings[r.key];
      const grade = starRating(value);
      const row = document.createElement('div');
      row.className = 'attr-row';
      row.innerHTML = `
        <div class="attr-row-header">
          <span class="attr-name">${r.label}</span>
          <span class="attr-stars attr-${grade.bucket}">${starsToGlyphs(grade.stars)}</span>
          <span class="attr-label">${grade.label} (${value})</span>
        </div>
        <div class="attr-desc">${r.desc}</div>
      `;
      ratingList.appendChild(row);
    }
    bio.appendChild(ratingList);
    card.appendChild(bio);
    list.appendChild(card);
  }

  host.appendChild(list);
};

const quirkLabel = (quirk: { kind: string }): string => {
  switch (quirk.kind) {
    case 'short-porch': {
      const q = quirk as { kind: 'short-porch'; side: string; distanceFt: number };
      return `Short porch (${q.side}, ${q.distanceFt} ft)`;
    }
    case 'deep-center': {
      const q = quirk as { kind: 'deep-center'; distanceFt: number };
      return `Deep center (${q.distanceFt} ft)`;
    }
    case 'altitude-thin-air': {
      const q = quirk as { kind: 'altitude-thin-air'; elevationFt: number };
      return `Altitude (${q.elevationFt} ft)`;
    }
    case 'wind-tunnel': {
      const q = quirk as { kind: 'wind-tunnel'; direction: string };
      return `Wind tunnel (${q.direction})`;
    }
    default:
      return quirk.kind;
  }
};
