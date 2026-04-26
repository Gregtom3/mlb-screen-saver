import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { groupsForPlayer, overallGrade, starRating, starsToGlyphs } from './grades.js';

describe('starRating', () => {
  it('maps the 1..99 range monotonically into 1..5 stars', () => {
    const a = starRating(20);
    const b = starRating(50);
    const c = starRating(80);
    const d = starRating(99);
    expect(a.stars).toBeLessThan(b.stars);
    expect(b.stars).toBeLessThan(c.stars);
    expect(c.stars).toBeLessThan(d.stars);
    expect(d.stars).toBe(5.0);
  });

  it('half-star granularity', () => {
    for (let r = 1; r <= 99; r++) {
      const g = starRating(r);
      expect(g.stars).toBeGreaterThanOrEqual(1.0);
      expect(g.stars).toBeLessThanOrEqual(5.0);
      expect(g.stars * 2).toBe(Math.round(g.stars * 2)); // 0.5-step
    }
  });
});

describe('starsToGlyphs', () => {
  it('always produces 5 glyphs', () => {
    for (const s of [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      // Each glyph is one symbol (★, ⯪, or ☆) — but ⯪ is a 2-byte code unit,
      // so use Array.from to count by codepoint.
      expect(Array.from(starsToGlyphs(s)).length).toBe(5);
    }
  });
});

describe('groupsForPlayer', () => {
  it('shows pitching to pitchers and hitting+running to position players', () => {
    const league = generateInitialLeague(0xa1);
    const pitcher = league.players.find((p) => p.primaryPosition === 'P')!;
    const catcher = league.players.find((p) => p.primaryPosition === 'C')!;
    const dh = league.players.find((p) => p.primaryPosition === 'DH')!;
    const ss = league.players.find((p) => p.primaryPosition === 'SS')!;

    const pTitles = groupsForPlayer(pitcher).map((g) => g.title);
    expect(pTitles).toContain('Pitching');
    expect(pTitles).not.toContain('Baserunning');

    const cTitles = groupsForPlayer(catcher).map((g) => g.title);
    expect(cTitles).toContain('Catcher defense');

    const dhTitles = groupsForPlayer(dh).map((g) => g.title);
    // DH gets hitting + baserunning + mental, no defense.
    expect(dhTitles).toContain('Hitting');
    expect(dhTitles).toContain('Baserunning');

    const ssTitles = groupsForPlayer(ss).map((g) => g.title);
    expect(ssTitles).toContain('Infield defense');
  });
});

describe('overallGrade', () => {
  it('returns a value in 1..99 for every player in a 16-team league', () => {
    const league = generateInitialLeague(0xa2);
    for (const p of league.players) {
      const og = overallGrade(p);
      expect(og).toBeGreaterThanOrEqual(1);
      expect(og).toBeLessThanOrEqual(99);
    }
  });
});
