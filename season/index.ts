// /season — scheduler, playoff bracket, awards, offseason logic.
export * from './types.js';
export { buildSchedule } from './schedule.js';
export { buildLineup } from './lineup.js';
export {
  applyPlayoffResults,
  homeTeamForGame,
  playoffGamesForDay,
  seedPlayoffs,
  seriesDecided,
  seriesWinner,
  type PlayoffGameEntry,
  type PlayoffGameResult,
  type PlayoffRound,
  type PlayoffSeedEntry,
  type PlayoffSeries,
  type PlayoffState,
} from './playoffs.js';
export {
  agePlayerRatings,
  playerAgeInSeason,
  retirementProbability,
  runOffseason,
  type OffseasonResult,
} from './offseason.js';
export {
  type LeagueHistory,
  type SeasonRecord,
  type CareerBattingLine,
  type CareerPitchingLine,
  type HallOfFamer,
  type SingleSeasonRecords,
  type RecordBookEntry,
  type BattingLeaderKey,
  type PitchingLeaderKey,
  type LeaderEntry,
  type SeasonLeaders,
  type BuildHistoryInput,
  BATTING_LEADER_KEYS,
  PITCHING_LEADER_KEYS,
  buildLeagueHistory,
  summarizeSeason,
  careerBattingScore,
  careerPitchingScore,
  formatLeaderValue,
} from './history.js';
