'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import { parseSettingsForm, slugify } from '@/lib/tournaments/settingsForm';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TournamentRow } from '@/lib/db/types';
import { listGames, listMatches } from '@/lib/db/queries';
import { settingsFor } from '@/lib/db/mappers';
import { knockoutHasPlay } from '@/lib/bracket/undo';
import { koSlotChanges } from '@/lib/bracket/koSlots';
import { withResultLock } from '@/lib/results/lock';
import { revalidateTournament } from './revalidate';

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
  // once play has started.
  // The court count goes with them: it names where to send people, not how the game is scored, and
  // a hall that opens another court mid-evening should be able to say so.
  const update: Record<string, unknown> = { starts_at: v.startsAt, venue: v.venue === '' ? null : v.venue, court_count: v.courtCount };
  // Anything that changes how a pool match is scored would rewrite results already entered, so it
  // is fixed once the pools are locked.
  if (ctx.tournament.status === 'setup') {
    Object.assign(update, {
      games_per_match: v.pool.gamesPerMatch,
      points_per_game: v.pool.pointsPerGame,
      win_by_two: v.pool.winByTwo,
      max_points: v.pool.maxPoints,
      time_cap_minutes: v.pool.timeCapMinutes,
      play_all_games: v.pool.playAllGames,
      game_labels: v.labels,
    });
  }
  // null across the ko_* columns means "the knockout uses the pool rules"; 0 in
  // ko_time_cap_minutes is the sentinel for "the knockout has no clock".
  const koColumns = {
    ko_games_per_match: v.knockout ? v.knockout.gamesPerMatch : null,
    ko_points_per_game: v.knockout ? v.knockout.pointsPerGame : null,
    ko_win_by_two: v.knockout ? v.knockout.winByTwo : null,
    ko_max_points: v.knockout ? v.knockout.maxPoints : null,
    ko_time_cap_minutes: v.knockout ? v.knockout.timeCapMinutes ?? 0 : null,
    ko_relay: v.relay !== null,
    // Targets are kept while relay is off, so ticking it again brings them back.
    ...(v.relay ? { ko_relay_quarter: v.relay.quarter, ko_relay_semi: v.relay.semi, ko_relay_final: v.relay.final } : {}),
  };
  // The knockout has not been played yet, so its format — and how many teams reach it — stays open
  // through the pool stage.
  if (ctx.tournament.status === 'setup' || ctx.tournament.status === 'pools') {
    Object.assign(update, koColumns, { advance_per_pool: v.advancePerPool });
  }
  // Once the bracket exists its rules stay open until the first knockout game is scored or put on
  // court. Who qualified is fixed by then, so advance_per_pool is not written.
  if (ctx.tournament.status === 'knockout') return updateKnockoutRules(slug, ctx, update, koColumns);
  const upd = await ctx.sb.from('tournaments').update(update).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/t/${slug}`);
  return ok(undefined);
}

/**
 * Saves the rules once the knockout has started. Under the result lock, so no knockout game can be
 * scored between checking that none has been and changing the rules it would be scored under. When
 * games per match changes, every (still empty) knockout match gets that many game slots. Pool and
 * playoff matches are never touched.
 */
async function updateKnockoutRules(
  slug: string,
  ctx: { sb: SupabaseClient; tournament: TournamentRow },
  update: Record<string, unknown>,
  koColumns: Partial<TournamentRow>,
): Promise<ActionResult> {
  const t = ctx.tournament;
  return withResultLock(ctx.sb, t.id, async () => {
    const [rows, gameRows] = await Promise.all([listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id)]);
    const open = !knockoutHasPlay(rows, gameRows);
    if (open) Object.assign(update, koColumns);
    const upd = await ctx.sb.from('tournaments').update(update).eq('id', t.id).eq('status', 'knockout').select('id');
    if (upd.error) return fail('invalid_input', upd.error.message);
    if ((upd.data ?? []).length === 0) return fail('stale_state', 'The tournament moved on; reload');
    if (open) {
      const gamesPerMatch = settingsFor({ ...t, ...koColumns }, 'knockout').gamesPerMatch;
      const { matchIds, insert } = koSlotChanges(rows, gameRows, gamesPerMatch);
      if (matchIds.length > 0) {
        const del = await ctx.sb.from('games').delete().in('match_id', matchIds).gt('game_no', gamesPerMatch);
        if (del.error) return fail('invalid_input', del.error.message);
      }
      if (insert.length > 0) {
        const ins = await ctx.sb.from('games').insert(insert);
        if (ins.error) return fail('invalid_input', ins.error.message);
      }
    }
    revalidateTournament(slug);
    return ok(undefined);
  }, (message) => fail('stale_state', message));
}

/** Date and venue only; editable at every stage. */
export async function updateEvent(slug: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const rawStart = String(formData.get('startsAt') ?? '').trim();
  if (rawStart !== '' && Number.isNaN(Date.parse(rawStart))) return fail('invalid_input', 'Start date/time is not valid');
  const venue = String(formData.get('venue') ?? '').trim();
  if (venue.length > 120) return fail('invalid_input', 'Venue must be at most 120 characters');
  const upd = await ctx.sb.from('tournaments').update({ starts_at: rawStart === '' ? null : new Date(rawStart).toISOString(), venue: venue === '' ? null : venue }).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/t/${slug}`);
  return ok(undefined);
}
