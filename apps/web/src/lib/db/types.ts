export type TournamentStatus = 'setup' | 'pools' | 'knockout' | 'finished';

export interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  sport: string;
  status: TournamentStatus;
  starts_at: string | null;
  venue: string | null;
  games_per_match: number;
  points_per_game: number;
  win_by_two: boolean;
  max_points: number | null;
  /** Minutes per game before the clock ends it; null = no clock. */
  time_cap_minutes: number | null;
  /** Knockout overrides. null on any column means "use the pool value". */
  ko_games_per_match: number | null;
  ko_points_per_game: number | null;
  ko_win_by_two: boolean | null;
  ko_max_points: number | null;
  /** null = same as the pool stage; 0 = the knockout has no clock. */
  ko_time_cap_minutes: number | null;
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
  withdrawn: boolean;
  /** Organiser-set finishing position within the pool; null = computed. */
  pool_rank_override: number | null;
}

export const TEAM_PUBLIC_COLUMNS = 'id, tournament_id, name, tagline, colour, seed, pool_id, pool_order, withdrawn, pool_rank_override';

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
  stage: 'pool' | 'knockout' | 'playoff';
  pool_id: string | null;
  round: number | null;
  slot: number;
  team_a_id: string | null;
  team_b_id: string | null;
  court: number | null;
  status: 'pending' | 'ready' | 'live' | 'submitted' | 'disputed' | 'done';
  winner_id: string | null;
  decided_by: 'played' | 'awarded' | 'forfeit';
  next_match_id: string | null;
  next_match_side: 'a' | 'b' | null;
  /** Set when the match went to court; null otherwise. */
  started_at: string | null;
  /** Set when the match reached 'done'; null otherwise (and on rows written before this column existed). */
  finished_at: string | null;
}

export interface GameRow {
  match_id: string;
  game_no: number;
  score_a: number;
  score_b: number;
  /** The clock ended this game; any non-level score is accepted. */
  time_expired: boolean;
}

export interface SubmissionRow {
  id: string;
  match_id: string;
  submitted_by: 'admin' | 'team_a' | 'team_b';
  games: { gameNo: number; scoreA: number; scoreB: number }[];
  created_at: string;
}

export interface AnnouncementRow {
  id: string;
  tournament_id: string;
  body: string;
  pinned: boolean;
  created_at: string;
}
