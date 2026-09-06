'use server';
import { currentParticipant } from '@/lib/participant/token';
import { parseProfileForm } from '@/lib/participant/profile';
import { createServiceSupabase } from '@/lib/supabase/service';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { listMatches, listSubmissions, latestByMatch } from '@/lib/db/queries';
import { rowToMatch, settingsFromTournament } from '@/lib/db/mappers';
import { gamesFromForm } from '@/lib/results/form';
import { decideSubmission } from '@/lib/submissions/decide';
import { planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';

export async function updateMyTeam(slug: string, formData: FormData): Promise<ActionResult> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to edit your team');
  const parsed = parseProfileForm(formData);
  if (!parsed.ok) return fail('invalid_input', parsed.problems.join('; '));
  const sb = createServiceSupabase();
  const upd = await sb.from('teams').update(parsed.value).eq('id', me.team.id).eq('tournament_id', me.tournament.id).select('id');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('stale_state', 'Team not found');
  revalidateTournament(slug);
  return ok(undefined);
}

export async function submitScores(slug: string, matchId: string, formData: FormData): Promise<ActionResult<{ outcome: 'submitted' | 'confirmed' | 'disputed' }>> {
  const me = await currentParticipant(slug);
  if (!me) return fail('not_participant', 'Open your team link again to submit scores');
  if (me.tournament.status !== 'pools' && me.tournament.status !== 'knockout') return fail('stale_state', 'Tournament is not in play');
  const sb = createServiceSupabase();
  const settings = settingsFromTournament(me.tournament);
  const [rows, subs] = await Promise.all([listMatches(sb, me.tournament.id), listSubmissions(sb, me.tournament.id)]);
  const row = rows.find((r) => r.id === matchId);
  if (!row) return fail('invalid_input', 'Unknown match');
  const side = row.team_a_id === me.team.id ? 'a' : row.team_b_id === me.team.id ? 'b' : null;
  if (!side) return fail('not_your_match', 'Your team is not in this match');
  const games = gamesFromForm(formData, settings.gamesPerMatch);
  const match = rowToMatch(row);
  const decision = decideSubmission({ settings, match, side, games, latest: latestByMatch(subs)[matchId] ?? {} });
  if ('error' in decision) return fail(decision.error, decision.message);

  const ins = await sb.from('score_submissions').insert({ match_id: matchId, submitted_by: side === 'a' ? 'team_a' : 'team_b', games });
  if (ins.error) return fail('invalid_input', ins.error.message);

  if (decision.outcome === 'confirmed') {
    const plan = planResult({ settings, matches: rows.map(rowToMatch), matchId, games });
    if ('error' in plan) return fail(plan.error === 'incomplete' ? 'invalid_score' : plan.error, plan.message);
    const persisted = await applyResultPlan(sb, { tournamentId: me.tournament.id, matchId, rows, plan, tournamentStatus: me.tournament.status });
    if (!persisted.ok) return fail(persisted.error, persisted.message);
  } else {
    // submitted or disputed: move the status, guarded on the status we read
    const upd = await sb.from('matches').update({ status: decision.outcome }).eq('id', matchId).eq('status', row.status).select('id');
    if (upd.error) return fail('invalid_input', upd.error.message);
    if ((upd.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');
  }
  revalidateTournament(slug);
  return ok({ outcome: decision.outcome });
}
