import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnnouncementRow, GameRow, MatchRow, PlayerRow, PoolRow, SubmissionRow, TeamRow, TournamentRow } from './types';
import { TEAM_PUBLIC_COLUMNS } from './types';

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: no data`);
  return res.data;
}

export async function getTournamentBySlug(sb: SupabaseClient, slug: string): Promise<TournamentRow | null> {
  const res = await sb.from('tournaments').select('*').eq('slug', slug).maybeSingle();
  if (res.error) throw new Error(`tournament: ${res.error.message}`);
  return (res.data as TournamentRow | null) ?? null;
}

export async function listPools(sb: SupabaseClient, tournamentId: string): Promise<PoolRow[]> {
  return must(await sb.from('pools').select('*').eq('tournament_id', tournamentId).order('position'), 'pools') as PoolRow[];
}

export async function listTeams(sb: SupabaseClient, tournamentId: string): Promise<TeamRow[]> {
  return must(
    await sb.from('teams').select(TEAM_PUBLIC_COLUMNS).eq('tournament_id', tournamentId).order('pool_order').order('name'),
    'teams',
  ) as TeamRow[];
}

export async function listMatches(sb: SupabaseClient, tournamentId: string): Promise<MatchRow[]> {
  return must(
    // stage descending because 'pool' > 'knockout' alphabetically and pool matches come first
    // chronologically; pool rows have a null round, so nullsFirst keeps them ahead of round 1.
    await sb.from('matches').select('*').eq('tournament_id', tournamentId)
      .order('stage', { ascending: false }).order('round', { nullsFirst: true }).order('slot'),
    'matches',
  ) as MatchRow[];
}

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
  players: PlayerRow[];
}

export async function listTeamsWithPlayers(sb: SupabaseClient, tournamentId: string): Promise<TeamWithPlayers[]> {
  const teams = await listTeams(sb, tournamentId);
  const links = must(
    await sb.from('team_players').select('team_id, players(id, tournament_id, name)').in('team_id', teams.map((t) => t.id)),
    'team_players',
  ) as unknown as Array<{ team_id: string; players: PlayerRow | null }>;
  const byTeam = new Map<string, PlayerRow[]>();
  for (const l of links) if (l.players) (byTeam.get(l.team_id) ?? byTeam.set(l.team_id, []).get(l.team_id)!).push(l.players);
  return teams.map((t) => ({ ...t, players: byTeam.get(t.id) ?? [] }));
}

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

export async function listAnnouncements(sb: SupabaseClient, tournamentId: string): Promise<AnnouncementRow[]> {
  return must(
    await sb.from('announcements').select('*').eq('tournament_id', tournamentId)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    'announcements',
  ) as AnnouncementRow[];
}

export interface TournamentBundle {
  tournament: TournamentRow;
  pools: PoolRow[];
  teams: TeamRow[];
  matches: MatchRow[];
  games: GameRow[];
  submissions: SubmissionRow[];
  announcements: AnnouncementRow[];
}

export async function loadTournamentBundle(sb: SupabaseClient, slug: string): Promise<TournamentBundle | null> {
  const tournament = await getTournamentBySlug(sb, slug);
  if (!tournament) return null;
  const [pools, teams, matches, games, submissions, announcements] = await Promise.all([
    listPools(sb, tournament.id), listTeams(sb, tournament.id), listMatches(sb, tournament.id), listGames(sb, tournament.id),
    listSubmissions(sb, tournament.id), listAnnouncements(sb, tournament.id),
  ]);
  return { tournament, pools, teams, matches, games, submissions, announcements };
}
