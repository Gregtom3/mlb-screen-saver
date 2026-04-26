import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput } from '../sim/types.js';
import { buildScene, type SceneContext } from './scene.js';

const buildContextAndEvents = () => {
  const SEED = 0xba_5e_ba_11;
  const league = generateInitialLeague(SEED);
  const schedule = buildSchedule(league.teams, league.season.year);
  const entry = schedule.entries.find((e) => e.day === 1)!;
  const homeTeam = league.teams.find((t) => t.id === entry.homeTeamId)!;
  const awayTeam = league.teams.find((t) => t.id === entry.awayTeamId)!;
  const stadium = league.stadiums.find((s) => s.id === entry.stadiumId)!;
  const home: SideInput = (() => {
    const l = buildLineup(homeTeam, league.players, 1);
    return {
      teamId: homeTeam.id,
      battingOrder: l.battingOrder,
      startingPitcherId: l.startingPitcher,
      bullpen: l.bullpen,
    };
  })();
  const away: SideInput = (() => {
    const l = buildLineup(awayTeam, league.players, 1);
    return {
      teamId: awayTeam.id,
      battingOrder: l.battingOrder,
      startingPitcherId: l.startingPitcher,
      bullpen: l.bullpen,
    };
  })();
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));
  const input: GameInput = {
    gameId: entry.gameId,
    stadiumId: entry.stadiumId,
    home,
    away,
    playerIndex,
    seed: SEED,
  };
  const events = runGame(input);
  const teamColors = new Map(
    league.teams.map((t) => [
      t.id,
      { primary: t.colors.primary, secondary: t.colors.secondary, accent: t.colors.accent },
    ]),
  );
  const teamAbbr = new Map(league.teams.map((t) => [t.id, t.abbr]));
  const ctx: SceneContext = {
    input,
    teamColors,
    teamAbbr,
    stadiumName: stadium.name,
    grassShade: stadium.atmosphere.grassShade,
    skyColor: '#0b0d10',
  };
  return { events, ctx };
};

describe('buildScene', () => {
  it('is a pure function: same inputs produce equal outputs', () => {
    const { events, ctx } = buildContextAndEvents();
    const a = buildScene(events, 100, ctx);
    const b = buildScene(events, 100, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('starts in pre-game before any events have applied', () => {
    const { events, ctx } = buildContextAndEvents();
    const scene = buildScene(events, -1, ctx);
    expect(scene.phase).toBe('pre-game');
    expect(scene.scoreHome).toBe(0);
    expect(scene.scoreAway).toBe(0);
  });

  it('reaches phase=final at the end of the event log', () => {
    const { events, ctx } = buildContextAndEvents();
    const last = events[events.length - 1];
    if (last?.kind !== 'gameEnd') throw new Error('events do not end with gameEnd');
    const scene = buildScene(events, last.t + 1, ctx);
    expect(scene.phase).toBe('final');
    // Final score in scene must match the recorded final.
    expect(scene.scoreHome).toBe(last.finalRuns.home);
    expect(scene.scoreAway).toBe(last.finalRuns.away);
  });

  it('always renders 9 fielders during live play', () => {
    const { events, ctx } = buildContextAndEvents();
    // sample multiple sim times — one early, one mid-game.
    const lastT = events[events.length - 1]?.t ?? 0;
    for (const t of [50, Math.floor(lastT * 0.25), Math.floor(lastT * 0.5)]) {
      const scene = buildScene(events, t, ctx);
      // pitcher + catcher + 7 other fielders = 9
      const pitcherCount = scene.pitcher ? 1 : 0;
      const catcherCount = scene.catcher ? 1 : 0;
      expect(pitcherCount + catcherCount + scene.fielders.length).toBe(9);
    }
  });

  it('clears bases after an inning ends', () => {
    const { events, ctx } = buildContextAndEvents();
    // Find the first inningEnd event and sample just after it.
    const inningEnd = events.find((e) => e.kind === 'inningEnd');
    if (!inningEnd) throw new Error('no inningEnd in events');
    const scene = buildScene(events, inningEnd.t + 1, ctx);
    expect(scene.basesOccupied.first).toBe(false);
    expect(scene.basesOccupied.second).toBe(false);
    expect(scene.basesOccupied.third).toBe(false);
    expect(scene.outs).toBe(0);
  });

  it('reflects scoring within the same half-inning', () => {
    const { events, ctx } = buildContextAndEvents();
    // Find a baserunner event with to=0 and out=false (a run scored).
    const scoreEvent = events.find((e) => e.kind === 'baserunner' && e.to === 0 && !e.out);
    if (!scoreEvent || scoreEvent.kind !== 'baserunner') return;
    const scene = buildScene(events, scoreEvent.t + 0.5, ctx);
    expect(scene.scoreHome + scene.scoreAway).toBeGreaterThan(0);
  });
});
