import type { GameId, PlayerId, Position, StadiumId, TeamId } from '../world/types.js';

export interface ScheduleEntry {
  readonly gameId: GameId;
  readonly day: number; // 1-based
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly stadiumId: StadiumId;
}

export interface Schedule {
  readonly seasonYear: number;
  readonly totalDays: number;
  readonly entries: readonly ScheduleEntry[];
}

// What the sim needs to know about how a team is set up for one game.
// Built by /season/lineup.ts; consumed by /app to assemble a GameInput.
export interface Lineup {
  readonly teamId: TeamId;
  readonly battingOrder: readonly PlayerId[]; // exactly 9
  readonly startingPitcher: PlayerId;
  readonly bullpen: readonly PlayerId[]; // ordered by reliever preference
  readonly defenseByPosition: Readonly<Record<FieldingPosition, PlayerId>>;
}

// "Defensive" positions actually on the field (DH excluded).
export type FieldingPosition = Exclude<Position, 'DH'>;
