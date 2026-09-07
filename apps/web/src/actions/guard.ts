import 'server-only';
import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug } from '@/lib/db/queries';
import type { TournamentRow } from '@/lib/db/types';

export type AdminContext = { sb: SupabaseClient; tournament: TournamentRow; userId: string };

/**
 * Resolves the signed-in admin for a tournament slug, or 'not_admin'.
 *
 * Every admin screen resolves this at least twice (the layout and the page inside it), and
 * an action that delegates to another action resolves it again. `cache` makes all of those
 * share one result for the life of a single request, and the user lookup and the tournament
 * lookup are independent so they run together. That turns six or more sequential round trips
 * into two, which is the difference between a snappy click and a slow one when the database
 * is not in the same region as the server.
 */
export const requireAdmin = cache(async (slug: string): Promise<AdminContext | { error: 'not_admin' }> => {
  const sb = await createServerSupabase();
  const [{ data: auth }, tournament] = await Promise.all([sb.auth.getUser(), getTournamentBySlug(sb, slug)]);
  if (!auth.user || !tournament) return { error: 'not_admin' };
  const { data: row } = await sb
    .from('tournament_admins').select('tournament_id').eq('tournament_id', tournament.id).eq('user_id', auth.user.id).maybeSingle();
  if (!row) return { error: 'not_admin' };
  return { sb, tournament, userId: auth.user.id };
});

export async function currentUserId(): Promise<string | null> {
  const sb = await createServerSupabase();
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}
