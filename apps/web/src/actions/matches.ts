'use server';
import type { Game } from '@tournament/core';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { listMatches, listSubmissions } from '@/lib/db/queries';
import { rowToMatch, settingsFor } from '@/lib/db/mappers';
import { planAward, planCourt, planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';
import { gamesFromForm } from '@/lib/results/form';

export async function assignCourt(slug: string, matchId: string, court: number | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const planned = planCourt(rows.map(rowToMatch), matchId, court, ctx.tournament.court_count);
  if ('error' in planned) return fail(planned.error.includes('court must be between') ? 'invalid_input' : 'match_not_editable', planned.error);
  const before = rows.find((r) => r.id === matchId)!;
  const update: Record<string, unknown> = { court: planned.court, status: planned.status };
  // The clock starts when the match first reaches a court; moving an already-live match to a
  // different court must not restart it, and taking it off court clears the stamp.
  if (planned.status === 'live') {
    if (before.status !== 'live') update.started_at = new Date().toISOString();
  } else {
    update.started_at = null;
  }
  const upd = await ctx.sb.from('matches').update(update)
    .eq('id', matchId).eq('status', before.status).select('id');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');
  revalidateTournament(slug);
  return ok(undefined);
}

/**
 * Puts a match on court right now. With no court given it takes the lowest-numbered court that no
 * live match is holding, which is what an organiser calling the next match actually wants.
 */
export async function startNow(slug: string, matchId: string, court?: number | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (court !== undefined && court !== null) return assignCourt(slug, matchId, court);
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const busy = new Set(rows.filter((r) => r.status === 'live' && r.id !== matchId && r.court !== null).map((r) => r.court));
  const chosen = Array.from({ length: ctx.tournament.court_count }, (_, i) => i + 1).find((c) => !busy.has(c));
  if (chosen === undefined) return fail('invalid_input', 'All courts are busy');
  return assignCourt(slug, matchId, chosen);
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
  // Each stage can carry its own rules, so the settings come from the match being scored.
  const settings = settingsFor(ctx.tournament, rows.find((r) => r.id === matchId)?.stage ?? 'pool');
  const plan = planResult({ settings, matches: rows.map(rowToMatch), matchId, games });
  if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);

  const persisted = await applyResultPlan(ctx.sb, {
    tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status, decidedBy: 'played',
  });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok({ winnerId: plan.winnerId });
}

/**
 * Form-friendly wrapper for the Matches screen: the games are parsed here, against the settings of
 * the match's own stage, so the client form only has to post its fields.
 */
export async function enterResultForm(slug: string, formData: FormData): Promise<ActionResult<{ winnerId: string }>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const matchId = String(formData.get('matchId') ?? '');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const row = rows.find((r) => r.id === matchId);
  if (!row) return fail('invalid_input', 'Unknown match');
  return enterResult(slug, matchId, gamesFromForm(formData, settingsFor(ctx.tournament, row.stage).gamesPerMatch));
}

/** Accept one team's submitted games as the result. */
export async function confirmSubmission(slug: string, matchId: string, submissionId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  // Same window as enterResult: 'finished' stays editable so a wrong result can be corrected.
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
  // Same window as enterResult: 'finished' stays editable so a wrong result can be corrected.
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
