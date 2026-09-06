'use server';
import type { Game } from '@tournament/core';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { listMatches, listSubmissions } from '@/lib/db/queries';
import { rowToMatch, settingsFromTournament } from '@/lib/db/mappers';
import { planCourt, planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';

export async function assignCourt(slug: string, matchId: string, court: number | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const planned = planCourt(rows.map(rowToMatch), matchId, court, ctx.tournament.court_count);
  if ('error' in planned) return fail(planned.error.includes('court must be between') ? 'invalid_input' : 'match_not_editable', planned.error);
  const before = rows.find((r) => r.id === matchId)!;
  const upd = await ctx.sb.from('matches').update({ court: planned.court, status: planned.status })
    .eq('id', matchId).eq('status', before.status).select('id');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');
  revalidateTournament(slug);
  return ok(undefined);
}

export async function enterResult(slug: string, matchId: string, games: Game[]): Promise<ActionResult<{ winnerId: string }>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  // 'finished' is editable too: a wrong result in the final (or anywhere upstream of it) has to
  // be correctable after the champion was decided.
  if (ctx.tournament.status !== 'pools' && ctx.tournament.status !== 'knockout' && ctx.tournament.status !== 'finished') {
    return fail('stale_state', 'Tournament is not in play');
  }
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const plan = planResult({ settings: settingsFromTournament(ctx.tournament), matches: rows.map(rowToMatch), matchId, games });
  if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);

  const persisted = await applyResultPlan(ctx.sb, {
    tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status,
  });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok({ winnerId: plan.winnerId });
}

/** Accept one team's submitted games as the result. */
export async function confirmSubmission(slug: string, matchId: string, submissionId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const [rows, subs] = await Promise.all([listMatches(ctx.sb, ctx.tournament.id), listSubmissions(ctx.sb, ctx.tournament.id)]);
  const sub = subs.find((s) => s.id === submissionId && s.match_id === matchId);
  if (!sub) return fail('invalid_input', 'Submission not found');
  const plan = planResult({ settings: settingsFromTournament(ctx.tournament), matches: rows.map(rowToMatch), matchId, games: sub.games });
  if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
  const persisted = await applyResultPlan(ctx.sb, { tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok(undefined);
}
