'use server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { listGames, listMatches, listPools, listTeams } from '@/lib/db/queries';
import { gamesByMatch, matchToRow, rowToMatch, teamRefs } from '@/lib/db/mappers';
import { planKnockout } from '@/lib/bracket/plan';

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
    pools: pools.map((p) => ({ id: p.id, name: p.name })),
    teams: teamRefs(teams),
    teamPoolIds: Object.fromEntries(teams.map((x) => [x.id, x.pool_id ?? ''])),
    matches: matchRows.map(rowToMatch),
    games: gamesByMatch(gameRows),
    advancePerPool: t.advance_per_pool,
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
