'use server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { planLock, planPools } from '@/lib/pools/plan';
import { listMatches, listPools, listTeams } from '@/lib/db/queries';
import type { MatchRow } from '@/lib/db/types';
import { matchToRow } from '@/lib/db/mappers';
import { revalidateTournament } from './revalidate';

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
  // Append to the end of the target pool rather than colliding with whatever holds pool_order 0.
  const last = await ctx.sb.from('teams').select('pool_order')
    .eq('tournament_id', ctx.tournament.id).eq('pool_id', poolId)
    .order('pool_order', { ascending: false }).limit(1).maybeSingle();
  if (last.error) return fail('invalid_input', last.error.message);
  const pool_order = (last.data?.pool_order ?? -1) + 1;
  const upd = await ctx.sb.from('teams').update({ pool_id: poolId, pool_order }).eq('id', teamId).eq('tournament_id', ctx.tournament.id);
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
  if (fewerThanAdvance.length) return fail('invalid_input', `Every pool needs at least ${ctx.tournament.advance_per_pool} teams because ${ctx.tournament.advance_per_pool} advance from each pool`);
  if (pools.every((p) => p.locked === true)) return fail('stale_state', 'Pools were already locked');

  // Claim the setup -> pools transition first (and verify a row was actually
  // affected) so a racing or retried lock request can't pass the earlier
  // `status === 'setup'` guard twice and insert a second set of matches:
  // Supabase returns no error when an update's filter matches zero rows.
  const claim = await ctx.sb.from('tournaments').update({ status: 'pools' })
    .eq('id', ctx.tournament.id).eq('status', 'setup').select('id');
  if (claim.error) return fail('invalid_input', claim.error.message);
  if ((claim.data ?? []).length === 0) return fail('stale_state', 'Pools were already locked');

  const matches = planLock(grouped, randomUUID);
  const ins = await ctx.sb.from('matches').insert(matches.map((m) => matchToRow(m, ctx.tournament.id)));
  if (ins.error) return fail('invalid_input', ins.error.message);
  const lock = await ctx.sb.from('pools').update({ locked: true }).eq('tournament_id', ctx.tournament.id);
  if (lock.error) return fail('invalid_input', lock.error.message);
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/t/${slug}`);
  return ok(undefined);
}

/**
 * Records a men's doubles playoff between two teams of one pool. The match is a real match with
 * its own result entry; poolStandings uses a done playoff to separate exactly those two teams,
 * and it never counts towards played, points or score difference.
 */
export async function createPlayoff(slug: string, poolId: string, teamXId: string, teamYId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'pools') return fail('stale_state', 'Playoffs can only be recorded during the pool stage');
  if (teamXId === teamYId) return fail('invalid_input', 'Pick two different teams');
  const [pools, teams, matchRows] = await Promise.all([
    listPools(ctx.sb, ctx.tournament.id), listTeams(ctx.sb, ctx.tournament.id), listMatches(ctx.sb, ctx.tournament.id),
  ]);
  if (!pools.some((p) => p.id === poolId)) return fail('invalid_input', 'Unknown pool');
  const inPool = (id: string) => teams.some((t) => t.id === id && t.pool_id === poolId);
  if (!inPool(teamXId) || !inPool(teamYId)) return fail('invalid_input', 'Both teams must be in this pool');
  const playoffs = matchRows.filter((m) => m.stage === 'playoff' && m.pool_id === poolId);
  const between = (m: MatchRow) => (m.team_a_id === teamXId && m.team_b_id === teamYId) || (m.team_a_id === teamYId && m.team_b_id === teamXId);
  if (playoffs.some((m) => between(m) && m.status !== 'done')) return fail('stale_state', 'A playoff between these teams is already waiting to be played');

  const ins = await ctx.sb.from('matches').insert({
    tournament_id: ctx.tournament.id, stage: 'playoff', pool_id: poolId, round: null,
    // Playoff slots start at 101 so they sort after the pool's scheduled matches.
    slot: 100 + playoffs.length + 1,
    team_a_id: teamXId, team_b_id: teamYId, court: null, status: 'ready',
    winner_id: null, decided_by: 'played', next_match_id: null, next_match_side: null,
  });
  if (ins.error) return fail('invalid_input', ins.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

/**
 * Freezes a pool's finishing order to the organiser's decision. `orderedTeamIds` must be exactly
 * the pool's teams; positions are stored 1-based on the teams themselves.
 */
export async function setManualOrder(slug: string, poolId: string, orderedTeamIds: string[]): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'pools') return fail('stale_state', 'The finishing order can only be set during the pool stage');
  const [pools, teams] = await Promise.all([listPools(ctx.sb, ctx.tournament.id), listTeams(ctx.sb, ctx.tournament.id)]);
  if (!pools.some((p) => p.id === poolId)) return fail('invalid_input', 'Unknown pool');
  const poolTeamIds = teams.filter((t) => t.pool_id === poolId).map((t) => t.id);
  const unique = new Set(orderedTeamIds);
  if (orderedTeamIds.length !== poolTeamIds.length || unique.size !== orderedTeamIds.length || !orderedTeamIds.every((id) => poolTeamIds.includes(id))) {
    return fail('invalid_input', 'Give every team in the pool a different position');
  }
  for (const [i, teamId] of orderedTeamIds.entries()) {
    const upd = await ctx.sb.from('teams').update({ pool_rank_override: i + 1 })
      .eq('id', teamId).eq('tournament_id', ctx.tournament.id).eq('pool_id', poolId);
    if (upd.error) return fail('invalid_input', upd.error.message);
  }
  revalidateTournament(slug);
  return ok(undefined);
}

/** Drops the organiser's order so the pool is ranked by results again. */
export async function clearManualOrder(slug: string, poolId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'pools') return fail('stale_state', 'The finishing order can only be changed during the pool stage');
  const upd = await ctx.sb.from('teams').update({ pool_rank_override: null })
    .eq('tournament_id', ctx.tournament.id).eq('pool_id', poolId);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}
