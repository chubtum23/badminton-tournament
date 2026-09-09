export type TournamentStatus = 'setup' | 'pools' | 'knockout' | 'finished';

/**
 * Public columns only. `join_code` is deliberately absent: anon and authenticated have no select
 * grant on it, so it never reaches the browser. Read it through `tournament_join_code(t)` (admins
 * only), and ask whether one is set through `signup_needs_code(slug)`.
 */
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
  /** Every game of a meeting is played even once the meeting is decided. Applies to every stage. */
  play_all_games: boolean;
  /** One name per game, in game order; `gameLabel` falls back for anything past the end. */
  game_labels: string[];
  /** Knockout overrides. null on any column means "use the pool value". */
  ko_games_per_match: number | null;
  ko_points_per_game: number | null;
  ko_win_by_two: boolean | null;
  ko_max_points: number | null;
  /** null = same as the pool stage; 0 = the knockout has no clock. */
  ko_time_cap_minutes: number | null;
  court_count: number;
  advance_per_pool: number;
  /** Teams may still sign themselves up through /t/[slug]/join. lockPools turns this off. */
  signup_open: boolean;
  created_at: string;
}

/** Every tournament column except `join_code`, which anon and authenticated cannot select. */
export const TOURNAMENT_PUBLIC_COLUMNS =
  'id, slug, name, sport, status, starts_at, venue, games_per_match, points_per_game, win_by_two, max_points, time_cap_minutes, play_all_games, game_labels, ko_games_per_match, ko_points_per_game, ko_win_by_two, ko_max_points, ko_time_cap_minutes, court_count, advance_per_pool, signup_open, created_at';

/** Public columns only. edit_token is never selected through this type. */
export interface TeamRow {
  id: string;
  tournament_id: string;
  name: string;
  tagline: string;
  colour: string;
  description: string;
  seed: number | null;
  pool_id: string | null;
  pool_order: number;
  withdrawn: boolean;
  /** Organiser-set finishing position within the pool; null = computed. */
  pool_rank_override: number | null;
}

export const TEAM_PUBLIC_COLUMNS = 'id, tournament_id, name, tagline, colour, description, seed, pool_id, pool_order, withdrawn, pool_rank_override';

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
  gender: 'male' | 'female';
}

/** A player as linked to a team, with the role the link carries. */
export interface RosterPlayerRow extends PlayerRow {
  role: 'mixed1' | 'mixed2' | 'woman' | null;
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
  status: 'pending' | 'ready' | 'live' | 'submitted' | 'disputed' | 'done';
  winner_id: string | null;
  decided_by: 'played' | 'awarded' | 'forfeit' | 'bye';
  next_match_id: string | null;
  next_match_side: 'a' | 'b' | null;
  /** Set when the match reached 'done'; null otherwise (and on rows written before this column existed). */
  finished_at: string | null;
}

/**
 * One game of a meeting. The row exists from the moment its match is created, so it can be put on
 * a court and clocked before anyone has played it; that is why the scores are nullable. Scheduling
 * lives here rather than on the match because the three games of a meeting run on three courts.
 */
export interface GameRow {
  match_id: string;
  game_no: number;
  /** null until the game has been scored. */
  score_a: number | null;
  score_b: number | null;
  /** The clock ended this game; any non-level score is accepted. */
  time_expired: boolean;
  /** The court this game is on; null while it is unscheduled. */
  court: number | null;
  /** Set when the game went to court; null otherwise. */
  started_at: string | null;
  /** Set while the live clock is stopped; null while it is running. */
  paused_at: string | null;
  /** Total milliseconds already spent paused, so the countdown ignores stoppages. */
  paused_ms: number;
}

/** A game row that has actually been scored, so it maps to the core `Game` type. */
export type ScoredGameRow = GameRow & { score_a: number; score_b: number };

/**
 * One player's mark out of 10 for one game. `rating` is `numeric(3,1)` in Postgres, so it arrives
 * as a JSON number with a single decimal place; nothing in the app widens it.
 */
export interface RatingRow {
  match_id: string;
  game_no: number;
  player_id: string;
  rating: number;
}

export interface SubmissionRow {
  id: string;
  match_id: string;
  submitted_by: 'admin' | 'team_a' | 'team_b';
  /** Stored as JSON exactly as the core `Game` shape, `timeExpired` included. */
  games: { gameNo: number; scoreA: number; scoreB: number; timeExpired?: boolean }[];
  created_at: string;
}

export interface AnnouncementRow {
  id: string;
  tournament_id: string;
  body: string;
  pinned: boolean;
  created_at: string;
}
