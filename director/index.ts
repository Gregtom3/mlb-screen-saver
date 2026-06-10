// /director — translates viewer intent into sim input (Phase 5).
//
// The viewer adopts a franchise and sets a managerial posture; the director
// turns that into a coaching-staff override that the app threads into game
// inputs (it never touches the sim core). State persists to localStorage so
// your franchise follows you across sessions.
//
// Determinism note: the override is applied uniformly to every game the
// session simulates — including resume-from-save replays — so a league
// whose settings don't change replays exactly. Changing posture mid-season
// makes the *replayed* past an approximation of what was watched live;
// the future is what the knob is for.

import type { Coach, CoachingStaff, Team, TeamId } from '../world/types.js';

export type ManagerPosture = 'cautious' | 'balanced' | 'aggressive';

export interface DirectorState {
  readonly favoriteTeamId: TeamId | null;
  readonly posture: ManagerPosture;
}

export interface DirectorHandle {
  state(): DirectorState;
  setFavorite(teamId: TeamId | null): void;
  setPosture(posture: ManagerPosture): void;
  /** Coaching staff for this team with the viewer's nudges applied. */
  staffFor(team: Team): CoachingStaff;
  onChange(fn: (s: DirectorState) => void): void;
}

const clampRating = (v: number): number => Math.max(1, Math.min(99, Math.round(v)));

// Posture deltas, applied to the adopted team's coaches. Aggressive sends
// runners and green-lights steals; cautious trades outs on the bases for
// judgment. Balanced leaves the hired staff alone.
const POSTURE_DELTAS: Record<
  ManagerPosture,
  { aggression: number; judgment: number; baserunningCoaching: number }
> = {
  cautious: { aggression: -25, judgment: +10, baserunningCoaching: -10 },
  balanced: { aggression: 0, judgment: 0, baserunningCoaching: 0 },
  aggressive: { aggression: +25, judgment: -5, baserunningCoaching: +20 },
};

const isPosture = (v: unknown): v is ManagerPosture =>
  v === 'cautious' || v === 'balanced' || v === 'aggressive';

export const createDirector = (storageKey: string): DirectorHandle => {
  let state: DirectorState = { favoriteTeamId: null, posture: 'balanced' };
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<{ favoriteTeamId: string; posture: string }>;
      state = {
        favoriteTeamId: typeof parsed.favoriteTeamId === 'string' ? parsed.favoriteTeamId : null,
        posture: isPosture(parsed.posture) ? parsed.posture : 'balanced',
      };
    }
  } catch {
    // Unreadable save — start neutral.
  }

  const listeners: ((s: DirectorState) => void)[] = [];
  const persist = () => {
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage unavailable — nudges still apply for this session.
    }
    for (const fn of listeners) fn(state);
  };

  const nudgedCoach = (coach: Coach, deltas: Partial<Record<string, number>>): Coach => {
    const ratings = { ...coach.ratings } as unknown as Record<string, number>;
    for (const [k, d] of Object.entries(deltas)) {
      if (typeof ratings[k] === 'number' && typeof d === 'number') {
        ratings[k] = clampRating(ratings[k] + d);
      }
    }
    return { ...coach, ratings: ratings as unknown as Coach['ratings'] };
  };

  return {
    state: () => state,
    setFavorite(teamId) {
      state = { ...state, favoriteTeamId: teamId };
      persist();
    },
    setPosture(posture) {
      state = { ...state, posture };
      persist();
    },
    staffFor(team) {
      if (team.id !== state.favoriteTeamId || state.posture === 'balanced') {
        return team.coachingStaff;
      }
      const d = POSTURE_DELTAS[state.posture];
      return {
        head: team.coachingStaff.head,
        firstBase: nudgedCoach(team.coachingStaff.firstBase, {
          baserunningCoaching: d.baserunningCoaching,
        }),
        thirdBase: nudgedCoach(team.coachingStaff.thirdBase, {
          aggression: d.aggression,
          judgment: d.judgment,
        }),
      };
    },
    onChange(fn) {
      listeners.push(fn);
    },
  };
};
