import 'server-only';
import { cookies } from 'next/headers';
import { createServiceSupabase } from '@/lib/supabase/service';
import { getTournamentBySlug } from '@/lib/db/queries';
import { TEAM_PUBLIC_COLUMNS, type TeamRow, type TournamentRow } from '@/lib/db/types';

export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
export const cookieName = (slug: string) => `tt_${slug}`;

export interface Participant { tournament: TournamentRow; team: TeamRow }

/** Service-role lookup, always scoped by tournament first (edit_token is unique per tournament, not globally). */
export async function resolveTeamByToken(slug: string, token: string): Promise<Participant | null> {
  if (!TOKEN_RE.test(token)) return null;
  const sb = createServiceSupabase();
  const tournament = await getTournamentBySlug(sb, slug);
  if (!tournament) return null;
  const res = await sb.from('teams').select(TEAM_PUBLIC_COLUMNS).eq('tournament_id', tournament.id).eq('edit_token', token).maybeSingle();
  if (res.error || !res.data) return null;
  return { tournament, team: res.data as TeamRow };
}

/** The participant identified by this request's cookie, or null. */
export async function currentParticipant(slug: string): Promise<Participant | null> {
  const jar = await cookies();
  const token = jar.get(cookieName(slug))?.value;
  if (!token) return null;
  return resolveTeamByToken(slug, token);
}
