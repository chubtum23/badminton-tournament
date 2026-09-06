export type TournamentStatus = 'setup' | 'pools' | 'knockout' | 'finished';

export interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  sport: string;
  status: TournamentStatus;
  games_per_match: number;
  points_per_game: number;
  win_by_two: boolean;
  max_points: number | null;
  court_count: number;
  advance_per_pool: number;
  created_at: string;
}

/** Public columns only. edit_token is never selected through this type. */
export interface TeamRow {
  id: string;
  tournament_id: string;
  name: string;
  tagline: string;
  colour: string;
  seed: number | null;
  pool_id: string | null;
  pool_order: number;
}

export const TEAM_PUBLIC_COLUMNS = 'id, tournament_id, name, tagline, colour, seed, pool_id, pool_order';

export interface PoolRow {
  id: string;
  tournament_id: string;
  name: string;
  position: number;
  locked: boolean;
}

export interface PlayerRow {
  id: string;
  tournament_id: string;
  name: string;
}

export interface MatchRow {
  id: string;
  tournament_id: string;
  stage: 'pool' | 'knockout';
  pool_id: string | null;
  round: number | null;
  slot: number;
  team_a_id: string | null;
  team_b_id: string | null;
  court: number | null;
  status: 'pending' | 'ready' | 'live' | 'submitted' | 'disputed' | 'done';
  winner_id: string | null;
  next_match_id: string | null;
  next_match_side: 'a' | 'b' | null;
  /** Set when the match reached 'done'; null otherwise (and on rows written before this column existed). */
  finished_at: string | null;
}

export interface GameRow {
  match_id: string;
  game_no: number;
  score_a: number;
  score_b: number;
}
