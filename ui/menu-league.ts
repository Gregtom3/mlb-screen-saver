import type { Team, TeamId } from '../world/types.js';
import {
  battingAvg, era, formatAvg, formatEra, formatIp, formatSigned, formatWhip,
  last10, ops, runDiff, sluggingPct, streak, whip, winPct,
} from '../stats/derived.js';
import { isQualifiedBatter, isQualifiedPitcher } from '../stats/qualifiers.js';
import { mvpRanking, cyYoungRanking, rookieRanking } from '../stats/awards.js';
import type { MenuContext } from './menu-shared.js';
import { emptyState } from './menu-shared.js';

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
  awardsRow.innerHTML =
    awardCol('MVP', mvp.slice(0, 5).map((c) => `<li data-player="${c.playerId}">
        <span class="aw-name">${c.player ? c.player.firstName + ' ' + c.player.lastName : c.playerId}</span>
        <span class="aw-score">${formatSigned(c.score, 2)}</span></li>`)) +
    awardCol('Cy Young', cy.slice(0, 5).map((c) => `<li data-player="${c.playerId}">
        <span class="aw-name">${c.player ? c.player.firstName + ' ' + c.player.lastName : c.playerId}</span>
        <span class="aw-score">${formatSigned(c.score, 2)}</span></li>`)) +
    awardCol('Rookie', rk.slice(0, 5).map((c) => `<li data-player="${c.playerId}">
        <span class="aw-name">${c.player ? c.player.firstName + ' ' + c.player.lastName : c.playerId}</span>
        <span class="aw-score">${formatSigned(c.score, 2)}</span></li>`));
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
      ${battingRows.map((b) => {
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
          </tr>`;
      }).join('')}
      </tbody>`;
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
      ${pitchingRows.map((p) => {
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
          </tr>`;
      }).join('')}
      </tbody>`;
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
