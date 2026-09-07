'use server';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { listMatches, listSubmissions } from '@/lib/db/queries';
import { rowToMatch, settingsFor } from '@/lib/db/mappers';
import { planAward, planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';

/** Accept one team's submitted games as the result. */
export async function confirmSubmission(slug: string, matchId: string, submissionId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  // Same window as saveGameScore: 'finished' stays editable so a wrong result can be corrected.
  if (ctx.tournament.status !== 'pools' && ctx.tournament.status !== 'knockout' && ctx.tournament.status !== 'finished') {
    return fail('stale_state', 'Tournament is not in play');
  }
  const [rows, subs] = await Promise.all([listMatches(ctx.sb, ctx.tournament.id), listSubmissions(ctx.sb, ctx.tournament.id)]);
  const sub = subs.find((s) => s.id === submissionId && s.match_id === matchId);
  if (!sub) return fail('invalid_input', 'Submission not found');
  const settings = settingsFor(ctx.tournament, rows.find((r) => r.id === matchId)?.stage ?? 'pool');
  const plan = planResult({ settings, matches: rows.map(rowToMatch), matchId, games: sub.games });
  if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
  const persisted = await applyResultPlan(ctx.sb, { tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status, decidedBy: 'played' });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok(undefined);
}

/**
 * Hands a match to one team without a score: a walkover, a no-show or an organiser's decision.
 * `kind` is stored on the match so the card can show why it was not played.
 */
export async function awardMatch(slug: string, matchId: string, winnerId: string, kind: 'awarded' | 'forfeit' = 'awarded'): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  // Same window as saveGameScore: 'finished' stays editable so a wrong result can be corrected.
  if (!['pools', 'knockout', 'finished'].includes(ctx.tournament.status)) return fail('stale_state', 'Tournament is not in play');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const plan = planAward({ matches: rows.map(rowToMatch), matchId, winnerId });
  if ('error' in plan) return fail(plan.error, plan.message);
  const persisted = await applyResultPlan(ctx.sb, {
    tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status, decidedBy: kind,
  });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok(undefined);
}
