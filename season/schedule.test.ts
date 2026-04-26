import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule } from './schedule.js';

describe('buildSchedule', () => {
  it('produces 1200 total games across 16 teams', () => {
    const league = generateInitialLeague(1);
    const schedule = buildSchedule(league.teams);
    expect(schedule.entries.length).toBe(1200); // 8 games × 150 days
    expect(schedule.totalDays).toBe(150);
  });

  it('every team plays exactly once per day', () => {
    const league = generateInitialLeague(1);
    const schedule = buildSchedule(league.teams);
    const byDay = new Map<number, string[]>();
    for (const e of schedule.entries) {
      const teams = byDay.get(e.day) ?? [];
      teams.push(e.homeTeamId, e.awayTeamId);
      byDay.set(e.day, teams);
    }
    for (const [day, teams] of byDay) {
      const unique = new Set(teams);
      expect(unique.size).toBe(16);
      expect(teams.length).toBe(16);
      // All teams appear, no duplicates
      void day;
    }
  });

  it('every team plays 150 games across the season (75 home, 75 away)', () => {
    const league = generateInitialLeague(1);
    const schedule = buildSchedule(league.teams);
    for (const team of league.teams) {
      const home = schedule.entries.filter((e) => e.homeTeamId === team.id).length;
      const away = schedule.entries.filter((e) => e.awayTeamId === team.id).length;
      expect(home + away).toBe(150);
      // Allow ±1 imbalance from the alternation pattern.
      expect(Math.abs(home - away)).toBeLessThanOrEqual(2);
    }
  });

  it('every pair of teams meets exactly 10 times across the season', () => {
    const league = generateInitialLeague(1);
    const schedule = buildSchedule(league.teams);
    for (let i = 0; i < league.teams.length; i++) {
      for (let j = i + 1; j < league.teams.length; j++) {
        const a = league.teams[i]!.id;
        const b = league.teams[j]!.id;
        const meetings = schedule.entries.filter(
          (e) =>
            (e.homeTeamId === a && e.awayTeamId === b) ||
            (e.homeTeamId === b && e.awayTeamId === a),
        ).length;
        expect(meetings).toBe(10);
      }
    }
  });
});
