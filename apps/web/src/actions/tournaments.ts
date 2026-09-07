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
  const rawStart = String(formData.get('startsAt') ?? '').trim();
  if (rawStart !== '' && Number.isNaN(Date.parse(rawStart))) redirect('/admin?error=' + encodeURIComponent('Start date/time is not valid'));
  const startsAt = rawStart === '' ? null : new Date(rawStart).toISOString();
  const venue = String(formData.get('venue') ?? '').trim();
  if (venue.length > 120) redirect('/admin?error=' + encodeURIComponent('Venue must be at most 120 characters'));
  const sb = await createServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/login');
  // create_tournament() inserts the tournament and its first admin row in one transaction;
  // direct inserts into either table are refused by RLS.
  const res = await sb.rpc('create_tournament', { p_slug: slug, p_name: name, p_starts_at: startsAt, p_venue: venue });
  if (res.error) {
    const duplicate = res.error.code === '23505' || /duplicate key|already exists/i.test(res.error.message);
    redirect('/admin?error=' + encodeURIComponent(duplicate ? 'That slug is already taken' : res.error.message));
  }
  redirect(`/admin/${slug}`);
}

export async function updateSettings(slug: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const parsed = parseSettingsForm(formData);
  if (!parsed.ok) return fail('invalid_settings', parsed.problems.join('; '));
  const v = parsed.value;

  // The date and venue are event details, not rules: an organiser must be able to correct them
  // once play has started. Everything that changes how a match is scored stays locked after setup.
  const update: Record<string, unknown> = { starts_at: v.startsAt, venue: v.venue === '' ? null : v.venue };
  if (ctx.tournament.status === 'setup') {
    Object.assign(update, {
      games_per_match: v.pool.gamesPerMatch,
      points_per_game: v.pool.pointsPerGame,
      win_by_two: v.pool.winByTwo,
      max_points: v.pool.maxPoints,
      time_cap_minutes: v.pool.timeCapMinutes,
      // null across the ko_* columns means "the knockout uses the pool rules"; 0 in
      // ko_time_cap_minutes is the sentinel for "the knockout has no clock".
      ko_games_per_match: v.knockout ? v.knockout.gamesPerMatch : null,
      ko_points_per_game: v.knockout ? v.knockout.pointsPerGame : null,
      ko_win_by_two: v.knockout ? v.knockout.winByTwo : null,
      ko_max_points: v.knockout ? v.knockout.maxPoints : null,
      ko_time_cap_minutes: v.knockout ? v.knockout.timeCapMinutes ?? 0 : null,
      court_count: v.courtCount,
      advance_per_pool: v.advancePerPool,
    });
  }
  const upd = await ctx.sb.from('tournaments').update(update).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/t/${slug}`);
  return ok(undefined);
}
