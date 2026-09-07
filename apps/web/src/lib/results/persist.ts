import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionError } from '@/actions/errors';
import type { MatchRow, TournamentStatus } from '@/lib/db/types';
import { matchToRow } from '@/lib/db/mappers';
import type { ResultPlan } from './apply';

export type PersistResult = { ok: true } | { ok: false; error: ActionError; message: string };

/**
 * A game slot with nothing played on it: no score, no court, no clock. The row itself is never
 * deleted, because a meeting owns its three slots from the moment it is created.
 */
export const BLANK_GAME = {
  score_a: null, score_b: null, time_expired: false, court: null, started_at: null, paused_at: null, paused_ms: 0,
} as const;

/**
 * Writes a ResultPlan. Shared by the admin result action and the participant confirmation path.
 * The caller has already authorised the write and loaded `rows` (all matches of the tournament).
 */
export async function applyResultPlan(
  sb: SupabaseClient,
  input: {
    tournamentId: string; matchId: string; rows: MatchRow[]; plan: ResultPlan;
    tournamentStatus: TournamentStatus; now?: string;
    /** How the edited match was decided; anything but 'played' comes from award/forfeit callers. */
    decidedBy?: MatchRow['decided_by'];
  },
): Promise<PersistResult> {
  const { tournamentId, matchId, rows, plan } = input;
  const now = input.now ?? new Date().toISOString();
  const wasFinished = input.tournamentStatus === 'finished';
  const fail = (error: ActionError, message: string): PersistResult => ({ ok: false, error, message });

  // Claim the edited match: the update only matches if it is still in the state we planned against.
  const before = rows.find((r) => r.id === matchId)!;
  const primary = plan.updates.find((m) => m.id === matchId)!;
  const primaryRow = matchToRow(primary, tournamentId);
  const primaryUpdate: Record<string, unknown> = {
    team_a_id: primaryRow.team_a_id, team_b_id: primaryRow.team_b_id,
    status: primaryRow.status, winner_id: primaryRow.winner_id, decided_by: input.decidedBy ?? 'played',
  };
  if (primaryRow.status === 'done') {
    // Editing an already-done match keeps its original completion time, so "latest results" does
    // not reorder itself every time an organiser corrects a score (same rule as the loop below).
    if (before.status !== 'done') primaryUpdate.finished_at = now;
  } else {
    primaryUpdate.finished_at = null;
  }
  let claimQuery = sb.from('matches')
    .update(primaryUpdate)
    .eq('id', matchId).eq('status', before.status);
  claimQuery = before.winner_id === null ? claimQuery.is('winner_id', null) : claimQuery.eq('winner_id', before.winner_id);
  const claim = await claimQuery.select('id');
  if (claim.error) return fail('invalid_input', claim.error.message);
  if ((claim.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');

  for (const id of plan.clearGamesFor) {
    // The rows are the meeting's game slots, so they stay; only the results go.
    const blank = await sb.from('games').update(BLANK_GAME).eq('match_id', id);
    if (blank.error) return fail('invalid_input', blank.error.message);
    const subs = await sb.from('score_submissions').delete().eq('match_id', id);
    if (subs.error) return fail('invalid_input', subs.error.message);
  }
  // ADDITION 1: a confirmed result supersedes any pending submissions for this match.
  const delOwnSubs = await sb.from('score_submissions').delete().eq('match_id', matchId);
  if (delOwnSubs.error) return fail('invalid_input', delOwnSubs.error.message);
  // Slots this result does not name hold nothing afterwards: awarding a meeting (which writes no
  // games at all) rubs out whatever had been played, and a result shorter than the meeting must
  // not leave a stale game behind it. The rows themselves stay either way.
  const named = plan.gamesToWrite.map((g) => g.gameNo);
  let blankOwn = sb.from('games').update(BLANK_GAME).eq('match_id', matchId);
  if (named.length > 0) blankOwn = blankOwn.not('game_no', 'in', `(${named.join(',')})`);
  const blankedOwn = await blankOwn;
  if (blankedOwn.error) return fail('invalid_input', blankedOwn.error.message);
  // The slots already exist, so the scores are written into them rather than the rows being
  // replaced: deleting them would throw away the court and clock of the meeting's other games,
  // and a meeting must always have its full set of slots.
  for (const g of plan.gamesToWrite) {
    const wrote = await sb.from('games')
      .update({ score_a: g.scoreA, score_b: g.scoreB, time_expired: g.timeExpired ?? false, court: null, started_at: null, paused_at: null, paused_ms: 0 })
      .eq('match_id', matchId).eq('game_no', g.gameNo).select('game_no');
    if (wrote.error) return fail('invalid_input', wrote.error.message);
    if ((wrote.data ?? []).length === 0) return fail('stale_state', 'A game slot is missing; reload');
  }

  for (const m of plan.updates) {
    if (m.id === matchId) continue; // already claimed above
    const row = matchToRow(m, tournamentId);
    const prev = rows.find((r) => r.id === m.id);
    const wasAlreadyDone = prev?.status === 'done';
    const update: Record<string, unknown> = {
      team_a_id: row.team_a_id, team_b_id: row.team_b_id, status: row.status,
      winner_id: row.winner_id, decided_by: row.decided_by,
    };
    if (row.status === 'done') {
      if (!wasAlreadyDone) update.finished_at = now;
    } else {
      update.finished_at = null;
    }
    const upd = await sb.from('matches').update(update).eq('id', m.id);
    if (upd.error) return fail('invalid_input', upd.error.message);
  }

  if (plan.tournamentFinished) {
    const fin = await sb.from('tournaments').update({ status: 'finished' }).eq('id', tournamentId).eq('status', 'knockout');
    if (fin.error) return fail('invalid_input', fin.error.message);
  } else if (wasFinished && !plan.terminalStillDone) {
    const reopen = await sb.from('tournaments').update({ status: 'knockout' }).eq('id', tournamentId).eq('status', 'finished');
    if (reopen.error) return fail('invalid_input', reopen.error.message);
  }
  return { ok: true };
}
