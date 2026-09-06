'use server';
import { revalidatePath } from 'next/cache';
import type { Game } from '@tournament/core';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { listMatches } from '@/lib/db/queries';
import { matchToRow, rowToMatch, settingsFromTournament } from '@/lib/db/mappers';
import { planCourt, planResult } from '@/lib/results/apply';

function revalidate(slug: string) {
  for (const p of [`/admin/${slug}/matches`, `/admin/${slug}/bracket`, `/t/${slug}`, `/t/${slug}/pools`, `/t/${slug}/bracket`]) revalidatePath(p);
}

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
  revalidate(slug);
  return ok(undefined);
}

/** Parses game{n}a / game{n}b fields; stops at the first blank pair. */
export async function gamesFromForm(formData: FormData, maxGames: number): Promise<Game[]> {
  const games: Game[] = [];
  for (let n = 1; n <= maxGames; n++) {
    const a = String(formData.get(`game${n}a`) ?? '').trim();
    const b = String(formData.get(`game${n}b`) ?? '').trim();
    if (a === '' && b === '') break;
    games.push({ gameNo: n, scoreA: Number(a), scoreB: Number(b) });
  }
  return games;
}

export async function enterResult(slug: string, matchId: string, games: Game[]): Promise<ActionResult<{ winnerId: string }>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'pools' && ctx.tournament.status !== 'knockout') return fail('stale_state', 'Tournament is not in play');
  const rows = await listMatches(ctx.sb, ctx.tournament.id);
  const plan = planResult({ settings: settingsFromTournament(ctx.tournament), matches: rows.map(rowToMatch), matchId, games });
  if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);

  // Claim the edited match: the update only matches if it is still in the state we planned against.
  const before = rows.find((r) => r.id === matchId)!;
  const primary = plan.updates.find((m) => m.id === matchId)!;
  const primaryRow = matchToRow(primary, ctx.tournament.id);
  let claimQuery = ctx.sb.from('matches')
    .update({ team_a_id: primaryRow.team_a_id, team_b_id: primaryRow.team_b_id, court: primaryRow.court, status: primaryRow.status, winner_id: primaryRow.winner_id })
    .eq('id', matchId).eq('status', before.status);
  claimQuery = before.winner_id === null ? claimQuery.is('winner_id', null) : claimQuery.eq('winner_id', before.winner_id);
  const claim = await claimQuery.select('id');
  if (claim.error) return fail('invalid_input', claim.error.message);
  if ((claim.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');

  for (const id of plan.clearGamesFor) {
    const del = await ctx.sb.from('games').delete().eq('match_id', id);
    if (del.error) return fail('invalid_input', del.error.message);
    const subs = await ctx.sb.from('score_submissions').delete().eq('match_id', id);
    if (subs.error) return fail('invalid_input', subs.error.message);
  }
  // The primary match is claimed (and marked done) before its own games are written below; a
  // crash in between leaves a done match briefly without games, which is acceptable and
  // self-healing on the next edit (enterResult always deletes and re-inserts a match's games).
  const delOwn = await ctx.sb.from('games').delete().eq('match_id', matchId);
  if (delOwn.error) return fail('invalid_input', delOwn.error.message);
  const insGames = await ctx.sb.from('games').insert(plan.gamesToWrite.map((g) => ({ match_id: matchId, game_no: g.gameNo, score_a: g.scoreA, score_b: g.scoreB })));
  if (insGames.error) return fail('invalid_input', insGames.error.message);
  for (const m of plan.updates) {
    if (m.id === matchId) continue; // already claimed above
    const row = matchToRow(m, ctx.tournament.id);
    const upd = await ctx.sb.from('matches').update({
      team_a_id: row.team_a_id, team_b_id: row.team_b_id, court: row.court, status: row.status, winner_id: row.winner_id,
    }).eq('id', m.id);
    if (upd.error) return fail('invalid_input', upd.error.message);
  }
  if (plan.tournamentFinished) {
    const fin = await ctx.sb.from('tournaments').update({ status: 'finished' }).eq('id', ctx.tournament.id).eq('status', 'knockout');
    if (fin.error) return fail('invalid_input', fin.error.message);
  }
  revalidate(slug);
  return ok({ winnerId: plan.winnerId });
}
