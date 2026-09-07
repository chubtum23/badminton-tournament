'use server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { listGames, listMatches, listPools, listTeams } from '@/lib/db/queries';
import { matchToRow } from '@/lib/db/mappers';
import { planKnockout } from '@/lib/bracket/plan';
import { knockoutInput } from '@/lib/bracket/input';

export async function startKnockout(slug: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'pools') return fail('stale_state', 'Knockout can only start from the pool stage');
  const t = ctx.tournament;
  const [pools, teams, matchRows, gameRows] = await Promise.all([
    listPools(ctx.sb, t.id), listTeams(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id),
  ]);
  if (matchRows.some((m) => m.stage === 'knockout')) return fail('stale_state', 'Knockout already started');
  const plan = planKnockout({
    ...knockoutInput({ tournament: t, pools, teams, matchRows, gameRows }),
    newId: randomUUID,
  });
  if ('error' in plan) return fail('invalid_input', plan.error);

  // Claim the pools -> knockout transition first (and verify a row was actually
  // affected) so a racing or retried start request can't pass the earlier
  // `status === 'pools'` guard twice and insert a second set of bracket matches:
  // Supabase returns no error when an update's filter matches zero rows. This
  // mirrors how lockPools in src/actions/pools.ts claims its status transition
  // before inserting matches.
  const claim = await ctx.sb.from('tournaments').update({ status: 'knockout' })
    .eq('id', t.id).eq('status', 'pools').select('id');
  if (claim.error) return fail('invalid_input', claim.error.message);
  if ((claim.data ?? []).length === 0) return fail('stale_state', 'Knockout was already started');

  // Insert later rounds first so next_match_id always references an existing row.
  const rounds = [...new Set(plan.matches.map((m) => m.round ?? 0))].sort((a, b) => b - a);
  for (const r of rounds) {
    const rows = plan.matches.filter((m) => m.round === r).map((m) => matchToRow(m, t.id));
    const ins = await ctx.sb.from('matches').insert(rows);
    if (ins.error) return fail('invalid_input', ins.error.message);
  }
  for (const p of [`/admin/${slug}`, `/admin/${slug}/bracket`, `/admin/${slug}/matches`, `/t/${slug}`, `/t/${slug}/bracket`]) revalidatePath(p);
  return ok(undefined);
}

/**
 * Swaps one side of a knockout match for another team, for when a qualifier withdraws or the
 * organiser corrects who came through. Only matches that have not been played can be changed;
 * the update is conditional on the side still holding the team we planned against.
 */
export async function replaceTeamInMatch(slug: string, matchId: string, side: 'a' | 'b', teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (side !== 'a' && side !== 'b') return fail('invalid_input', 'Pick a side');
  const [teams, rows] = await Promise.all([listTeams(ctx.sb, ctx.tournament.id), listMatches(ctx.sb, ctx.tournament.id)]);
  const match = rows.find((r) => r.id === matchId);
  if (!match) return fail('invalid_input', 'Unknown match');
  if (match.stage !== 'knockout') return fail('invalid_input', 'Only knockout matches can have a team replaced');
  if (match.status === 'done') return fail('match_not_editable', 'This match already has a result');
  if (!teams.some((t) => t.id === teamId)) return fail('invalid_input', 'Unknown team');
  const current = side === 'a' ? match.team_a_id : match.team_b_id;
  const other = side === 'a' ? match.team_b_id : match.team_a_id;
  if (other === teamId) return fail('invalid_input', 'That team is already on the other side of this match');
  if (current === teamId) return ok(undefined);

  const column = side === 'a' ? 'team_a_id' : 'team_b_id';
  // A match with both sides known is playable; one still empty stays pending.
  const status = other === null ? match.status : 'ready';
  let q = ctx.sb.from('matches').update({ [column]: teamId, status, court: null, started_at: null })
    .eq('id', matchId).eq('status', match.status);
  q = current === null ? q.is(column, null) : q.eq(column, current);
  const upd = await q.select('id');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');
  revalidateTournament(slug);
  return ok(undefined);
}
