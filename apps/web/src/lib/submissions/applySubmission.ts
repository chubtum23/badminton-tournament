import type { SupabaseClient } from '@supabase/supabase-js';
import type { Game } from '@tournament/core';
import type { ActionError } from '@/actions/errors';
import type { MatchRow, TournamentRow } from '@/lib/db/types';
import { listMatches, listSubmissions, latestByMatch, type LatestSubmissions } from '@/lib/db/queries';
import { rowToMatch, settingsFor } from '@/lib/db/mappers';
import { planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';
import { decideSubmission } from './decide';

export type SubmissionOutcome = 'submitted' | 'confirmed' | 'disputed';

export type ApplySubmissionResult =
  | { ok: true; outcome: SubmissionOutcome }
  | { ok: false; error: ActionError; message: string };

export interface ApplySubmissionInput {
  tournament: TournamentRow;
  teamId: string;
  matchId: string;
  games: Game[];
}

const fail = (error: ActionError, message: string): ApplySubmissionResult => ({ ok: false, error, message });

/**
 * Records one team's score submission and moves the match on.
 *
 * Ordering matters because two teams can submit within milliseconds of each other. The guarded
 * status update is the *claim*: exactly one caller can move a match out of the state it read, so
 * the winner of that race is the one that gets to write its submission row. Inserting the
 * submission first would let both sides land a row and then have one of them fail the status move,
 * leaving the match's status out of step with the submissions that decided it (and, worse, letting
 * a "confirmed" decision be computed from a submission whose own transition never happened).
 *
 * So: for `submitted`/`disputed` we claim the status first and only then insert; for `confirmed`
 * we insert first because `applyResultPlan` is itself the guarded claim and it deletes the match's
 * submissions on success anyway — the row has to exist beforehand only so an admin still sees both
 * sides if the plan fails. A lost race is retried exactly once against freshly read state.
 */
export async function applySubmission(sb: SupabaseClient, input: ApplySubmissionInput): Promise<ApplySubmissionResult> {
  const { tournament, teamId, matchId, games } = input;

  const read = async (): Promise<{ rows: MatchRow[]; latest: LatestSubmissions }> => {
    const [rows, subs] = await Promise.all([listMatches(sb, tournament.id), listSubmissions(sb, tournament.id)]);
    return { rows, latest: latestByMatch(subs) };
  };

  let state = await read();
  let inserted = false;

  // At most two passes: the first against the state we read, the second against a single re-read
  // after losing the race to the other team.
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = state.rows.find((r) => r.id === matchId);
    if (!row) return fail('invalid_input', 'Unknown match');
    const side = row.team_a_id === teamId ? 'a' : row.team_b_id === teamId ? 'b' : null;
    if (!side) return fail('not_your_match', 'Your team is not in this match');
    // Rules are per stage, so they are read from the match, not from the tournament as a whole.
    const settings = settingsFor(tournament, row.stage);

    const decision = decideSubmission({
      settings, match: rowToMatch(row), side, games, latest: state.latest[matchId] ?? {},
    });
    if ('error' in decision) return fail(decision.error, decision.message);

    const insert = async (): Promise<ApplySubmissionResult | null> => {
      if (inserted) return null;
      const ins = await sb.from('score_submissions').insert({
        match_id: matchId, submitted_by: side === 'a' ? 'team_a' : 'team_b', games,
      });
      if (ins.error) return fail('invalid_input', ins.error.message);
      inserted = true;
      return null;
    };

    if (decision.outcome === 'confirmed') {
      const insErr = await insert();
      if (insErr) return insErr;
      const plan = planResult({ settings, matches: state.rows.map(rowToMatch), matchId, games });
      if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
      const persisted = await applyResultPlan(sb, {
        tournamentId: tournament.id, matchId, rows: state.rows, plan, tournamentStatus: tournament.status,
      });
      if (persisted.ok) return { ok: true, outcome: 'confirmed' };
      if (persisted.error !== 'stale_state') return fail(persisted.error, persisted.message);
    } else {
      // Claim the transition before recording the submission (see the note above).
      const upd = await sb.from('matches').update({ status: decision.outcome })
        .eq('id', matchId).eq('status', row.status).select('id');
      if (upd.error) return fail('invalid_input', upd.error.message);
      if ((upd.data ?? []).length > 0) {
        // The claim succeeded, so this submission is the one that caused the transition. A failure
        // here is an unexpected DB error, not a race.
        const insErr = await insert();
        if (insErr) return insErr;
        return { ok: true, outcome: decision.outcome };
      }
    }

    if (attempt === 0) state = await read();
  }
  return fail('stale_state', 'Match changed underneath you; reload');
}
