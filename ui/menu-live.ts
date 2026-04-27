import type { Team, TeamId } from '../world/types.js';
import { drawWPChart, drawWPSparkline } from './wp-chart.js';
import type { MenuContext } from './menu-shared.js';
import { emptyState } from './menu-shared.js';

export const renderLive = (
  host: HTMLElement,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  selectedGameId: string | undefined,
  onSelect: (gameId: string) => void,
): void => {
  const games = ctx.getLiveGames();
  if (games.length === 0) {
    host.appendChild(emptyState('No live games right now.'));
    return;
  }

  // Top: a grid of channels with score, inning, and a tiny WP curve.
  const grid = document.createElement('div');
  grid.className = 'live-grid';
  for (const g of games) {
    const home = teamById.get(g.homeTeamId);
    const away = teamById.get(g.awayTeamId);
    const tile = document.createElement('button');
    tile.className = 'live-tile';
    tile.dataset['game'] = g.gameId;
    tile.innerHTML = `
      <div class="lt-row">
        <span class="lt-stripe" style="background:${away?.colors.primary ?? '#333'}"></span>
        <span class="lt-name">${away ? away.abbr : ''}</span>
        <span class="lt-score">${g.score.away}</span>
      </div>
      <div class="lt-row">
        <span class="lt-stripe" style="background:${home?.colors.primary ?? '#333'}"></span>
        <span class="lt-name">${home ? home.abbr : ''}</span>
        <span class="lt-score">${g.score.home}</span>
      </div>
      <div class="lt-meta">${g.half === 'top' ? '▲' : '▼'} ${g.inning} · ${g.outs} out <span class="lt-tod ${g.isDay ? 'lt-tod--day' : 'lt-tod--night'}">${g.isDay ? 'DAY' : 'NIGHT'}</span></div>
    `;
    const spark = document.createElement('canvas');
    spark.width = 160;
    spark.height = 26;
    spark.className = 'lt-spark';
    tile.appendChild(spark);
    const sctx = spark.getContext('2d');
    if (sctx) {
      drawWPSparkline(
        sctx,
        g.wpTimeline,
        spark.width,
        spark.height,
        home?.colors.primary ?? '#f1c40f',
        away?.colors.primary ?? '#9aa0a6',
      );
    }
    tile.addEventListener('click', () => onSelect(g.gameId));
    if (g.gameId === selectedGameId) tile.classList.add('selected');
    grid.appendChild(tile);
  }
  host.appendChild(grid);

  // Bottom: detail of the selected game.
  const selected = games.find((g) => g.gameId === selectedGameId) ?? games[0];
  if (!selected) return;
  const detail = document.createElement('div');
  detail.className = 'live-detail';
  const homeTeam = teamById.get(selected.homeTeamId);
  const awayTeam = teamById.get(selected.awayTeamId);
  detail.innerHTML = `
    <h3>${awayTeam ? awayTeam.city + ' ' + awayTeam.nickname : 'Away'} @ ${homeTeam ? homeTeam.city + ' ' + homeTeam.nickname : 'Home'}</h3>
    <div class="menu-hint">Win probability through the latest play. Yellow dots = swings &gt; 10%.</div>
  `;
  const big = document.createElement('canvas');
  big.width = 720;
  big.height = 220;
  big.className = 'wp-canvas';
  detail.appendChild(big);
  const bctx = big.getContext('2d');
  if (bctx) {
    drawWPChart(bctx, selected.wpTimeline, {
      width: big.width,
      height: big.height,
      homeColor: homeTeam?.colors.primary ?? '#f1c40f',
      awayColor: awayTeam?.colors.primary ?? '#9aa0a6',
    });
  }

  // Biggest plays summary.
  if (selected.wpTimeline) {
    const big5 = [...selected.wpTimeline.samples]
      .filter((s) => s.note && Math.abs(s.delta) > 0.05)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);
    if (big5.length > 0) {
      const list = document.createElement('div');
      list.className = 'big-plays';
      list.innerHTML = '<h4>Biggest plays</h4>' +
        '<ul>' + big5.map((s) => {
          const sign = s.delta > 0 ? '+' : '';
          const pct = (s.delta * 100).toFixed(0);
          return `<li><span class="bp-inning">${s.inning}${s.half === 'top' ? '▲' : '▼'}</span> ${s.note} <span class="bp-delta">${sign}${pct}%</span></li>`;
        }).join('') + '</ul>';
      detail.appendChild(list);
    }
  }

  if (ctx.setLiveChannel) {
    const watchBtn = document.createElement('button');
    watchBtn.className = 'live-watch';
    watchBtn.textContent = '▶ watch this channel';
    watchBtn.addEventListener('click', () => ctx.setLiveChannel?.(selected.gameId));
    detail.appendChild(watchBtn);
  }

  host.appendChild(detail);
};
