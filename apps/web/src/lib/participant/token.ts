import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createServiceSupabase } from '@/lib/supabase/service';
import { getTournamentBySlug } from '@/lib/db/queries';
import { TEAM_PUBLIC_COLUMNS, type TeamRow, type TournamentRow } from '@/lib/db/types';
import { atLimit, record } from './rateLimit';

export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
export const cookieName = (slug: string) => `tt_${slug}`;

/** Failed link resolutions allowed per client per minute on the private-link route. */
export const TOKEN_LOOKUP_LIMIT = 30;
export const TOKEN_LOOKUP_WINDOW_MS = 60_000;

export interface Participant { tournament: TournamentRow; team: TeamRow }

/** Distinguishes "we refused to look" from "we looked and found nothing". */
export const RATE_LIMITED = 'rate_limited' as const;
export type TokenResolution = Participant | typeof RATE_LIMITED | null;

/** "The database could not answer", as opposed to "no team holds this token". */
const LOOKUP_FAILED = 'lookup_failed' as const;

/** Service-role lookup, always scoped by tournament first (edit_token is unique per tournament, not globally). */
async function lookupTeamByToken(slug: string, token: string): Promise<Participant | null | typeof LOOKUP_FAILED> {
  if (!TOKEN_RE.test(token)) return null;
  const sb = createServiceSupabase();
  const tournament = await getTournamentBySlug(sb, slug);
  if (!tournament) return null;
  const res = await sb.from('teams').select(TEAM_PUBLIC_COLUMNS).eq('tournament_id', tournament.id).eq('edit_token', token).maybeSingle();
  if (res.error) return LOOKUP_FAILED;
  return res.data ? { tournament, team: res.data as TeamRow } : null;
}

/**
 * The private-link route's lookup, and the only rate-limited one: the link is the single place a
 * stranger can present a token of their choosing, so it is where guessing would happen.
 *
 * Only *failed* resolutions consume budget. Guessing a token is by definition a stream of misses,
 * so the brute-force ceiling is unchanged, while a team re-opening its own link never trips it.
 */
export async function resolveTeamByToken(slug: string, token: string, clientKey: string): Promise<TokenResolution> {
  const key = `token:${clientKey}`;
  if (atLimit(key, TOKEN_LOOKUP_LIMIT, TOKEN_LOOKUP_WINDOW_MS)) return RATE_LIMITED;
  const found = await lookupTeamByToken(slug, token);
  if (found === LOOKUP_FAILED) return null; // our fault, not a guess: charge nothing
  if (!found) record(key, TOKEN_LOOKUP_WINDOW_MS);
  return found;
}

/**
 * The participant identified by this request's cookie, or null.
 *
 * Deliberately not rate limited. The cookie is re-resolved on every render and realtime pushes
 * several renders a minute to every phone, so counting its misses let a few phones holding a dead
 * cookie (a team the organiser deleted, a reset database) on shared venue wifi exhaust the budget
 * for every player behind that address. Nothing is lost: a token is 144 random bits, so the limit
 * on the link route is defence in depth rather than the thing that makes guessing infeasible.
 *
 * A dead cookie reads as "no participant", and is cleared where the request is allowed to write
 * cookies (a server action). A server component cannot, so there it is simply ignored.
 *
 * Cached per request: the public layout resolves it for the tab bar and the team page resolves
 * it again, and one database round trip is enough for both.
 */
export const currentParticipant = cache(async (slug: string): Promise<Participant | null> => {
  const jar = await cookies();
  const token = jar.get(cookieName(slug))?.value;
  if (!token) return null;
  const found = await lookupTeamByToken(slug, token);
  if (found === LOOKUP_FAILED) return null; // a blip, so the cookie is kept for the next render
  if (!found) {
    try { jar.delete({ name: cookieName(slug), path: `/t/${slug}` }); } catch { /* read-only during render */ }
    return null;
  }
  return found;
});
