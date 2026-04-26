import type { Player } from '../world/types.js';
import type { BattingLine, PitchingLine } from './types.js';
import { era, ops } from './derived.js';
import { isQualifiedBatter, isQualifiedPitcher } from './qualifiers.js';

// Phase 5.5 part 2 — transparent awards-watch formulas.
//
// MVP    = bWPA + (OPS - .700) × 25 × (G / 150)
// Cy     = pWPA + (4.00 - ERA) × 0.5 × (IP / 150)
// Rookie = MVP, restricted to players with workEthic > 60 (proxy for "young
//          and improving" until we have an actual rookie flag in Phase 6).
//
// Documented in /docs/awards.md. The formula's deliberately legible —
// users should be able to look at a leader and see why.

export interface AwardCandidate<L> {
  readonly playerId: string;
  readonly score: number;
  readonly line: L;
  readonly player: Player | undefined;
}

const battingScore = (line: BattingLine, games: number): number => {
  const opsVal = ops(line);
  const opsPart = (opsVal - 0.700) * 25 * (line.G / 150);
  return line.WPA + opsPart;
};

const pitchingScore = (line: PitchingLine, games: number): number => {
  const eraVal = era(line);
  const ipPart = (4.0 - eraVal) * 0.5 * (line.IPouts / 3 / 150);
  void games;
  return line.WPA + ipPart;
};

export const mvpRanking = (
  batting: ReadonlyMap<string, BattingLine>,
  playerIndex: ReadonlyMap<string, Player>,
  teamGamesPlayed: number,
): AwardCandidate<BattingLine>[] =>
  [...batting.values()]
    .filter((b) => isQualifiedBatter(b, teamGamesPlayed))
    .map((b) => ({
      playerId: b.playerId,
      score: battingScore(b, teamGamesPlayed),
      line: b,
      player: playerIndex.get(b.playerId),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

export const cyYoungRanking = (
  pitching: ReadonlyMap<string, PitchingLine>,
  playerIndex: ReadonlyMap<string, Player>,
  teamGamesPlayed: number,
): AwardCandidate<PitchingLine>[] =>
  [...pitching.values()]
    .filter((p) => isQualifiedPitcher(p, teamGamesPlayed))
    .map((p) => ({
      playerId: p.playerId,
      score: pitchingScore(p, teamGamesPlayed),
      line: p,
      player: playerIndex.get(p.playerId),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

export const rookieRanking = (
  batting: ReadonlyMap<string, BattingLine>,
  playerIndex: ReadonlyMap<string, Player>,
  teamGamesPlayed: number,
): AwardCandidate<BattingLine>[] =>
  [...batting.values()]
    .filter((b) => isQualifiedBatter(b, teamGamesPlayed))
    .map((b) => ({
      playerId: b.playerId,
      score: battingScore(b, teamGamesPlayed),
      line: b,
      player: playerIndex.get(b.playerId),
    }))
    .filter((c) => c.player !== undefined && c.player.ratings.workEthic > 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
