'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import { parseSettingsForm, slugify } from '@/lib/tournaments/settingsForm';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';

export async function createTournament(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const slug = slugify(String(formData.get('slug') ?? name));
  if (!name || slug.length < 3) redirect('/admin?error=' + encodeURIComponent('Name and slug (3+ chars) are required'));
  const sb = await createServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/login');
  // create_tournament() inserts the tournament and its first admin row in one transaction;
  // direct inserts into either table are refused by RLS.
  const res = await sb.rpc('create_tournament', { p_slug: slug, p_name: name });
  if (res.error) {
    const duplicate = res.error.code === '23505' || /duplicate key|already exists/i.test(res.error.message);
    redirect('/admin?error=' + encodeURIComponent(duplicate ? 'That slug is already taken' : res.error.message));
  }
  redirect(`/admin/${slug}`);
}

export async function updateSettings(slug: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Settings can only change during setup');
  const parsed = parseSettingsForm(formData);
  if (!parsed.ok) return fail('invalid_settings', parsed.problems.join('; '));
  const v = parsed.value;
  const upd = await ctx.sb.from('tournaments').update({
    games_per_match: v.gamesPerMatch, points_per_game: v.pointsPerGame, win_by_two: v.winByTwo,
    max_points: v.maxPoints, court_count: v.courtCount, advance_per_pool: v.advancePerPool,
  }).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok(undefined);
}
