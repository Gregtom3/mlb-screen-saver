import type { PlayerId, StadiumId, TeamId } from '../world/types.js';

// Field coordinate system:
//   - Origin (0, 0) at home plate.
//   - +X toward 1st base (right).
//   - +Y toward 2nd base / outfield (up).
//   - Units = feet.
// Standard diamond:
//   - 1B at (~63.6, ~63.6)   (90 ft / sqrt(2))
//   - 2B at (0, ~127.3)
//   - 3B at (~-63.6, ~63.6)
//   - Pitcher's mound at (0, 60.5)

export interface FieldPoint {
  readonly x: number;
  readonly y: number;
}

export type SpriteRole = 'pitcher' | 'batter' | 'catcher' | 'fielder' | 'runner';

export interface ScenePlayer {
  readonly id: PlayerId;
  readonly role: SpriteRole;
  readonly position: FieldPoint;
  readonly primaryColor: string;
  readonly secondaryColor: string;
}

export interface SceneBall {
  readonly position: FieldPoint;
  readonly visible: boolean;
}

export type GamePhase = 'pre-game' | 'live' | 'final';

export interface SceneState {
  readonly phase: GamePhase;
  readonly inning: number;
  readonly half: 'top' | 'bottom';
  readonly outs: number;
  readonly balls: number;
  readonly strikes: number;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly basesOccupied: {
    readonly first: boolean;
    readonly second: boolean;
    readonly third: boolean;
  };
  readonly pitcher: ScenePlayer | null;
  readonly batter: ScenePlayer | null;
  readonly catcher: ScenePlayer | null;
  readonly fielders: readonly ScenePlayer[];
  readonly runners: readonly ScenePlayer[];
  readonly ball: SceneBall;
  readonly lastPlay: string | null;
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly stadiumId: StadiumId;
  readonly stadiumName: string;
  readonly homeAbbr: string;
  readonly awayAbbr: string;
}
