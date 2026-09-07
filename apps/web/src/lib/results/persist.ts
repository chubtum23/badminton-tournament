import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionError } from '@/actions/errors';
import type { MatchRow, TournamentStatus } from '@/lib/db/types';
import { matchToRow } from '@/lib/db/mappers';
import type { ResultPlan } from './apply';

export type PersistResult = { ok: true } | { ok: false; error: ActionError; message: string };

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
    team_a_id: primaryRow.team_a_id, team_b_id: primaryRow.team_b_id, court: primaryRow.court,
    status: primaryRow.status, winner_id: primaryRow.winner_id, decided_by: input.decidedBy ?? 'played',
    // The match is leaving court, so its clock stops with it — pause state included, so a
    // later restart begins clean.
    started_at: null, paused_at: null, paused_ms: 0,
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
    const del = await sb.from('games').delete().eq('match_id', id);
    if (del.error) return fail('invalid_input', del.error.message);
    const subs = await sb.from('score_submissions').delete().eq('match_id', id);
    if (subs.error) return fail('invalid_input', subs.error.message);
  }
  // The primary match is claimed (and marked done) before its own games are written below; a
  // crash in between leaves a done match briefly without games, which is acceptable and
  // self-healing on the next edit (this routine always deletes and re-inserts a match's games).
  const delOwn = await sb.from('games').delete().eq('match_id', matchId);
  if (delOwn.error) return fail('invalid_input', delOwn.error.message);
  // ADDITION 1: a confirmed result supersedes any pending submissions for this match.
  const delOwnSubs = await sb.from('score_submissions').delete().eq('match_id', matchId);
  if (delOwnSubs.error) return fail('invalid_input', delOwnSubs.error.message);
  const insGames = await sb.from('games').insert(plan.gamesToWrite.map((g) => ({ match_id: matchId, game_no: g.gameNo, score_a: g.scoreA, score_b: g.scoreB, time_expired: g.timeExpired ?? false })));
  if (insGames.error) return fail('invalid_input', insGames.error.message);

  for (const m of plan.updates) {
    if (m.id === matchId) continue; // already claimed above
    const row = matchToRow(m, tournamentId);
    const prev = rows.find((r) => r.id === m.id);
    const wasAlreadyDone = prev?.status === 'done';
    const update: Record<string, unknown> = {
      team_a_id: row.team_a_id, team_b_id: row.team_b_id, court: row.court, status: row.status,
      winner_id: row.winner_id, decided_by: row.decided_by,
    };
    // A downstream match rolled off court (or reset to pending) has no running clock.
    if (row.status !== 'live') { update.started_at = null; update.paused_at = null; update.paused_ms = 0; }
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
