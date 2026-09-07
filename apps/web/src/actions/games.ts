'use server';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { listGames } from '@/lib/db/queries';
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
