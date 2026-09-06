'use server';
import { currentParticipant } from '@/lib/participant/token';
import { parseProfileForm } from '@/lib/participant/profile';
import { createServiceSupabase } from '@/lib/supabase/service';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';

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
