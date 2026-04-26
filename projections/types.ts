import type { TeamId } from '../world/types.js';

export interface TeamProjection {
  readonly teamId: TeamId;
  readonly currentW: number;
  readonly currentL: number;
  readonly pythagoreanWinPct: number;
  /** Distribution of final win totals across N simulations. */
  readonly winsP05: number;
  readonly winsP50: number;
  readonly winsP95: number;
  readonly pPlayoffs: number;
  readonly pDivision: number;
  readonly pTopSeed: number;
  readonly pConference: number;
  readonly pTitle: number;
  /** Strength-of-schedule remaining: avg log5 win prob the team faces (lower = harder). */
  readonly sosRemaining: number;
  /** Magic number for the division (clinch). 0 = clinched, null = eliminated. */
  readonly magicDivision: number | null;
  readonly eliminationDivision: number | null;
}

export interface ProjectionSet {
  readonly seasonYear: number;
  readonly simulations: number;
  readonly seed: number;
  readonly teams: ReadonlyMap<TeamId, TeamProjection>;
}
