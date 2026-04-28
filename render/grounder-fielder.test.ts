import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import { buildAllPlayChoreos, buildFielderIdsByPos, type FielderPos } from './choreo.js';
import type { GameInput, SideInput, SimEvent } from '../sim/types.js';

// Regression: grounders must reach the correct infielder on screen.
//
// Before the fix, the renderer used a Cartesian-closest heuristic that
// handed the pitcher (mound at y=60.5) ~70% of grounders because typical
// landing spots (~70 ft up the middle) sit closer to the mound than to
// 2B/SS at y=118. Now the sim stamps `fielderId` on the contact event
// (using its spray-band picker) and the renderer honors it.

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

describe('grounder fielder distribution', () => {
  it('sim stamps fielderId on every grounder contact event', () => {
    const input = buildInputForFirstGame(9000, 1000);
    const events = runGame(input);
    let lastContact: Extract<SimEvent, { kind: 'contact' }> | null = null;
    let grounders = 0;
    let stamped = 0;
    for (const ev of events) {
      if (ev.kind === 'contact') lastContact = ev;
      else if (ev.kind === 'atBatEnd') {
        const o = ev.outcome;
        const isGrounder =
          o === 'groundout' || o === 'double-play' || o === 'fielders-choice';
        if (isGrounder && lastContact) {
          grounders += 1;
          if (lastContact.fielderId !== undefined) stamped += 1;
        }
        lastContact = null;
      }
    }
    expect(grounders).toBeGreaterThan(0);
    expect(stamped).toBe(grounders);
  });

  it('renderer assigns grounders across all infielders, not just the pitcher', () => {
    const counts: Record<FielderPos, number> = {
      P: 0, C: 0, '1B': 0, '2B': 0, '3B': 0, SS: 0,
      LF: 0, CF: 0, RF: 0,
    };
    let total = 0;

    for (let g = 0; g < 6; g += 1) {
      const input = buildInputForFirstGame(9000, 1000 + g);
      const events = runGame(input);
      const homeIds = buildFielderIdsByPos(
        input.home.battingOrder,
        input.home.startingPitcherId,
        input.playerIndex,
      );
      const awayIds = buildFielderIdsByPos(
        input.away.battingOrder,
        input.away.startingPitcherId,
        input.playerIndex,
      );
      const choreos = buildAllPlayChoreos(events, { home: homeIds, away: awayIds });

      // Pair each grounder atBatEnd with the prior contact, then look up
      // the choreo's primary fielder. The primary is the role whose
      // toPos equals the contact's landing point (coverers go to a base).
      let lastContact: Extract<SimEvent, { kind: 'contact' }> | null = null;
      for (const ev of events) {
        if (ev.kind === 'contact') lastContact = ev;
        else if (ev.kind === 'atBatEnd') {
          const o = ev.outcome;
          const isGrounder =
            o === 'groundout' || o === 'double-play' || o === 'fielders-choice';
          if (isGrounder && lastContact) {
            const choreo = choreos.get(lastContact.t);
            if (choreo) {
              const lx = lastContact.ballPath.landingX;
              const ly = lastContact.ballPath.landingY;
              const primary = choreo.fielderRoles.find(
                (r) => r.toPos.x === lx && r.toPos.y === ly,
              );
              if (primary) {
                counts[primary.fielderPos] += 1;
                total += 1;
              }
            }
          }
          lastContact = null;
        }
      }
    }

    expect(total).toBeGreaterThan(50);
    expect(counts.P / total).toBeLessThan(0.20);
    expect(counts.SS / total).toBeGreaterThan(0.15);
    expect(counts['2B'] / total).toBeGreaterThan(0.10);
    expect(counts['1B'] / total).toBeGreaterThan(0.10);
    expect(counts['3B'] / total).toBeGreaterThan(0.05);
  });
});
