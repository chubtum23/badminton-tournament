'use server';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { rollback, validateGame } from '@tournament/core';
import { listGames, listMatches } from '@/lib/db/queries';
import { matchToRow, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { planResult } from '@/lib/results/apply';
import { applyResultPlan, BLANK_GAME } from '@/lib/results/persist';
import { firstFreeCourt, planGameCourt } from '@/lib/schedule/plan';
import { syncMatchStatus } from '@/lib/schedule/status';

/**
 * Sends one game of a meeting to a court and starts its clock. With no court given it takes the
 * lowest court no running game is holding, which is what an organiser calling the next game wants.
 */
export async function startGame(slug: string, matchId: string, gameNo: number, court: number | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const slots = await listGames(ctx.sb, ctx.tournament.id);
  const chosen = court ?? firstFreeCourt(slots, ctx.tournament.court_count);
  if (chosen === null) return fail('invalid_input', 'Every court is in use');
  const planned = planGameCourt(slots, matchId, gameNo, chosen, ctx.tournament.court_count);
  if ('error' in planned) return fail(planned.error.includes('court must be between') ? 'invalid_input' : 'match_not_editable', planned.error);
  // Repeating the "not yet scored" guard in the filter means a concurrent score entry wins.
  const upd = await ctx.sb.from('games').update(planned)
    .eq('match_id', matchId).eq('game_no', gameNo).is('score_a', null).select('game_no');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'That game changed underneath you; reload');
  await syncMatchStatus(ctx.sb, ctx.tournament.id, matchId);
  revalidateTournament(slug);
  return ok(undefined);
}

/** Takes a game off its court. The clock is thrown away, because the game will start again. */
export async function takeGameOffCourt(slug: string, matchId: string, gameNo: number): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const slots = await listGames(ctx.sb, ctx.tournament.id);
  const planned = planGameCourt(slots, matchId, gameNo, null, ctx.tournament.court_count);
  if ('error' in planned) return fail('match_not_editable', planned.error);
  const upd = await ctx.sb.from('games').update(planned)
    .eq('match_id', matchId).eq('game_no', gameNo).is('score_a', null).select('game_no');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'That game changed underneath you; reload');
  await syncMatchStatus(ctx.sb, ctx.tournament.id, matchId);
  revalidateTournament(slug);
  return ok(undefined);
}

/**
 * Stops the clock on a running game. The countdown is derived from `started_at`, so a stoppage is
 * recorded rather than the clock being rewound: `paused_at` freezes it now, and `resumeGame` folds
 * the length of the stoppage into `paused_ms`.
 */
export async function pauseGame(slug: string, matchId: string, gameNo: number): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const slots = await listGames(ctx.sb, ctx.tournament.id);
  const before = slots.find((g) => g.match_id === matchId && g.game_no === gameNo);
  if (!before) return fail('invalid_input', 'Unknown game');
  if (before.started_at === null) return fail('match_not_editable', 'Only a game on court has a running clock');
  if (before.paused_at !== null) return fail('stale_state', 'That game is already paused');
  // The guards are repeated in the update so a concurrent change loses instead of double-pausing.
  const upd = await ctx.sb.from('games').update({ paused_at: new Date().toISOString() })
    .eq('match_id', matchId).eq('game_no', gameNo).is('paused_at', null).not('started_at', 'is', null).select('game_no');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'That game changed underneath you; reload');
  revalidateTournament(slug);
  return ok(undefined);
}

/** Restarts a paused clock, crediting the whole stoppage back to the game. */
export async function resumeGame(slug: string, matchId: string, gameNo: number): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const slots = await listGames(ctx.sb, ctx.tournament.id);
  const before = slots.find((g) => g.match_id === matchId && g.game_no === gameNo);
  if (!before) return fail('invalid_input', 'Unknown game');
  if (before.paused_at === null) return fail('stale_state', 'That game is not paused');
  const stoppage = Math.max(0, Date.now() - Date.parse(before.paused_at));
  const upd = await ctx.sb.from('games')
    .update({ paused_ms: before.paused_ms + stoppage, paused_at: null })
    .eq('match_id', matchId).eq('game_no', gameNo).eq('paused_at', before.paused_at).select('game_no');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'That game changed underneath you; reload');
  revalidateTournament(slug);
  return ok(undefined);
}

/**
 * Records one game's score. The organiser enters each game of a meeting as it finishes, so this
 * writes a single slot; only the last outstanding game decides the meeting, and that is the call
 * that plans the result and moves the winner on.
 */
export async function saveGameScore(slug: string, matchId: string, gameNo: number, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (!['pools', 'knockout', 'finished'].includes(ctx.tournament.status)) return fail('stale_state', 'The tournament is not in play');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const row = rows.find((r) => r.id === matchId);
  if (!row || row.status === 'pending' || !row.team_a_id || !row.team_b_id) return fail('match_not_editable', 'That meeting cannot take a score yet');
  const settings = settingsFor(ctx.tournament, row.stage);

  const scoreA = Number(String(formData.get('scoreA') ?? '').trim());
  const scoreB = Number(String(formData.get('scoreB') ?? '').trim());
  const timeExpired = formData.get('timeExpired') !== null;
  const check = validateGame(settings, scoreA, scoreB, timeExpired);
  if (!check.ok) return fail('invalid_score', check.reason);

  // Writing the score also takes the game off court: it is finished, so it must not hold a
  // court or keep counting down.
  const upd = await ctx.sb.from('games')
    .update({ score_a: scoreA, score_b: scoreB, time_expired: timeExpired, court: null, started_at: null, paused_at: null, paused_ms: 0 })
    .eq('match_id', matchId).eq('game_no', gameNo).select('game_no');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'That game changed underneath you; reload');

  const slots = (await listGames(ctx.sb, ctx.tournament.id)).filter((g) => g.match_id === matchId);
  const scored = slots.filter((g) => g.score_a !== null && g.score_b !== null);
  if (scored.length < settings.gamesPerMatch) {
    await syncMatchStatus(ctx.sb, ctx.tournament.id, matchId);
    revalidateTournament(slug);
    return ok(undefined);
  }

  // Every game is in: the meeting can be decided and the winner moved on.
  const games = scored.map((g) => ({ gameNo: g.game_no, scoreA: g.score_a!, scoreB: g.score_b!, timeExpired: g.time_expired }));
  const plan = planResult({ settings, matches: rows.map(rowToMatch), matchId, games });
  if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
  const persisted = await applyResultPlan(ctx.sb, { tournamentId: ctx.tournament.id, matchId, rows, plan, tournamentStatus: ctx.tournament.status });
  if (!persisted.ok) return fail(persisted.error, persisted.message);
  revalidateTournament(slug);
  return ok(undefined);
}

/**
 * Rubs out one game's score. The slot row stays: it is part of the meeting whether or not it has
 * been played. A meeting that was already decided has to come undone first, because the winner it
 * sent through the bracket is no longer known — that is what `rollback` computes, and the matches
 * it resets lose their scores the same way (blanked, never deleted).
 */
export async function clearGameScore(slug: string, matchId: string, gameNo: number): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (!['pools', 'knockout', 'finished'].includes(ctx.tournament.status)) return fail('stale_state', 'The tournament is not in play');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const row = rows.find((r) => r.id === matchId);
  if (!row) return fail('invalid_input', 'Unknown match');

  if (row.status === 'done' && row.winner_id !== null) {
    const rb = rollback(rows.map(rowToMatch), matchId);
    const byId = new Map(rb.changed.map((m) => [m.id, m]));
    const undone = rows.map((r) => byId.get(r.id) ?? rowToMatch(r));

    // Claim the meeting against the state we planned from, exactly as applyResultPlan does, so a
    // concurrent edit loses instead of both writes landing half a rollback each.
    const primary = byId.get(matchId);
    if (!primary) return fail('stale_state', 'That meeting changed underneath you; reload');
    const claim = await ctx.sb.from('matches')
      .update({ status: primary.status, winner_id: null, finished_at: null })
      .eq('id', matchId).eq('status', 'done').eq('winner_id', row.winner_id).select('id');
    if (claim.error) return fail('invalid_input', claim.error.message);
    if ((claim.data ?? []).length === 0) return fail('stale_state', 'That meeting changed underneath you; reload');

    for (const m of rb.changed) {
      if (m.id === matchId) continue; // already claimed above
      const mapped = matchToRow(m, ctx.tournament.id);
      const upd = await ctx.sb.from('matches').update({
        team_a_id: mapped.team_a_id, team_b_id: mapped.team_b_id, status: mapped.status,
        winner_id: mapped.winner_id, decided_by: mapped.decided_by, finished_at: null,
      }).eq('id', m.id);
      if (upd.error) return fail('invalid_input', upd.error.message);
    }
    for (const id of rb.resetMatchIds) {
      const blank = await ctx.sb.from('games').update(BLANK_GAME).eq('match_id', id);
      if (blank.error) return fail('invalid_input', blank.error.message);
      const subs = await ctx.sb.from('score_submissions').delete().eq('match_id', id);
      if (subs.error) return fail('invalid_input', subs.error.message);
    }

    // Undoing a result can only ever un-finish a tournament, never finish one.
    const terminal = undone.find((m) => m.stage === 'knockout' && m.nextMatchId === null);
    if (ctx.tournament.status === 'finished' && terminal?.status !== 'done') {
      const reopen = await ctx.sb.from('tournaments').update({ status: 'knockout' }).eq('id', ctx.tournament.id).eq('status', 'finished');
      if (reopen.error) return fail('invalid_input', reopen.error.message);
    }
  }

  const cleared = await ctx.sb.from('games').update(BLANK_GAME).eq('match_id', matchId).eq('game_no', gameNo).select('game_no');
  if (cleared.error) return fail('invalid_input', cleared.error.message);
  if ((cleared.data ?? []).length === 0) return fail('stale_state', 'That game changed underneath you; reload');
  await syncMatchStatus(ctx.sb, ctx.tournament.id, matchId);
  revalidateTournament(slug);
  return ok(undefined);
}
