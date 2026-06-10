import type { Player, PlayerId, PlayerRatings, Team, TeamId } from '../world/types.js';
import type { BattingLine, BattingSplitKey, PitchingLine, PitchingSplitKey } from '../stats/types.js';
import {
  battingAvg, era, formatAvg, formatEra, formatIp, formatSigned,
  formatWhip, ops, sluggingPct, whip,
} from '../stats/derived.js';
import { groupsForPlayer, RATING_EFFECTS, RATING_QUANTIFIED, starRating, starsToGlyphs } from '../stats/grades.js';
import { battingHotCold, pitchingHotCold } from '../stats/hot-cold.js';
import { drawPortrait } from './portrait.js';
import { drawSprayChart } from './spray-chart.js';
import type { MenuContext } from './menu-shared.js';
import { emptyState, escapeHtml, playerNameLink } from './menu-shared.js';

const SPLIT_BATTING: readonly { key: BattingSplitKey | 'season'; label: string }[] = [
  { key: 'season', label: 'Season' },
  { key: 'vsLHP', label: 'vs LHP' },
  { key: 'vsRHP', label: 'vs RHP' },
  { key: 'home', label: 'Home' },
  { key: 'away', label: 'Away' },
  { key: 'RISP', label: 'RISP' },
  { key: 'risp2Out', label: 'RISP, 2 out' },
  { key: 'lateAndClose', label: 'Late & close' },
];

const SPLIT_PITCHING: readonly { key: PitchingSplitKey | 'season'; label: string }[] = [
  { key: 'season', label: 'Season' },
  { key: 'vsLHB', label: 'vs LHB' },
  { key: 'vsRHB', label: 'vs RHB' },
  { key: 'home', label: 'Home' },
  { key: 'away', label: 'Away' },
  { key: 'lateAndClose', label: 'Late & close' },
];

export const renderPlayer = (
  host: HTMLElement,
  player: Player,
  ctx: MenuContext,
  teamById: ReadonlyMap<TeamId, Team>,
  onPlayerClick: (id: PlayerId) => void,
): void => {
  void onPlayerClick;
  const agg = ctx.getAggregates();
  const team = player.teamId ? teamById.get(player.teamId) : undefined;
  const wrap = document.createElement('div');
  wrap.className = 'player-view';

  // ----- Header with procedural portrait -----
  const header = document.createElement('div');
  header.className = 'player-header';
  const portraitCanvas = document.createElement('canvas');
  portraitCanvas.width = 64;
  portraitCanvas.height = 64;
  portraitCanvas.className = 'player-portrait-canvas';
  const portraitCtx = portraitCanvas.getContext('2d');
  if (portraitCtx) drawPortrait(portraitCtx, player, team, 64);
  header.appendChild(portraitCanvas);

  const bio = document.createElement('div');
  bio.className = 'player-bio';
  const age = (ctx.getCalendarYear?.() ?? 2026) - player.birthYear;
  const b = agg.batting.get(player.id);
  const p = agg.pitching.get(player.id);
  const hc = b ? battingHotCold(b) : null;
  const hcPitch = p ? pitchingHotCold(p) : null;
  const heat = hc?.level ?? hcPitch?.level ?? 'neutral';
  const heatTag = heat === 'hot' || heat === 'warm' ? `<span class="heat heat-hot">${heat}</span>`
    : heat === 'cold' || heat === 'cool' ? `<span class="heat heat-cold">${heat}</span>` : '';
  bio.innerHTML = `
    <h2>${player.firstName} ${player.lastName} ${heatTag}</h2>
    <div class="player-line">${player.primaryPosition} · ${player.bats}/${player.throws} · age ${age} · ${team ? team.city + ' ' + team.nickname : 'free agent'}</div>
    <div class="player-meta">b. ${player.birthYear} · ${player.hometown}</div>
    ${player.personality.length ? `<div class="player-tags">${player.personality.map((t) => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
  `;
  header.appendChild(bio);
  wrap.appendChild(header);

  // ----- Attribute panel -----
  renderAttributePanel(wrap, player);

  // ----- Season + splits -----
  const isPitcher = player.primaryPosition === 'P';
  if (b && b.PA > 0) renderBatting(wrap, b);
  if (p && p.BF > 0) renderPitching(wrap, p);
  if ((!b || b.PA === 0) && (!p || p.BF === 0)) {
    wrap.appendChild(emptyState('No completed-game stats for this player yet.'));
  }

  // ----- Spray chart (batters only with at least one batted ball) -----
  if (!isPitcher && b && b.hitChart.length > 0) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3>Spray chart (${b.hitChart.length} batted balls)</h3>`;
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 280;
    canvas.className = 'spray-canvas';
    const cctx = canvas.getContext('2d');
    if (cctx) drawSprayChart(cctx, b.hitChart, canvas.width, canvas.height);
    sec.appendChild(canvas);
    wrap.appendChild(sec);
  }

  // ----- Pitcher heat map (gated on sample size) -----
  if (isPitcher && p) renderPitcherHeatMap(wrap, p);

  // ----- Batter xBA-by-zone (gated on sample size) -----
  if (!isPitcher && b) renderBatterZoneTable(wrap, b);

  // ----- Game log -----
  if (b && b.gameLog.length > 0) renderGameLogBatting(wrap, b, teamById, ctx, player);
  if (p && p.gameLog.length > 0) renderGameLogPitching(wrap, p, teamById, ctx, player);

  // Career — Phase 6.
  renderCareer(wrap, player, ctx);

  host.appendChild(wrap);
};

const renderCareer = (host: HTMLElement, player: Player, ctx: MenuContext): void => {
  const history = ctx.getHistory?.();
  const sec = document.createElement('section');
  sec.innerHTML = '<h3>Career</h3>';
  if (!history || history.seasons.length === 0) {
    sec.appendChild(emptyState('No prior seasons in this league yet (Phase 6 needs ?priorSeasons=N).'));
    host.appendChild(sec);
    return;
  }
  const cb = history.careerBatting.get(player.id);
  const cp = history.careerPitching.get(player.id);
  if (!cb && !cp) {
    sec.appendChild(emptyState('No career stats accumulated yet for this player.'));
    host.appendChild(sec);
    return;
  }
  if (cb && cb.PA > 0) {
    const tbl = document.createElement('table');
    tbl.innerHTML = `
      <thead><tr>
        <th>Year</th><th>G</th><th>PA</th><th>AB</th><th>H</th>
        <th>2B</th><th>3B</th><th>HR</th><th>RBI</th>
        <th>BB</th><th>SO</th><th>AVG</th><th>OPS</th>
      </tr></thead>
      <tbody>
      ${Object.keys(cb.byYear).sort().map((yk) => {
        const y = parseInt(yk, 10);
        const line = cb.byYear[y]!;
        return `<tr>
          <td>${y}</td>
          <td>${line.G}</td><td>${line.PA}</td><td>${line.AB}</td><td>${line.H}</td>
          <td>${line.doubles}</td><td>${line.triples}</td><td>${line.HR}</td><td>${line.RBI}</td>
          <td>${line.BB}</td><td>${line.SO}</td>
          <td>${formatAvg(battingAvg(line))}</td>
          <td>${formatAvg(ops(line))}</td>
        </tr>`;
      }).join('')}
        <tr class="career-total">
          <td>Career</td>
          <td>${cb.G}</td><td>${cb.PA}</td><td>${cb.AB}</td><td>${cb.H}</td>
          <td>${cb.doubles}</td><td>${cb.triples}</td><td>${cb.HR}</td><td>${cb.RBI}</td>
          <td>${cb.BB}</td><td>${cb.SO}</td>
          <td>${formatAvg(cb.AB > 0 ? cb.H / cb.AB : 0)}</td>
          <td>—</td>
        </tr>
      </tbody>`;
    sec.appendChild(tbl);
  }
  if (cp && cp.BF > 0) {
    const tbl = document.createElement('table');
    tbl.innerHTML = `
      <thead><tr>
        <th>Year</th><th>G</th><th>GS</th><th>W</th><th>L</th>
        <th>IP</th><th>H</th><th>ER</th><th>BB</th><th>SO</th>
        <th>HR</th><th>ERA</th><th>WHIP</th>
      </tr></thead>
      <tbody>
      ${Object.keys(cp.byYear).sort().map((yk) => {
        const y = parseInt(yk, 10);
        const line = cp.byYear[y]!;
        return `<tr>
          <td>${y}</td>
          <td>${line.G}</td><td>${line.GS}</td><td>${line.W}</td><td>${line.L}</td>
          <td>${formatIp(line)}</td>
          <td>${line.H}</td><td>${line.ER}</td><td>${line.BB}</td><td>${line.SO}</td>
          <td>${line.HR}</td>
          <td>${formatEra(era(line))}</td>
          <td>${formatWhip(whip(line))}</td>
        </tr>`;
      }).join('')}
        <tr class="career-total">
          <td>Career</td>
          <td>${cp.G}</td><td>${cp.GS}</td><td>${cp.W}</td><td>${cp.L}</td>
          <td>${(cp.IPouts / 3).toFixed(1)}</td>
          <td>${cp.H}</td><td>${cp.ER}</td><td>${cp.BB}</td><td>${cp.SO}</td>
          <td>${cp.HR}</td>
          <td>${formatEra(cp.IPouts > 0 ? (cp.ER * 27) / cp.IPouts : 0)}</td>
          <td>${formatWhip(cp.IPouts > 0 ? ((cp.BB + cp.H) * 3) / cp.IPouts : 0)}</td>
        </tr>
      </tbody>`;
    sec.appendChild(tbl);
  }
  host.appendChild(sec);
};

const renderAttributePanel = (host: HTMLElement, player: Player): void => {
  const sec = document.createElement('section');
  sec.innerHTML = '<h3>Attributes</h3>';
  const groups = groupsForPlayer(player);
  for (const g of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'attr-group';
    groupEl.innerHTML = `<h4>${g.title}</h4>`;
    const list = document.createElement('div');
    list.className = 'attr-list';
    for (const key of g.keys) {
      const k = key as keyof PlayerRatings;
      const value = player.ratings[k];
      const grade = starRating(value);
      const desc = RATING_EFFECTS[k] ?? '';
      const quant = RATING_QUANTIFIED[k] ?? '';
      const row = document.createElement('div');
      row.className = 'attr-row';
      row.innerHTML = `
        <div class="attr-row-header">
          <span class="attr-name">${prettyName(k)}</span>
          <span class="attr-stars attr-${grade.bucket}">${starsToGlyphs(grade.stars)}</span>
          <span class="attr-label">${grade.label}</span>
        </div>
        <div class="attr-desc">${desc}</div>
        <div class="attr-quant">${quant}</div>`;
      list.appendChild(row);
    }
    groupEl.appendChild(list);
    sec.appendChild(groupEl);
  }
  host.appendChild(sec);
};

const PRETTY_NAMES: Record<keyof PlayerRatings, string> = {
  contact: 'Contact', power: 'Power', discipline: 'Discipline',
  pitchRecognition: 'Pitch recognition', bunting: 'Bunting',
  platoonBias: 'Platoon split', clutch: 'Clutch',
  velocity: 'Velocity', control: 'Control', command: 'Command',
  stamina: 'Stamina', breakingBall: 'Breaking ball', changeup: 'Changeup',
  holdRunners: 'Hold runners', groundballTendency: 'GB tendency',
  range: 'Range', glove: 'Glove', armStrength: 'Arm strength',
  armAccuracy: 'Arm accuracy', transferSpeed: 'Transfer', framing: 'Framing',
  blocking: 'Blocking', popTime: 'Pop time',
  speed: 'Speed', stealing: 'Stealing', baserunningIQ: 'Baserunning IQ',
  composure: 'Composure', consistency: 'Consistency', durability: 'Durability',
  workEthic: 'Work ethic', coachability: 'Coachability',
};

const prettyName = (k: keyof PlayerRatings): string => PRETTY_NAMES[k];

const renderBatting = (host: HTMLElement, b: BattingLine): void => {
  const sec = document.createElement('section');
  sec.innerHTML = `<h3>Season batting</h3>`;
  const select = document.createElement('select');
  select.className = 'split-select';
  select.innerHTML = SPLIT_BATTING.map(
    (s) => `<option value="${s.key}">${s.label}</option>`,
  ).join('');
  sec.appendChild(select);
  const tableHost = document.createElement('div');
  sec.appendChild(tableHost);
  const renderTable = (selected: BattingSplitKey | 'season') => {
    const line = selected === 'season' ? b : b.splits[selected];
    if (!line) {
      tableHost.innerHTML = '';
      tableHost.appendChild(emptyState('No data for this split.'));
      return;
    }
    tableHost.innerHTML = `
      <table>
        <thead><tr>
          <th>G</th><th>PA</th><th>AB</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>RBI</th>
          <th>BB</th><th>SO</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th><th>WPA</th>
        </tr></thead>
        <tbody><tr>
          <td>${line.G}</td><td>${line.PA}</td><td>${line.AB}</td><td>${line.H}</td>
          <td>${line.doubles}</td><td>${line.triples}</td><td>${line.HR}</td><td>${line.RBI}</td>
          <td>${line.BB}</td><td>${line.SO}</td>
          <td>${formatAvg(battingAvg(line))}</td>
          <td>${formatAvg((line.H + line.BB + line.HBP) / Math.max(1, line.AB + line.BB + line.HBP + line.SF))}</td>
          <td>${formatAvg(sluggingPct(line))}</td>
          <td>${formatAvg(ops(line))}</td>
          <td>${formatSigned(line.WPA, 2)}</td>
        </tr></tbody>
      </table>`;
  };
  select.addEventListener('change', () => renderTable(select.value as BattingSplitKey | 'season'));
  renderTable('season');
  host.appendChild(sec);

  // By-month rows (always visible — small table).
  const monthKeys = Object.keys(b.byMonth).sort();
  if (monthKeys.length > 1) {
    const monthSec = document.createElement('section');
    monthSec.innerHTML = '<h3>By month</h3>';
    const tbl = document.createElement('table');
    tbl.innerHTML = `
      <thead><tr><th>Month</th><th>PA</th><th>AVG</th><th>OPS</th><th>HR</th><th>WPA</th></tr></thead>
      <tbody>
      ${monthKeys.map((m) => {
        const ml = b.byMonth[m]!;
        return `<tr>
          <td>${m}</td><td>${ml.PA}</td>
          <td>${formatAvg(battingAvg(ml))}</td>
          <td>${formatAvg(ops(ml))}</td>
          <td>${ml.HR}</td>
          <td>${formatSigned(ml.WPA, 2)}</td>
        </tr>`;
      }).join('')}
      </tbody>`;
    monthSec.appendChild(tbl);
    host.appendChild(monthSec);
  }
};

const renderPitching = (host: HTMLElement, p: PitchingLine): void => {
  const sec = document.createElement('section');
  sec.innerHTML = `<h3>Season pitching</h3>`;
  const select = document.createElement('select');
  select.className = 'split-select';
  select.innerHTML = SPLIT_PITCHING.map(
    (s) => `<option value="${s.key}">${s.label}</option>`,
  ).join('');
  sec.appendChild(select);
  const tableHost = document.createElement('div');
  sec.appendChild(tableHost);
  const renderTable = (selected: PitchingSplitKey | 'season') => {
    const line = selected === 'season' ? p : p.splits[selected];
    if (!line) {
      tableHost.innerHTML = '';
      tableHost.appendChild(emptyState('No data for this split.'));
      return;
    }
    tableHost.innerHTML = `
      <table>
        <thead><tr>
          <th>G</th><th>GS</th><th>BF</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>HR</th>
          <th>ERA</th><th>WHIP</th><th>WPA</th>
        </tr></thead>
        <tbody><tr>
          <td>${line.G}</td><td>${line.GS}</td><td>${line.BF}</td><td>${formatIp(line)}</td>
          <td>${line.H}</td><td>${line.R}</td><td>${line.ER}</td>
          <td>${line.BB}</td><td>${line.SO}</td><td>${line.HR}</td>
          <td>${formatEra(era(line))}</td>
          <td>${formatWhip(whip(line))}</td>
          <td>${formatSigned(line.WPA, 2)}</td>
        </tr></tbody>
      </table>`;
  };
  select.addEventListener('change', () => renderTable(select.value as PitchingSplitKey | 'season'));
  renderTable('season');
  host.appendChild(sec);
};

// Minimum pitches before the heat map unlocks. Below this, the field is
// too noisy to read — match the screensaver vibe of "stats appear as the
// season fills in" by hiding the panel rather than drawing garbage.
const HEAT_MAP_MIN_PITCHES = 50;
// Per-zone xBA needs more samples to trust an individual cell, so we
// require a separate threshold on the cell itself before rendering its
// xBA. Cells below the floor render a placeholder dot.
const ZONE_AB_FLOOR = 4;

const renderPitcherHeatMap = (host: HTMLElement, p: PitchingLine): void => {
  const totalPitches = p.pitchesByZone.reduce((s, n) => s + n, 0);
  const sec = document.createElement('section');
  sec.innerHTML = '<h3>Pitch location heat map</h3>';
  if (totalPitches < HEAT_MAP_MIN_PITCHES) {
    sec.appendChild(
      emptyState(
        `Heat map unlocks once this pitcher has thrown ${HEAT_MAP_MIN_PITCHES} pitches (currently ${totalPitches}).`,
      ),
    );
    host.appendChild(sec);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 220;
  canvas.height = 240;
  canvas.className = 'heat-map-canvas';
  const cctx = canvas.getContext('2d');
  if (cctx) drawZoneHeatMap(cctx, p.pitchesByZone, canvas.width, canvas.height);
  sec.appendChild(canvas);
  // Caption with total pitches + outside-zone share.
  const inZone = p.pitchesByZone.slice(1, 10).reduce((s, n) => s + n, 0);
  const outside = p.pitchesByZone[0] ?? 0;
  const inZonePct = totalPitches > 0 ? Math.round((inZone / totalPitches) * 100) : 0;
  const cap = document.createElement('div');
  cap.className = 'menu-hint';
  cap.textContent = `${totalPitches} pitches · ${inZonePct}% in zone · ${outside} chase pitches`;
  sec.appendChild(cap);
  host.appendChild(sec);
};

const renderBatterZoneTable = (host: HTMLElement, b: BattingLine): void => {
  const totalAB = b.zone.slice(1, 10).reduce((s, c) => s + c.AB, 0);
  if (totalAB < ZONE_AB_FLOOR) return; // panel just stays hidden until data arrives
  const sec = document.createElement('section');
  sec.innerHTML = '<h3>xBA by zone</h3>';
  // Use a 3×3 grid of cells, each showing AVG when AB ≥ floor, else a dash.
  const grid = document.createElement('div');
  grid.className = 'zone-grid';
  for (let i = 1; i <= 9; i++) {
    const cell = b.zone[i];
    const cellEl = document.createElement('div');
    cellEl.className = 'zone-cell';
    if (!cell || cell.AB < ZONE_AB_FLOOR) {
      cellEl.innerHTML = `<div class="zone-cell-avg dim">—</div><div class="zone-cell-ab">${cell?.AB ?? 0} AB</div>`;
    } else {
      const avg = cell.H / cell.AB;
      cellEl.innerHTML = `<div class="zone-cell-avg">${formatAvg(avg)}</div><div class="zone-cell-ab">${cell.AB} AB · ${cell.HR} HR</div>`;
      // Tint: green for hot, red for cold, around .250 league mean.
      const tint = Math.max(-1, Math.min(1, (avg - 0.25) / 0.15));
      const r = tint < 0 ? 226 : Math.round(92 - tint * 30);
      const g = tint > 0 ? 180 : Math.round(94 + tint * 30);
      const blue = 90;
      cellEl.style.background = `rgba(${r}, ${g}, ${blue}, ${0.18 + Math.abs(tint) * 0.32})`;
    }
    grid.appendChild(cellEl);
  }
  sec.appendChild(grid);
  const hint = document.createElement('div');
  hint.className = 'menu-hint';
  hint.textContent = `Zones with fewer than ${ZONE_AB_FLOOR} AB are hidden; check back later in the season.`;
  sec.appendChild(hint);
  host.appendChild(sec);
};

const drawZoneHeatMap = (
  ctx: CanvasRenderingContext2D,
  pitchesByZone: readonly number[],
  w: number,
  h: number,
): void => {
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(0, 0, w, h);

  const inZoneTotal = pitchesByZone.slice(1, 10).reduce((s, n) => s + n, 0);
  // The zone box gets ~70% of the canvas; we leave a margin around it so
  // chase pitches (zone 0) can render as a peripheral halo.
  const boxW = Math.round(w * 0.62);
  const boxH = Math.round(h * 0.7);
  const bx = Math.round((w - boxW) / 2);
  const by = Math.round((h - boxH) / 2) - 6;

  // Out-of-zone halo: tint the margin around the box by chase-pitch share.
  const outShare = inZoneTotal > 0 ? (pitchesByZone[0] ?? 0) / inZoneTotal : 0;
  ctx.fillStyle = `rgba(140, 100, 60, ${Math.min(0.6, outShare * 0.7)})`;
  ctx.fillRect(0, 0, w, by);
  ctx.fillRect(0, by + boxH, w, h - (by + boxH));
  ctx.fillRect(0, by, bx, boxH);
  ctx.fillRect(bx + boxW, by, w - (bx + boxW), boxH);

  // 3×3 cells, color-coded by per-cell share of in-zone pitches.
  const cellW = boxW / 3;
  const cellH = boxH / 3;
  for (let i = 1; i <= 9; i++) {
    const idx = i - 1;
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const count = pitchesByZone[i] ?? 0;
    const share = inZoneTotal > 0 ? count / inZoneTotal : 0;
    // Map share to color: low = cool blue, high = hot orange. Range
    // anchored to 1/9 = 0.111 so neutral cells read neutral.
    const norm = Math.max(0, Math.min(1, (share - 1 / 9) * 3 + 0.5));
    const r = Math.round(40 + norm * 200);
    const g = Math.round(60 + norm * 80);
    const blue = Math.round(140 - norm * 100);
    ctx.fillStyle = `rgb(${r}, ${g}, ${blue})`;
    ctx.fillRect(
      Math.round(bx + col * cellW),
      Math.round(by + row * cellH),
      Math.ceil(cellW),
      Math.ceil(cellH),
    );
    // Cell label — count + share %.
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px ui-monospace, "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = bx + col * cellW + cellW / 2;
    const cy = by + row * cellH + cellH / 2;
    ctx.fillText(String(count), cx, cy - 6);
    ctx.font = '10px ui-monospace, "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(`${Math.round(share * 100)}%`, cx, cy + 8);
  }

  // Zone outline (the strike zone itself).
  ctx.strokeStyle = '#e8eaee';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
  // Grid lines.
  ctx.strokeStyle = 'rgba(232, 234, 238, 0.4)';
  ctx.lineWidth = 1;
  for (let g = 1; g < 3; g++) {
    ctx.beginPath();
    ctx.moveTo(bx + g * cellW, by);
    ctx.lineTo(bx + g * cellW, by + boxH);
    ctx.moveTo(bx, by + g * cellH);
    ctx.lineTo(bx + boxW, by + g * cellH);
    ctx.stroke();
  }

  // Caption strip at the bottom.
  ctx.fillStyle = '#7d848d';
  ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText("catcher's view · % of in-zone pitches", w / 2, h - 4);
};

const opposingPitcherName = (
  ctx: MenuContext,
  gameId: string,
  player: Player,
): { id: string; name: string } | null => {
  const meta = ctx.getGameMetadata?.(gameId);
  if (!meta) return null;
  const isHome = meta.homeTeamId === player.teamId;
  const oppPid = isHome ? meta.awayStartingPitcher : meta.homeStartingPitcher;
  const opp = ctx.playerIndex.get(oppPid);
  if (!opp) return { id: oppPid, name: oppPid };
  return { id: opp.id, name: `${opp.firstName} ${opp.lastName}` };
};

const renderGameLogBatting = (
  host: HTMLElement,
  b: BattingLine,
  teamById: ReadonlyMap<TeamId, Team>,
  ctx: MenuContext,
  player: Player,
): void => {
  const sec = document.createElement('section');
  sec.innerHTML = '<h3>Game log</h3>';
  const table = document.createElement('table');
  table.className = 'game-log';
  table.innerHTML = `
    <thead><tr>
      <th>Day</th><th>Vs</th><th>Opp SP</th>
      <th>PA</th><th>AB</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>SO</th><th>WPA</th>
    </tr></thead>
    <tbody>
    ${b.gameLog.slice(-30).reverse().map((row) => {
      const opp = teamById.get(row.opponentTeamId);
      const oppSp = opposingPitcherName(ctx, row.gameId, player);
      const oppCell = oppSp
        ? playerNameLink(oppSp.name, oppSp.id)
        : '—';
      return `<tr>
        <td>${row.day}</td>
        <td>${row.home ? 'vs' : '@'} ${opp ? escapeHtml(opp.abbr) : ''}</td>
        <td>${oppCell}</td>
        <td>${row.PA}</td><td>${row.AB}</td><td>${row.H}</td><td>${row.HR}</td>
        <td>${row.RBI}</td><td>${row.BB}</td><td>${row.SO}</td>
        <td>${formatSigned(row.WPA, 2)}</td>
      </tr>`;
    }).join('')}
    </tbody>`;
  sec.appendChild(table);
  const hint = document.createElement('div');
  hint.className = 'menu-hint';
  hint.textContent = 'Click an opposing pitcher to see their bio. ← back returns here.';
  sec.appendChild(hint);
  host.appendChild(sec);
};

const renderGameLogPitching = (
  host: HTMLElement,
  p: PitchingLine,
  teamById: ReadonlyMap<TeamId, Team>,
  ctx: MenuContext,
  player: Player,
): void => {
  const sec = document.createElement('section');
  sec.innerHTML = '<h3>Game log</h3>';
  const table = document.createElement('table');
  table.className = 'game-log';
  table.innerHTML = `
    <thead><tr>
      <th>Day</th><th>Vs</th><th>Opp SP</th><th>Dec</th>
      <th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>HR</th><th>WPA</th>
    </tr></thead>
    <tbody>
    ${p.gameLog.slice(-30).reverse().map((row) => {
      const opp = teamById.get(row.opponentTeamId);
      const oppSp = opposingPitcherName(ctx, row.gameId, player);
      const oppCell = oppSp
        ? playerNameLink(oppSp.name, oppSp.id)
        : '—';
      const ipFull = Math.floor(row.IPouts / 3);
      const ipFrac = row.IPouts % 3;
      return `<tr>
        <td>${row.day}</td>
        <td>${row.home ? 'vs' : '@'} ${opp ? escapeHtml(opp.abbr) : ''}</td>
        <td>${oppCell}</td>
        <td>${row.decision}</td>
        <td>${ipFull}.${ipFrac}</td>
        <td>${row.H}</td><td>${row.R}</td><td>${row.ER}</td>
        <td>${row.BB}</td><td>${row.SO}</td><td>${row.HR}</td>
        <td>${formatSigned(row.WPA, 2)}</td>
      </tr>`;
    }).join('')}
    </tbody>`;
  sec.appendChild(table);
  const hint = document.createElement('div');
  hint.className = 'menu-hint';
  hint.textContent = 'Click an opposing pitcher to see their bio. ← back returns here.';
  sec.appendChild(hint);
  host.appendChild(sec);
};
