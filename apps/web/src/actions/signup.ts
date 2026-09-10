'use server';
import { headers } from 'next/headers';
import { createServiceSupabase } from '@/lib/supabase/service';
import { clientKeyFrom } from '@/lib/participant/clientKey';
import { allow } from '@/lib/participant/rateLimit';
import { parseSignupForm, rosterErrorMessage, photoBlobsFrom, ROSTER_ROLES, type RosterRole } from '@/lib/teams/roster';
import { uploadPhoto, deletePhotos } from '@/lib/photos/storage';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';

const SIGNUP_LIMIT = 10;
const SIGNUP_WINDOW_MS = 60_000;

/**
 * The public sign-up. Every check that matters (open, code, unique name, roster rule) is repeated
 * inside sign_up_team. That function is deliberately NOT granted to anon: the anon key ships in the
 * browser bundle, so a caller could otherwise POST to the RPC in a loop and skip the rate limiter
 * above, which is the only one there is. It therefore runs here under the service role.
 * The token comes back once; the caller turns it into the httpOnly cookie via the one-time link.
 */
export async function signUpTeam(slug: string, formData: FormData): Promise<ActionResult<{ token: string }>> {
  const key = `signup:${clientKeyFrom(await headers())}`;
  if (!allow(key, SIGNUP_LIMIT, SIGNUP_WINDOW_MS)) return fail('rate_limited', 'Too many attempts. Try again in a minute.');
  const parsed = parseSignupForm(formData);
  if (!parsed.ok) return fail('invalid_input', parsed.problems.join('; '));
  const v = parsed.value;
  const sb = createServiceSupabase();
  // The object path needs the tournament id, and this read also fails fast on an unknown slug.
  const t = await sb.from('tournaments').select('id').eq('slug', slug).maybeSingle();
  if (t.error || !t.data) return fail('invalid_input', 'Unknown tournament');
  const blobs = photoBlobsFrom(formData);
  const photos: Record<RosterRole, string | null> = { mixed1: null, mixed2: null, woman: null };
  for (const role of ROSTER_ROLES) {
    const blob = blobs[role];
    if (blob) photos[role] = await uploadPhoto(sb, t.data.id, blob);
  }
  const res = await sb.rpc('sign_up_team', {
    p_slug: slug, p_join_code: v.joinCode === '' ? null : v.joinCode, p_name: v.name, p_tagline: v.tagline,
    p_colour: v.colour, p_description: v.description, p_mixed1: v.mixed1, p_mixed2: v.mixed2, p_woman: v.woman,
    p_photo1: photos.mixed1, p_photo2: photos.mixed2, p_photow: photos.woman,
  });
  if (res.error) {
    // The team was never created, so nothing references these objects.
    await deletePhotos(sb, Object.values(photos).filter((p): p is string => p !== null));
    return fail('invalid_input', rosterErrorMessage(res.error.message));
  }
  revalidateTournament(slug);
  return ok({ token: String(res.data) });
}
