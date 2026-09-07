'use server';
import { currentParticipant } from '@/lib/participant/token';
import { parseProfileForm } from '@/lib/participant/profile';
import { createServiceSupabase } from '@/lib/supabase/service';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { settingsFromTournament } from '@/lib/db/mappers';
import { gamesFromForm } from '@/lib/results/form';
import { applySubmission, type SubmissionOutcome } from '@/lib/submissions/applySubmission';

export async function updateMyTeam(slug: string, formData: FormData): Promise<ActionResult> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to edit your team');
  const parsed = parseProfileForm(formData);
  if (!parsed.ok) return fail('invalid_input', parsed.problems.join('; '));
  const sb = createServiceSupabase();
  const upd = await sb.from('teams').update(parsed.value).eq('id', me.team.id).eq('tournament_id', me.tournament.id).select('id');
  if (upd.error) {
    // The form was already validated, so a DB error here is ours, not the participant's: keep the
    // detail server-side and give the player something actionable.
    console.error('updateMyTeam failed', { slug, teamId: me.team.id, message: upd.error.message });
    return fail('stale_state', 'Could not save; try again');
  }
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'Team not found');
  revalidateTournament(slug);
  return ok(undefined);
}

export async function submitScores(slug: string, matchId: string, formData: FormData): Promise<ActionResult<{ outcome: SubmissionOutcome }>> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to submit scores');
  if (me.tournament.status !== 'pools' && me.tournament.status !== 'knockout') return fail('stale_state', 'Tournament is not in play');
  const sb = createServiceSupabase();
  // Cheap authorisation read before doing any work: the match must belong to this tournament and
  // to this team. applySubmission re-derives the side from its own read of the match rows.
  const row = await sb.from('matches').select('team_a_id, team_b_id').eq('id', matchId).eq('tournament_id', me.tournament.id).maybeSingle();
  if (row.error || !row.data) return fail('invalid_input', 'Unknown match');
  if (row.data.team_a_id !== me.team.id && row.data.team_b_id !== me.team.id) return fail('not_your_match', 'Your team is not in this match');

  const games = gamesFromForm(formData, settingsFromTournament(me.tournament).gamesPerMatch);
  const applied = await applySubmission(sb, { tournament: me.tournament, teamId: me.team.id, matchId, games });
  if (!applied.ok) return fail(applied.error, applied.message);
  revalidateTournament(slug);
  return ok({ outcome: applied.outcome });
}
