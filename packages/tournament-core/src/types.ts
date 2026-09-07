/** Sport-specific scoring rules. Stored per tournament (or per stage). */
export interface Settings {
  /** Odd number of games; the match is won by a majority. */
  gamesPerMatch: number;
  /** Points needed to win a game. */
  pointsPerGame: number;
  /** If true, a game past pointsPerGame must be won by a two-point lead. */
  winByTwo: boolean;
  /** Hard cap; the first side to reach it wins regardless of lead. null = no cap. */
  maxPoints: number | null;
  /** Minutes per game before the clock ends it; null = no clock. */
  timeCapMinutes: number | null;
}

/** Club night format: one game to 15, win by one, 13-minute clock. */
export const BADMINTON_DEFAULTS: Settings = {
  gamesPerMatch: 1,
  pointsPerGame: 15,
  winByTwo: false,
  maxPoints: null,
  timeCapMinutes: 13,
};

/** Traditional best-of-three used by the original tests. */
export const CLASSIC_BEST_OF_THREE: Settings = {
  gamesPerMatch: 3,
  pointsPerGame: 15,
  winByTwo: true,
  maxPoints: 21,
  timeCapMinutes: null,
};

export type Side = 'a' | 'b';
export type Stage = 'pool' | 'knockout' | 'playoff';
export type MatchStatus = 'pending' | 'ready' | 'live' | 'submitted' | 'disputed' | 'done';
export type DecidedBy = 'played' | 'awarded' | 'forfeit' | 'bye';

export interface Game {
  gameNo: number;
  scoreA: number;
  scoreB: number;
  /** The clock ended this game; any non-level score is accepted. */
  timeExpired?: boolean;
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
  decidedBy: DecidedBy;
  nextMatchId: string | null;
  nextMatchSide: Side | null;
}

export interface TeamRef {
  id: string;
  name: string;
}

/** Returns a float in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;
