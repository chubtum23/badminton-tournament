'use server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { planLock, planPools } from '@/lib/pools/plan';
import { listPools, listTeams } from '@/lib/db/queries';
import { matchToRow } from '@/lib/db/mappers';

export async function generatePools(slug: string, poolCount: number): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Pools can only be generated during setup');
  const teams = await listTeams(ctx.sb, ctx.tournament.id);
  if (!Number.isInteger(poolCount) || poolCount < 1 || poolCount > teams.length) return fail('invalid_input', 'Pool count must be between 1 and the number of teams');

  // Replace any earlier draft
  const del = await ctx.sb.from('pools').delete().eq('tournament_id', ctx.tournament.id);
  if (del.error) return fail('invalid_input', del.error.message);

  const { pools } = planPools(teams.map((t) => t.id), poolCount, Math.random);
  for (const p of pools) {
    const ins = await ctx.sb.from('pools').insert({ tournament_id: ctx.tournament.id, name: p.name, position: p.position }).select('id').single();
    if (ins.error) return fail('invalid_input', ins.error.message);
    for (const [order, teamId] of p.teamIds.entries()) {
      const upd = await ctx.sb.from('teams').update({ pool_id: ins.data.id, pool_order: order }).eq('id', teamId);
      if (upd.error) return fail('invalid_input', upd.error.message);
    }
  }
  revalidatePath(`/admin/${slug}/pools`);
  return ok(undefined);
}

export async function moveTeam(slug: string, teamId: string, poolId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Pools are locked');
  const pools = await listPools(ctx.sb, ctx.tournament.id);
  if (!pools.some((p) => p.id === poolId)) return fail('invalid_input', 'Unknown pool');
  const upd = await ctx.sb.from('teams').update({ pool_id: poolId }).eq('id', teamId).eq('tournament_id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidatePath(`/admin/${slug}/pools`);
  return ok(undefined);
}

export async function lockPools(slug: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Already locked');
  const [pools, teams] = await Promise.all([listPools(ctx.sb, ctx.tournament.id), listTeams(ctx.sb, ctx.tournament.id)]);
  if (pools.length === 0) return fail('invalid_input', 'Generate pools first');
  const unassigned = teams.filter((t) => t.pool_id === null);
  if (unassigned.length) return fail('invalid_input', `${unassigned.length} team(s) not in a pool`);
  const grouped = pools.map((p) => ({ id: p.id, teamIds: teams.filter((t) => t.pool_id === p.id).map((t) => t.id) }));
  const tooSmall = grouped.filter((g) => g.teamIds.length < 2);
  if (tooSmall.length) return fail('invalid_input', 'Every pool needs at least 2 teams');
  const fewerThanAdvance = grouped.filter((g) => g.teamIds.length < ctx.tournament.advance_per_pool);
  if (fewerThanAdvance.length) return fail('invalid_input', `Every pool needs at least ${ctx.tournament.advance_per_pool} teams to advance ${ctx.tournament.advance_per_pool}`);

  const matches = planLock(grouped, randomUUID);
  const ins = await ctx.sb.from('matches').insert(matches.map((m) => matchToRow(m, ctx.tournament.id)));
  if (ins.error) return fail('invalid_input', ins.error.message);
  const lock = await ctx.sb.from('pools').update({ locked: true }).eq('tournament_id', ctx.tournament.id);
  if (lock.error) return fail('invalid_input', lock.error.message);
  const st = await ctx.sb.from('tournaments').update({ status: 'pools' }).eq('id', ctx.tournament.id).eq('status', 'setup');
  if (st.error) return fail('invalid_input', st.error.message);
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/t/${slug}`);
  return ok(undefined);
}
