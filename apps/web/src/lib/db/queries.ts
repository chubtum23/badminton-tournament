import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnnouncementRow, GameRow, MatchRow, PoolRow, RatingRow, RosterPlayerRow, SubmissionRow, TeamRow, TournamentRow } from './types';
import { TEAM_PUBLIC_COLUMNS, TOURNAMENT_PUBLIC_COLUMNS } from './types';

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: no data`);
  return res.data;
}

/**
 * The caching rule for this file.
 *
 * `cache()` memoises per request. `createServerSupabase` is itself request-cached, so the admin
 * layout and the page rendered inside it pass the same client instance and share one round trip —
 * that is the win, and it is safe for a table nothing writes before reading it again.
 *
 * It is NOT safe for anything a server action re-reads after writing: within one request the
 * memoised call returns the pre-write rows, so the action decides against state that no longer
 * exists. `games`, `matches` and `score_submissions` are all read again after a write (see
 * `syncMatchStatus`, `saveGameScore` and `applySubmission`'s retry), so those three queries are
 * deliberately uncached. Do not wrap them without re-checking every caller in `src/actions`.
 */

// Cached: nothing writes `tournaments` and then re-reads it through this in the same request.
export const getTournamentBySlug = cache(async (sb: SupabaseClient, slug: string): Promise<TournamentRow | null> => {
  const res = await sb.from('tournaments').select(TOURNAMENT_PUBLIC_COLUMNS).eq('slug', slug).maybeSingle();
  if (res.error) throw new Error(`tournament: ${res.error.message}`);
  return (res.data as TournamentRow | null) ?? null;
});

// Cached: `pools` is written by generatePools/lockPools/unlockPools, none of which read it back.
export const listPools = cache(async (sb: SupabaseClient, tournamentId: string): Promise<PoolRow[]> => {
  return must(await sb.from('pools').select('*').eq('tournament_id', tournamentId).order('position'), 'pools') as PoolRow[];
});

// Cached: every action that writes `teams` reads it first and never again in the same request.
export const listTeams = cache(async (sb: SupabaseClient, tournamentId: string): Promise<TeamRow[]> => {
  return must(
    await sb.from('teams').select(TEAM_PUBLIC_COLUMNS).eq('tournament_id', tournamentId).order('pool_order').order('name'),
    'teams',
  ) as TeamRow[];
});

// NOT cached: `withdrawTeam` forfeits one match after another through `awardMatch`, and
// `applySubmission` re-reads after losing a race — both would see pre-write rows.
export async function listMatches(sb: SupabaseClient, tournamentId: string): Promise<MatchRow[]> {
  return must(
    // stage descending because 'pool' > 'knockout' alphabetically and pool matches come first
    // chronologically; pool rows have a null round, so nullsFirst keeps them ahead of round 1.
    await sb.from('matches').select('*').eq('tournament_id', tournamentId)
      .order('stage', { ascending: false }).order('round', { nullsFirst: true }).order('slot'),
    'matches',
  ) as MatchRow[];
}

// NOT cached: `startGame`, `takeGameOffCourt`, `saveGameScore` and `clearGameScore` all write a
// game row and then read the meeting's games back (directly or through `syncMatchStatus`) to decide
// the match status. Memoising this makes them decide from the rows as they were before the write.
export async function listGames(sb: SupabaseClient, tournamentId: string): Promise<GameRow[]> {
  // games has no tournament_id; join through matches
  const res = await sb
    .from('games')
    .select('match_id, game_no, score_a, score_b, time_expired, court, started_at, paused_at, paused_ms, matches!inner(tournament_id)')
    .eq('matches.tournament_id', tournamentId);
  const rows = must(res, 'games') as Array<GameRow & { matches: unknown }>;
  return rows.map(({ match_id, game_no, score_a, score_b, time_expired, court, started_at, paused_at, paused_ms }) => ({
    match_id, game_no, score_a, score_b, time_expired, court, started_at, paused_at, paused_ms,
  }));
}

// NOT cached: `saveGameScore` deletes and re-inserts a game's ratings, and the Players page is
// rendered from a fresh request, so memoising this would only risk handing an action stale rows.
export async function listPlayerRatings(sb: SupabaseClient, tournamentId: string): Promise<RatingRow[]> {
  // player_ratings has no tournament_id, and unlike `games` it cannot reach `matches` in one hop:
  // its only key into the rest of the schema is the composite one into `games`. Giving it a second,
  // direct key to `matches` would make it a junction table, at which point PostgREST can no longer
  // tell how `games` embeds `matches` and refuses that embed (PGRST201) — which breaks listGames and
  // every page built on it. So the hop is spelled out instead: rating -> game -> match.
  const res = await sb
    .from('player_ratings')
    .select('match_id, game_no, player_id, rating, games!inner(matches!inner(tournament_id))')
    .eq('games.matches.tournament_id', tournamentId);
  const rows = must(res, 'player ratings') as Array<RatingRow & { games: unknown }>;
  return rows.map(({ match_id, game_no, player_id, rating }) => ({ match_id, game_no, player_id, rating: Number(rating) }));
}

/**
 * Every game row of a match in game order, unplayed slots included — this is what the schedule and
 * the match cards render. `gamesByMatch` in mappers.ts is the scored-only view the rules consume.
 */
export function gameSlotsByMatch(rows: readonly GameRow[]): Record<string, GameRow[]> {
  const out: Record<string, GameRow[]> = {};
  for (const r of rows) (out[r.match_id] ??= []).push(r);
  for (const list of Object.values(out)) list.sort((x, y) => x.game_no - y.game_no);
  return out;
}

export interface TeamWithPlayers extends TeamRow {
  players: RosterPlayerRow[];
}

// Cached: rosters are written by rpc and never read back in the same request.
export const listTeamsWithPlayers = cache(async (sb: SupabaseClient, tournamentId: string): Promise<TeamWithPlayers[]> => {
  const teams = await listTeams(sb, tournamentId);
  if (teams.length === 0) return [];
  const links = must(
    await sb.from('team_players').select('team_id, role, players(id, tournament_id, name, gender, photo_path)').in('team_id', teams.map((t) => t.id)),
    'team_players',
  ) as unknown as Array<{ team_id: string; role: RosterPlayerRow['role']; players: Omit<RosterPlayerRow, 'role'> | null }>;
  const byTeam = new Map<string, RosterPlayerRow[]>();
  for (const l of links) if (l.players) (byTeam.get(l.team_id) ?? byTeam.set(l.team_id, []).get(l.team_id)!).push({ ...l.players, role: l.role });
  return teams.map((t) => ({ ...t, players: byTeam.get(t.id) ?? [] }));
});

// NOT cached: `applySubmission` inserts a submission and, on a lost race, re-reads to judge again.
export async function listSubmissions(sb: SupabaseClient, tournamentId: string): Promise<SubmissionRow[]> {
  const res = await sb
    .from('score_submissions')
    .select('id, match_id, submitted_by, games, created_at, matches!inner(tournament_id)')
    .eq('matches.tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  const rows = must(res, 'submissions') as unknown as Array<SubmissionRow & { matches: unknown }>;
  return rows.map(({ id, match_id, submitted_by, games, created_at }) => ({ id, match_id, submitted_by, games, created_at }));
}

export type LatestSubmissions = Record<string, { a?: SubmissionRow; b?: SubmissionRow }>;

/** Latest submission per side per match. Input must be newest-first (as listSubmissions returns). */
export function latestByMatch(rows: readonly SubmissionRow[]): LatestSubmissions {
  const out: LatestSubmissions = {};
  for (const r of rows) {
    const slot = (out[r.match_id] ??= {});
    if (r.submitted_by === 'team_a' && !slot.a) slot.a = r;
    if (r.submitted_by === 'team_b' && !slot.b) slot.b = r;
  }
  return out;
}

// Cached: announcements are only ever written and then revalidated, never re-read in the request.
export const listAnnouncements = cache(async (sb: SupabaseClient, tournamentId: string): Promise<AnnouncementRow[]> => {
  return must(
    await sb.from('announcements').select('*').eq('tournament_id', tournamentId)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    'announcements',
  ) as AnnouncementRow[];
});

export interface TournamentBundle {
  tournament: TournamentRow;
  pools: PoolRow[];
  teams: TeamWithPlayers[];
  matches: MatchRow[];
  games: GameRow[];
  submissions: SubmissionRow[];
  announcements: AnnouncementRow[];
  ratings: RatingRow[];
}

export async function loadTournamentBundle(sb: SupabaseClient, slug: string): Promise<TournamentBundle | null> {
  const tournament = await getTournamentBySlug(sb, slug);
  if (!tournament) return null;
  const [pools, teams, matches, games, submissions, announcements, ratings] = await Promise.all([
    listPools(sb, tournament.id), listTeamsWithPlayers(sb, tournament.id), listMatches(sb, tournament.id), listGames(sb, tournament.id),
    listSubmissions(sb, tournament.id), listAnnouncements(sb, tournament.id), listPlayerRatings(sb, tournament.id),
  ]);
  return { tournament, pools, teams, matches, games, submissions, announcements, ratings };
}
