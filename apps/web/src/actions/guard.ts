import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug } from '@/lib/db/queries';
import type { TournamentRow } from '@/lib/db/types';

export type AdminContext = { sb: SupabaseClient; tournament: TournamentRow; userId: string };

/** Resolves the signed-in admin for a tournament slug, or 'not_admin'. */
export async function requireAdmin(slug: string): Promise<AdminContext | { error: 'not_admin' }> {
  const sb = await createServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: 'not_admin' };
  const tournament = await getTournamentBySlug(sb, slug);
  if (!tournament) return { error: 'not_admin' };
  const { data: row } = await sb
    .from('tournament_admins').select('tournament_id').eq('tournament_id', tournament.id).eq('user_id', auth.user.id).maybeSingle();
  if (!row) return { error: 'not_admin' };
  return { sb, tournament, userId: auth.user.id };
}

export async function currentUserId(): Promise<string | null> {
  const sb = await createServerSupabase();
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}
