import type { PlayerId, StadiumId, TeamId } from '../world/types.js';
import type { PitchResult } from '../sim/types.js';

// HUD-only aggregates derived from the event log. Computed by the scene
// reducer once per frame from the same SimEvent stream that drives the
// field rendering, so the HUD always agrees with the action.
export interface BatterCardStats {
  readonly atBats: number;
  readonly hits: number;
  readonly homeRuns: number;
  readonly rbis: number;
  readonly walks: number;
  readonly strikeouts: number;
}

export interface PitcherCardStats {
  readonly pitches: number;
  readonly balls: number;
  readonly strikes: number;
}

export interface LineScoreInning {
  readonly top: number;
  readonly bottom: number | null;
}

export interface SceneLineScore {
  readonly innings: readonly LineScoreInning[];
  readonly home: { readonly runs: number; readonly hits: number; readonly errors: number };
  readonly away: { readonly runs: number; readonly hits: number; readonly errors: number };
}

// "Big play" trigger for the on-field popup + screen-edge flash. Set on
// every atBatEnd with a notable outcome, consumed by the HUD if the event
// is recent enough.
export interface BigPlayInfo {
  readonly firedAtT: number;
  readonly label: string;
  // 'extra-base' covers 2B, 3B, HR, and triggers the screen-edge flash.
  readonly intensity: 'normal' | 'extra-base';
  readonly teamColor: string;
}

// Transient "+1" popup at home plate when a runner scores. Multiple runs
// can fire at the same simTime (e.g. grand slam scores 4 with one t);
// stackIndex offsets each popup vertically so they don't overlap.
export interface RunScoredPopup {
  readonly firedAtT: number;
  readonly stackIndex: number;
}

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
  // Batter only — drives the 2-frame swing sprite swap. 0 = ready stance,
  // 1 = follow-through. Computed in the scene reducer from the most recent
  // pitch event so the swing tracks each pitch.
  readonly swingFrac?: number;
  // Hand-raise gesture, 0..1. Drives the "high-five" arm during the
  // post-game victory line and any other cheer scenes.
  readonly cheerFrac?: number;
  // Per-player size multiplier derived from listed height. ~0.92 for the
  // shortest players, ~1.08 for the tallest. The sprite renderer applies
  // this on top of the shared SCALE_PX_PER_FT so the field shows visible
  // size variety without distorting hit boxes much.
  readonly heightScale?: number;
}

// One pitch's worth of data for the on-field strike-zone viewer. The
// reducer captures the most recent pitches in the current at-bat so the
// HUD can plot them as colored dots inside (or outside) the 3×3 strike-zone
// grid. firedAtT lets the renderer fade older pitches.
export interface StrikeZonePitchMark {
  readonly result: PitchResult;
  readonly locationZone: number; // 0 = outside, 1..9 = grid cell
  readonly firedAtT: number;
}

// Strike zone viewer state. The viewer always renders, but the dot list
// is only meaningful once at least one pitch has been thrown to the
// current batter. `batterHeightFt` drives a tiny per-batter zone-height
// variance so a 5'6" hitter and a 6'5" hitter visibly differ.
export interface StrikeZoneViewerInfo {
  readonly batterHeightFt: number;
  readonly pitches: readonly StrikeZonePitchMark[];
}

// Set during the inning gap so the renderer can swap from "live action"
// to "teams trading the field" without breaking the 9-fielder invariant.
// The reducer fills this in by looking ahead to the next inningEnd (walk-off)
// and back at the most recent one (walk-on), and the sprite renderer just
// reads positions out of the existing fielders / pitcher / catcher slots.
export interface InningTransitionInfo {
  readonly phase: 'walk-off' | 'walk-on';
  // 0 → just started, 1 → just finished. Useful for fade-in/out cues.
  readonly progress: number;
}

// Drives the post-game high-five line. The reducer fills in nine winners,
// arranged in two staggered ranks, plus a wave phase so the renderer can
// pulse a cheer through the line.
export interface VictoryCelebration {
  readonly winnerTeamId: TeamId;
  readonly losingTeamId: TeamId;
  // simTime since the gameEnd event fired — lets the renderer schedule the
  // walk-in, the cheer wave, and any future flourishes off a single clock.
  readonly elapsed: number;
}

export interface SceneBall {
  readonly position: FieldPoint;
  // Height above the field, in feet. Drives the 2.5D rendering — the ball
  // lifts off its ground point and grows slightly while the shadow stays
  // anchored to the field.
  readonly heightFt: number;
  readonly visible: boolean;
  // Whether the ball is currently in flight (mound→plate or post-contact).
  // Renderer uses this to know when to draw a shadow.
  readonly inFlight: boolean;
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
  // HUD aggregates. The scene reducer fills these by walking the event
  // prefix and reusing /sim/box-score.ts.
  readonly batterStats: BatterCardStats | null;
  readonly pitcherStats: PitcherCardStats | null;
  readonly onDeckBatterId: PlayerId | null;
  readonly strikeZone: StrikeZoneViewerInfo | null;
  readonly lineScore: SceneLineScore;
  readonly lastBigPlay: BigPlayInfo | null;
  // Active "+1" run-scored popups. Filtered to entries within the popup
  // lifetime so the HUD can iterate and draw without further bookkeeping.
  readonly recentRunsScored: readonly RunScoredPopup[];
  // Set while teams are walking on / off the field between innings. Null
  // during normal live play.
  readonly inningTransition: InningTransitionInfo | null;
  // Set after gameEnd — drives the winning team's high-five line.
  readonly victory: VictoryCelebration | null;
  // The simTime at which this scene was built — lets the HUD compute
  // event ages for transient effects (popup pop, screen-edge flash).
  readonly simTime: number;
}
