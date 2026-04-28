import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import { pickInfieldPosition } from '../sim/game.js';
import { FIELDER_HOME_POSITIONS } from './field-geometry.js';
import type { GameInput, SideInput, SimEvent } from '../sim/types.js';
import type { FielderPos } from './choreo.js';

// Diagnostic: where does the renderer think the ball is fielded vs the sim?
//
// The sim picks an infield fielder by spray-angle bands (see
// sim/game.ts:pickInfieldPosition). The renderer (choreo.ts:pickClosestFielder)
// independently picks by Cartesian distance from each fielder's home position
// to the landing point. Because the mound sits at (0, 60.5) and a typical
// grounder lands ~70 ft up the middle, the pitcher wins the closest-fielder
// race for almost every grounder — even ones the sim assigned to SS, 2B,
// 3B, or 1B.

const INFIELD_PRIMARY: readonly FielderPos[] = ['1B', '2B', '3B', 'SS', 'P', 'C'];

const distSq = (ax: number, ay: number, bx: number, by: number) =>
  (ax - bx) ** 2 + (ay - by) ** 2;

const renderPickClosest = (landingX: number, landingY: number): FielderPos => {
  let best: FielderPos = 'P';
  let bestD = Infinity;
  for (const pos of INFIELD_PRIMARY) {
    const home = FIELDER_HOME_POSITIONS[pos];
    const d = distSq(landingX, landingY, home.x, home.y);
    if (d < bestD) {
      bestD = d;
      best = pos;
    }
  }
  return best;
};

const sprayDegOf = (lx: number, ly: number): number =>
  (Math.atan2(lx, Math.max(1, ly)) * 180) / Math.PI;

const buildInputForFirstGame = (masterSeed: number, gameSeed: number): GameInput => {
  const league = generateInitialLeague(masterSeed);
  const schedule = buildSchedule(league.teams, league.season.year);
  const entry = schedule.entries.find((e) => e.day === 1)!;
  const homeTeam = league.teams.find((t) => t.id === entry.homeTeamId)!;
  const awayTeam = league.teams.find((t) => t.id === entry.awayTeamId)!;
  const homeLineup = buildLineup(homeTeam, league.players, 1);
  const awayLineup = buildLineup(awayTeam, league.players, 1);
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));
  const home: SideInput = {
    teamId: homeTeam.id,
    battingOrder: homeLineup.battingOrder,
    startingPitcherId: homeLineup.startingPitcher,
    bullpen: homeLineup.bullpen,
    defenseByPosition: homeLineup.defenseByPosition,
    coachingStaff: homeTeam.coachingStaff,
  };
  const away: SideInput = {
    teamId: awayTeam.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
    defenseByPosition: awayLineup.defenseByPosition,
    coachingStaff: awayTeam.coachingStaff,
  };
  return {
    gameId: entry.gameId,
    stadiumId: entry.stadiumId,
    home,
    away,
    playerIndex,
    seed: gameSeed,
  };
};

describe('grounder fielder distribution — diagnostic', () => {
  it('compares sim spray-band fielder vs renderer closest-fielder for a season slice', () => {
    const simCounts: Record<string, number> = { P: 0, '1B': 0, '2B': 0, SS: 0, '3B': 0, C: 0 };
    const rendCounts: Record<string, number> = { P: 0, '1B': 0, '2B': 0, SS: 0, '3B': 0, C: 0 };
    let total = 0;

    // Run a handful of games to gather grounder samples.
    for (let g = 0; g < 6; g += 1) {
      const input = buildInputForFirstGame(9000, 1000 + g);
      const events = runGame(input);
      // Walk PA-by-PA: find atBatEnd events, look back for the contact in
      // that PA, classify if outcome was a grounder.
      let lastContact: Extract<SimEvent, { kind: 'contact' }> | null = null;
      for (const ev of events) {
        if (ev.kind === 'contact') {
          lastContact = ev;
        } else if (ev.kind === 'atBatEnd') {
          const o = ev.outcome;
          const isGrounder =
            o === 'groundout' || o === 'double-play' || o === 'fielders-choice';
          if (isGrounder && lastContact) {
            const path = lastContact.ballPath;
            const spray = sprayDegOf(path.landingX, path.landingY);
            const simPos = pickInfieldPosition(spray, 0);
            const rendPos = renderPickClosest(path.landingX, path.landingY);
            simCounts[simPos] = (simCounts[simPos] ?? 0) + 1;
            rendCounts[rendPos] = (rendCounts[rendPos] ?? 0) + 1;
            total += 1;
          }
          lastContact = null;
        }
      }
    }

    const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
    // eslint-disable-next-line no-console
    console.log(`\nGrounders sampled: ${total}`);
    // eslint-disable-next-line no-console
    console.log('Sim (spray-band)    :', Object.fromEntries(
      Object.entries(simCounts).map(([k, v]) => [k, pct(v)]),
    ));
    // eslint-disable-next-line no-console
    console.log('Render (closest)    :', Object.fromEntries(
      Object.entries(rendCounts).map(([k, v]) => [k, pct(v)]),
    ));

    // The bug: the renderer hands the pitcher >50% of grounders despite
    // sim's spray-band saying P should get <10%.
    expect(total).toBeGreaterThan(50);
    expect(rendCounts.P / total).toBeGreaterThan(0.4); // BUG: renderer over-weights P
    expect(simCounts.P / total).toBeLessThan(0.15);    // sim picks P rarely
  });

  it('shows that for a typical 70 ft groundout up the middle, render picks P', () => {
    // Spray = 0°, distance = 70 ft → landing (0, 70). Sim gives P (within ±1°
    // band), but more telling: a spray of -10° at distance 80 should be SS,
    // yet the renderer's closest-fielder geometry still picks P.
    const spray = -10;
    const dist = 80;
    const lx = Math.sin((spray * Math.PI) / 180) * dist;
    const ly = Math.cos((spray * Math.PI) / 180) * dist;

    const simPos = pickInfieldPosition(spray, 0);
    const rendPos = renderPickClosest(lx, ly);
    // eslint-disable-next-line no-console
    console.log(`spray=${spray}° dist=${dist}ft  sim=${simPos}  render=${rendPos}  landing=(${lx.toFixed(1)}, ${ly.toFixed(1)})`);
    expect(simPos).toBe('SS');
    expect(rendPos).toBe('P'); // BUG: pitcher wins closest-fielder
  });
});
