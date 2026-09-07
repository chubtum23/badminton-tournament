import 'server-only';
import { cookies, headers } from 'next/headers';
import { createServiceSupabase } from '@/lib/supabase/service';
import { getTournamentBySlug } from '@/lib/db/queries';
import { TEAM_PUBLIC_COLUMNS, type TeamRow, type TournamentRow } from '@/lib/db/types';
import { allow } from './rateLimit';
import { clientKeyFrom } from './clientKey';

export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
export const cookieName = (slug: string) => `tt_${slug}`;

/** Token resolutions allowed per client per minute, whatever the entry point. */
export const TOKEN_LOOKUP_LIMIT = 30;
export const TOKEN_LOOKUP_WINDOW_MS = 60_000;

export interface Participant { tournament: TournamentRow; team: TeamRow }

/** Distinguishes "we refused to look" from "we looked and found nothing". */
export const RATE_LIMITED = 'rate_limited' as const;
export type TokenResolution = Participant | typeof RATE_LIMITED | null;

/** Service-role lookup, always scoped by tournament first (edit_token is unique per tournament, not globally). */
async function lookupTeamByToken(slug: string, token: string): Promise<Participant | null> {
  if (!TOKEN_RE.test(token)) return null;
  const sb = createServiceSupabase();
  const tournament = await getTournamentBySlug(sb, slug);
  if (!tournament) return null;
  const res = await sb.from('teams').select(TEAM_PUBLIC_COLUMNS).eq('tournament_id', tournament.id).eq('edit_token', token).maybeSingle();
  if (res.error || !res.data) return null;
  return { tournament, team: res.data as TeamRow };
}

/**
 * Every path that turns a token into a team goes through here, so the limiter cannot be sidestepped
 * by replaying the cookie against a page instead of the one-time link route.
 */
export async function resolveTeamByToken(slug: string, token: string, clientKey: string): Promise<TokenResolution> {
  if (!allow(`token:${clientKey}`, TOKEN_LOOKUP_LIMIT, TOKEN_LOOKUP_WINDOW_MS)) return RATE_LIMITED;
  return lookupTeamByToken(slug, token);
}

/** The participant identified by this request's cookie, or null (including when rate limited). */
export async function currentParticipant(slug: string): Promise<Participant | null> {
  const jar = await cookies();
  const token = jar.get(cookieName(slug))?.value;
  if (!token) return null;
  const resolved = await resolveTeamByToken(slug, token, clientKeyFrom(await headers()));
  return resolved === RATE_LIMITED ? null : resolved;
}
