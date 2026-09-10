'use server';
import { currentParticipant } from '@/lib/participant/token';
import { parseProfileForm } from '@/lib/participant/profile';
import { createServiceSupabase } from '@/lib/supabase/service';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { settingsFor } from '@/lib/db/mappers';
import { gamesFromForm } from '@/lib/results/form';
import { applySubmission, type SubmissionOutcome } from '@/lib/submissions/applySubmission';
import { parseRosterForm, rosterErrorMessage, rosterOf, photoBlobFrom, keptPathFrom } from '@/lib/teams/roster';
import { listTeamsWithPlayers } from '@/lib/db/queries';
import { uploadPhoto, deletePhotos } from '@/lib/photos/storage';

export async function updateMyTeam(slug: string, formData: FormData): Promise<ActionResult> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to edit your team');
  const parsed = parseProfileForm(formData);
  if (!parsed.ok) return fail('invalid_input', parsed.problems.join('; '));
  const sb = createServiceSupabase();
  const held = me.team.photo_path;
  // A kept path has to be the one this team already holds. Without this check a crafted form
  // could point this team at any object in the bucket.
  const kept = keptPathFrom(formData);
  const keep = kept !== null && kept === held ? kept : null;
  const blob = photoBlobFrom(formData);
  const photo = blob ? (await uploadPhoto(sb, me.tournament.id, blob)) ?? keep : keep;
  const upd = await sb.from('teams').update({ ...parsed.value, photo_path: photo }).eq('id', me.team.id).eq('tournament_id', me.tournament.id).select('id');
  if (upd.error) {
    // The form was already validated, so a DB error here is ours, not the participant's: keep the
    // detail server-side and give the player something actionable.
    console.error('updateMyTeam failed', { slug, teamId: me.team.id, message: upd.error.message });
    return fail('stale_state', 'Could not save; try again');
  }
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'Team not found');
  // Whatever this team held and no longer references is now unreachable.
  if (held && held !== photo) await deletePhotos(sb, [held]);
  revalidateTournament(slug);
  return ok(undefined);
}

/** A team edits its own three players until the pools lock. */
export async function updateMyRoster(slug: string, formData: FormData): Promise<ActionResult> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to edit your team');
  if (me.tournament.status !== 'setup') return fail('stale_state', 'The draw is locked, so players cannot change. Ask the organiser if someone is injured.');
  const roster = parseRosterForm(formData);
  if (!roster.ok) return fail('invalid_input', roster.problems.join('; '));
  const sb = createServiceSupabase();
  const res = await sb.rpc('write_roster', {
    p_team: me.team.id, p_mixed1: roster.value.mixed1, p_mixed2: roster.value.mixed2, p_woman: roster.value.woman,
  });
  if (res.error) return fail('invalid_input', rosterErrorMessage(res.error.message));
  revalidateTournament(slug);
  return ok(undefined);
}

/** Swaps which man plays Mixed #1; the men's doubles pair is unchanged. */
export async function swapMixed(slug: string): Promise<ActionResult> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to edit your team');
  if (me.tournament.status !== 'setup') return fail('stale_state', 'The draw is locked, so players cannot change. Ask the organiser if someone is injured.');
  const sb = createServiceSupabase();
  const team = (await listTeamsWithPlayers(sb, me.tournament.id)).find((t) => t.id === me.team.id);
  const players = team ? rosterOf(team) : [];
  const by = (role: 'mixed1' | 'mixed2' | 'woman') => players.find((p) => p.role === role)?.name;
  if (!by('mixed1') || !by('mixed2') || !by('woman')) return fail('invalid_input', 'Fill in all three players first');
  const res = await sb.rpc('write_roster', {
    p_team: me.team.id, p_mixed1: by('mixed2'), p_mixed2: by('mixed1'), p_woman: by('woman'),
  });
  if (res.error) return fail('invalid_input', rosterErrorMessage(res.error.message));
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
  const row = await sb.from('matches').select('stage, team_a_id, team_b_id').eq('id', matchId).eq('tournament_id', me.tournament.id).maybeSingle();
  if (row.error || !row.data) return fail('invalid_input', 'Unknown match');
  if (row.data.team_a_id !== me.team.id && row.data.team_b_id !== me.team.id) return fail('not_your_match', 'Your team is not in this match');

  const games = gamesFromForm(formData, settingsFor(me.tournament, row.data.stage).gamesPerMatch);
  const applied = await applySubmission(sb, { tournament: me.tournament, teamId: me.team.id, matchId, games });
  if (!applied.ok) return fail(applied.error, applied.message);
  revalidateTournament(slug);
  return ok({ outcome: applied.outcome });
}

/** What the player is told after a submission, per outcome. */
const OUTCOME_TEXT: Record<SubmissionOutcome, string> = {
  submitted: 'Scores submitted, waiting for the other team',
  confirmed: 'Result confirmed',
  disputed: 'Scores differ from the other team; an organiser will resolve it',
};

/**
 * Form-friendly wrapper for the team page. The outcome text is built here because only the server
 * knows which of the three outcomes happened; ScoreForm renders whatever `text` comes back.
 */
export async function submitScoresForm(slug: string, formData: FormData): Promise<ActionResult<{ outcome: SubmissionOutcome; text: string }>> {
  const r = await submitScores(slug, String(formData.get('matchId') ?? ''), formData);
  if (!r.ok) return r;
  return ok({ outcome: r.data.outcome, text: OUTCOME_TEXT[r.data.outcome] });
}
