/** Sport-specific scoring rules. Stored per tournament. */
export interface Settings {
  /** Odd number of games; the match is won by a majority. */
  gamesPerMatch: number;
  /** Points needed to win a game. */
  pointsPerGame: number;
  /** If true, a game past pointsPerGame must be won by a two-point lead. */
  winByTwo: boolean;
  /** Hard cap; the first side to reach it wins regardless of lead. null = no cap. */
  maxPoints: number | null;
}

export const BADMINTON_DEFAULTS: Settings = {
  gamesPerMatch: 3,
  pointsPerGame: 15,
  winByTwo: true,
  maxPoints: 21,
};

export type Side = 'a' | 'b';
export type Stage = 'pool' | 'knockout';
export type MatchStatus = 'pending' | 'ready' | 'live' | 'submitted' | 'disputed' | 'done';

export interface Game {
  gameNo: number;
  scoreA: number;
  scoreB: number;
}

export interface Match {
  id: string;
  stage: Stage;
  poolId: string | null;
  /** Knockout only. 1 = first round. null for pool matches. */
  round: number | null;
  /** Position within the pool schedule or within the knockout round, starting at 1. */
  slot: number;
  teamAId: string | null;
  teamBId: string | null;
  court: number | null;
  status: MatchStatus;
  winnerId: string | null;
  nextMatchId: string | null;
  nextMatchSide: Side | null;
}

export interface TeamRef {
  id: string;
  name: string;
}

/** Returns a float in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;
