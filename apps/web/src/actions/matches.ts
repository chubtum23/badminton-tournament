'use server';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { listGames, listMatches, listSubmissions } from '@/lib/db/queries';
import { rowToMatch, settingsFor } from '@/lib/db/mappers';
import { planAward, planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';
import { withResultLock } from '@/lib/results/lock';
import { POOL_RESULTS_FROZEN, poolResultsFrozen } from '@/lib/results/freeze';

const busy = (message: string): ActionResult => fail('stale_state', message);

/** Accept one team's submitted games as the result. */
export async function confirmSubmission(slug: string, matchId: string, submissionId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  // Same window as saveGameScore: 'finished' stays editable so a wrong result can be corrected.
  if (ctx.tournament.status !== 'pools' && ctx.tournament.status !== 'knockout' && ctx.tournament.status !== 'finished') {
    return fail('stale_state', 'Tournament is not in play');
  }
  return withResultLock(ctx.sb, ctx.tournament.id, async () => {
    const [rows, subs] = await Promise.all([listMatches(ctx.sb, ctx.tournament.id), listSubmissions(ctx.sb, ctx.tournament.id)]);
    const sub = subs.find((s) => s.id === submissionId && s.match_id === matchId);
    if (!sub) return fail('invalid_input', 'Submission not found');
    const row = rows.find((r) => r.id === matchId);
    if (!row) return fail('invalid_input', 'Unknown match');
    if (poolResultsFrozen(row.stage, ctx.tournament.status)) return fail('match_not_editable', POOL_RESULTS_FROZEN);
    const settings = settingsFor(ctx.tournament, row.stage);
    const plan = planResult({ settings, matches: rows.map(rowToMatch), matchId, games: sub.games });
    if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
    const persisted = await applyResultPlan(ctx.sb, { tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status, decidedBy: 'played' });
    if (!persisted.ok) return fail(persisted.error, persisted.message);
    revalidateTournament(slug);
    return ok(undefined);
  }, busy);
}

/**
 * Hands a match to one team without a score: a walkover, a no-show or an organiser's decision.
 * `kind` is stored on the match so the card can show why it was not played.
 *
 * An award writes no games, so it erases any that were entered. That only happens when the caller
 * says so (`eraseScores`, sent by a button whose warning named how many scores go); otherwise a
 * match with scores on it is refused rather than silently wiped.
 */
export async function awardMatch(
  slug: string, matchId: string, winnerId: string, kind: 'awarded' | 'forfeit' = 'awarded', opts: { eraseScores?: boolean } = {},
): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  // Same window as saveGameScore: 'finished' stays editable so a wrong result can be corrected.
  if (!['pools', 'knockout', 'finished'].includes(ctx.tournament.status)) return fail('stale_state', 'Tournament is not in play');
  return withResultLock(ctx.sb, ctx.tournament.id, async () => {
    const [rows, gameRows] = await Promise.all([listMatches(ctx.sb, ctx.tournament.id), listGames(ctx.sb, ctx.tournament.id)]);
    const row = rows.find((r) => r.id === matchId);
    if (!row) return fail('invalid_input', 'Unknown match');
    if (poolResultsFrozen(row.stage, ctx.tournament.status)) return fail('match_not_editable', POOL_RESULTS_FROZEN);
    const scored = gameRows.filter((g) => g.match_id === matchId && g.score_a !== null).length;
    if (scored > 0 && !opts.eraseScores) {
      return fail('match_not_editable', `This match has ${scored} game score${scored === 1 ? '' : 's'} entered. Clear ${scored === 1 ? 'it' : 'them'} first, or award it from the Matches page, which warns before erasing them.`);
    }
    const plan = planAward({ matches: rows.map(rowToMatch), matchId, winnerId });
    if ('error' in plan) return fail(plan.error, plan.message);
    const persisted = await applyResultPlan(ctx.sb, {
      tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status, decidedBy: kind,
    });
    if (!persisted.ok) return fail(persisted.error, persisted.message);
    revalidateTournament(slug);
    return ok(undefined);
  }, busy);
}
