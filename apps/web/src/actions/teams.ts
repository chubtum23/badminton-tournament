'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { parseTeamLines } from '@/lib/teams/parse';

export async function addTeams(slug: string, formData: FormData): Promise<ActionResult<{ added: number }>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Teams can only be added during setup');
  const { teams, problems } = parseTeamLines(String(formData.get('lines') ?? ''));
  if (problems.length) return fail('invalid_input', problems.join('; '));
  if (teams.length === 0) return fail('invalid_input', 'No teams entered');

  for (const t of teams) {
    const team = await ctx.sb.from('teams').insert({ tournament_id: ctx.tournament.id, name: t.name.slice(0, 40) }).select('id').single();
    if (team.error) return fail('invalid_input', team.error.message);
    const players = await ctx.sb.from('players')
      .insert(t.players.map((name) => ({ tournament_id: ctx.tournament.id, name }))).select('id');
    if (players.error) return fail('invalid_input', players.error.message);
    const links = await ctx.sb.from('team_players').insert(players.data.map((p) => ({ team_id: team.data.id, player_id: p.id })));
    if (links.error) return fail('invalid_input', links.error.message);
  }
  revalidatePath(`/admin/${slug}`);
  return ok({ added: teams.length });
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
  const del = await ctx.sb.from('teams').delete().eq('id', teamId).eq('tournament_id', ctx.tournament.id);
  if (del.error) return fail('invalid_input', del.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok(undefined);
}

export async function regenerateToken(slug: string, teamId: string): Promise<ActionResult<string>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const res = await ctx.sb.rpc('regenerate_team_token', { team: teamId });
  if (res.error) return fail('not_admin', res.error.message);
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
