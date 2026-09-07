'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { parseTeamLines } from '@/lib/teams/parse';
import { listMatches } from '@/lib/db/queries';
import type { MatchRow } from '@/lib/db/types';
import { revalidateTournament } from './revalidate';
import { awardMatch } from './matches';

export async function addTeams(slug: string, formData: FormData): Promise<ActionResult<{ added: number }>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Teams can only be added during setup');
  const { teams, problems } = parseTeamLines(String(formData.get('lines') ?? ''));
  if (problems.length) return fail('invalid_input', problems.join('; '));
  if (teams.length === 0) return fail('invalid_input', 'No teams entered');

  // One transaction: a failure part-way through must not leave half-imported teams behind.
  const res = await ctx.sb.rpc('add_teams', { p_tournament: ctx.tournament.id, p_teams: teams });
  if (res.error) return fail(res.error.code === '42501' ? 'not_admin' : 'invalid_input', res.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok({ added: Number(res.data ?? teams.length) });
}

export async function setSeed(slug: string, teamId: string, seed: number | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (seed !== null && (!Number.isInteger(seed) || seed < 1 || seed > 64)) return fail('invalid_input', 'seed must be 1-64');
  const upd = await ctx.sb.from('teams').update({ seed }).eq('id', teamId).eq('tournament_id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok(undefined);
}

export async function deleteTeam(slug: string, teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Teams can only be removed during setup');
  // delete_team() also removes the team's players, which nothing else references.
  const del = await ctx.sb.rpc('delete_team', { p_team: teamId });
  if (del.error) return fail(del.error.code === '42501' ? 'not_admin' : 'invalid_input', del.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok(undefined);
}

export async function regenerateToken(slug: string, teamId: string): Promise<ActionResult<string>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const res = await ctx.sb.rpc('regenerate_team_token', { team: teamId });
  // 42501 is the insufficient_privilege raised by regenerate_team_token(); anything else is a
  // real database failure and should not be reported to the admin as a permissions problem.
  if (res.error) return fail(res.error.code === '42501' ? 'not_admin' : 'invalid_input', res.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok(res.data as string);
}

export async function getEditTokens(slug: string): Promise<Record<string, string>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return {};
  const res = await ctx.sb.rpc('team_edit_tokens', { t: ctx.tournament.id });
  const out: Record<string, string> = {};
  for (const r of (res.data ?? []) as Array<{ team_id: string; edit_token: string }>) out[r.team_id] = r.edit_token;
  return out;
}

/**
 * Marks a team as withdrawn and forfeits every match of theirs that is still open with a known
 * opponent. Matches still waiting on an opponent (pending, one side empty) are left alone: the
 * bracket fills them later, and the organiser can award or replace then.
 */
export async function withdrawTeam(slug: string, teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  // Conditional on the flag so two clicks cannot forfeit the same matches twice.
  const upd = await ctx.sb.from('teams').update({ withdrawn: true })
    .eq('id', teamId).eq('tournament_id', ctx.tournament.id).eq('withdrawn', false).select('id');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'Team not found or already withdrawn');

  const open: MatchRow['status'][] = ['ready', 'live', 'submitted', 'disputed'];
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const problems: string[] = [];
  for (const m of rows) {
    if (m.team_a_id !== teamId && m.team_b_id !== teamId) continue;
    if (!open.includes(m.status) || m.team_a_id === null || m.team_b_id === null) continue;
    const opponent = m.team_a_id === teamId ? m.team_b_id : m.team_a_id;
    const r = await awardMatch(slug, m.id, opponent, 'forfeit');
    if (!r.ok) problems.push(r.message ?? r.error);
  }
  revalidateTournament(slug);
  if (problems.length) return fail('invalid_input', `Team withdrawn, but some matches could not be forfeited: ${problems.join('; ')}`);
  return ok(undefined);
}

/** Clears the withdrawn flag. Matches already forfeited stay forfeited; edit them individually. */
export async function reinstateTeam(slug: string, teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const upd = await ctx.sb.from('teams').update({ withdrawn: false })
    .eq('id', teamId).eq('tournament_id', ctx.tournament.id).select('id');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('invalid_input', 'Unknown team');
  revalidateTournament(slug);
  return ok(undefined);
}
