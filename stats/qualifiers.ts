import type { BattingLine, PitchingLine } from './types.js';

// MLB-standard qualifier thresholds, scaled to our 150-game season.
//
//   Hitters: 3.1 PA per team game → 3.1 × 150 ≈ 465 PA at season's end.
//   Pitchers: 1.0 IP per team game → 150 IP at season's end.
//
// These thresholds proportionally scale by how far through the season
// we are — at game 30, a hitter qualifies with ≥ 93 PA, etc. So
// leaderboards stay sensible mid-season.

const PA_PER_TEAM_GAME = 3.1;
const IP_PER_TEAM_GAME = 1.0;

export const isQualifiedBatter = (line: BattingLine, teamGamesPlayed: number): boolean => {
  if (teamGamesPlayed <= 0) return line.PA > 0;
  return line.PA >= PA_PER_TEAM_GAME * teamGamesPlayed;
};

export const isQualifiedPitcher = (line: PitchingLine, teamGamesPlayed: number): boolean => {
  if (teamGamesPlayed <= 0) return line.IPouts > 0;
  const requiredOuts = IP_PER_TEAM_GAME * teamGamesPlayed * 3;
  return line.IPouts >= requiredOuts;
};
