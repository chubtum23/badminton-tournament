'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { listGames, listMatches } from '@/lib/db/queries';
import { withResultLock } from '@/lib/results/lock';
import type { MatchRow } from '@/lib/db/types';
import { revalidateTournament } from './revalidate';
import { awardMatch } from './matches';
import { parseRosterForm, rosterErrorMessage } from '@/lib/teams/roster';
import { createServiceSupabase } from '@/lib/supabase/service';
import { deletePhotos } from '@/lib/photos/storage';

/** One team with its three players, written atomically by admin_add_team. */
export async function addTeam(slug: string, formData: FormData): Promise<ActionResult<{ teamId: string }>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Teams can only be added during setup');
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 40) return fail('invalid_input', 'Team name must be 1-40 characters');
  const roster = parseRosterForm(formData);
  if (!roster.ok) return fail('invalid_input', roster.problems.join('; '));
  const res = await ctx.sb.rpc('admin_add_team', { p_tournament: ctx.tournament.id, p_name: name, p_mixed1: roster.value.mixed1, p_mixed2: roster.value.mixed2, p_woman: roster.value.woman });
  if (res.error) return fail(res.error.code === '42501' ? 'not_admin' : 'invalid_input', rosterErrorMessage(res.error.message));
  revalidateTournament(slug);
  return ok({ teamId: String(res.data) });
}

/** Rewrites a team's three players (organiser). */
export async function setRoster(slug: string, teamId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Rosters are locked once the pools are');
  const roster = parseRosterForm(formData);
  if (!roster.ok) return fail('invalid_input', roster.problems.join('; '));
  const res = await ctx.sb.rpc('admin_set_roster', {
    p_team: teamId, p_mixed1: roster.value.mixed1, p_mixed2: roster.value.mixed2, p_woman: roster.value.woman,
  });
  if (res.error) return fail(res.error.code === '42501' ? 'not_admin' : 'invalid_input', rosterErrorMessage(res.error.message));
  revalidateTournament(slug);
  return ok(undefined);
}

export async function setSignupOpen(slug: string, open: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (open && ctx.tournament.status !== 'setup') return fail('stale_state', 'Sign-ups can only be open during setup');
  const upd = await ctx.sb.from('tournaments').update({ signup_open: open }).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

/** Blank clears the code. */
export async function setJoinCode(slug: string, code: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const trimmed = code.trim();
  if (trimmed !== '' && (trimmed.length < 3 || trimmed.length > 30)) return fail('invalid_input', 'Join code must be 3-30 characters, or blank for none');
  const upd = await ctx.sb.from('tournaments').update({ join_code: trimmed === '' ? null : trimmed }).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

export async function setSeed(slug: string, teamId: string, seed: number | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (seed !== null && (!Number.isInteger(seed) || seed < 1 || seed > 64)) return fail('invalid_input', 'seed must be 1-64');
  const upd = await ctx.sb.from('teams').update({ seed }).eq('id', teamId).eq('tournament_id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok(undefined);
}

export async function deleteTeam(slug: string, teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'setup') return fail('stale_state', 'Teams can only be removed during setup');
  // delete_team() also removes the team's players, which nothing else references.
  const del = await ctx.sb.rpc('delete_team', { p_team: teamId });
  if (del.error) return fail(del.error.code === '42501' ? 'not_admin' : 'invalid_input', del.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok(undefined);
}

export async function regenerateToken(slug: string, teamId: string): Promise<ActionResult<string>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const res = await ctx.sb.rpc('regenerate_team_token', { team: teamId });
  // 42501 is the insufficient_privilege raised by regenerate_team_token(); anything else is a
  // real database failure and should not be reported to the admin as a permissions problem.
  if (res.error) return fail(res.error.code === '42501' ? 'not_admin' : 'invalid_input', res.error.message);
  revalidatePath(`/admin/${slug}`);
  return ok(res.data as string);
}

export async function getEditTokens(slug: string): Promise<Record<string, string>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return {};
  const res = await ctx.sb.rpc('team_edit_tokens', { t: ctx.tournament.id });
  const out: Record<string, string> = {};
  for (const r of (res.data ?? []) as Array<{ team_id: string; edit_token: string }>) out[r.team_id] = r.edit_token;
  return out;
}

/**
 * Marks a team as withdrawn and forfeits every match of theirs that is still open with a known
 * opponent. Matches still waiting on an opponent (pending, one side empty) are left alone: the
 * bracket fills them later, and the organiser can award or replace then. A match that already has
 * game scores is left alone too — forfeiting it would erase them — and the organiser is told.
 */
export async function withdrawTeam(slug: string, teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status === 'finished') return fail('stale_state', 'The tournament is finished, so its results are no longer forfeited');
  return withResultLock(ctx.sb, ctx.tournament.id, async () => {
    // Conditional on the flag so two clicks cannot forfeit the same matches twice.
    const upd = await ctx.sb.from('teams').update({ withdrawn: true })
      .eq('id', teamId).eq('tournament_id', ctx.tournament.id).eq('withdrawn', false).select('id');
    if (upd.error) return fail('invalid_input', upd.error.message);
    if ((upd.data ?? []).length === 0) return fail('stale_state', 'Team not found or already withdrawn');

    const open: MatchRow['status'][] = ['ready', 'live', 'submitted', 'disputed'];
    const [rows, gameRows] = await Promise.all([listMatches(ctx.sb, ctx.tournament.id), listGames(ctx.sb, ctx.tournament.id)]);
    const scored = new Set(gameRows.filter((g) => g.score_a !== null).map((g) => g.match_id));
    const problems: string[] = [];
    let leftAlone = 0;
    for (const m of rows) {
      if (m.team_a_id !== teamId && m.team_b_id !== teamId) continue;
      if (!open.includes(m.status) || m.team_a_id === null || m.team_b_id === null) continue;
      if (scored.has(m.id)) { leftAlone += 1; continue; }
      const opponent = m.team_a_id === teamId ? m.team_b_id : m.team_a_id;
      // Runs inside this action's result lock; withResultLock lets the nested call straight through.
      const r = await awardMatch(slug, m.id, opponent, 'forfeit');
      if (!r.ok) problems.push(r.message ?? r.error);
    }
    revalidateTournament(slug);
    if (problems.length) return fail('invalid_input', `Team withdrawn, but some matches could not be forfeited: ${problems.join('; ')}`);
    if (leftAlone > 0) {
      return fail('match_not_editable', `Team withdrawn. ${leftAlone} of their matches already had scores entered, so ${leftAlone === 1 ? 'it was' : 'they were'} left for you to settle on the Matches page.`);
    }
    return ok(undefined);
  }, (message) => fail('stale_state', message));
}

/** Clears the withdrawn flag. Matches already forfeited stay forfeited; edit them individually. */
export async function reinstateTeam(slug: string, teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const upd = await ctx.sb.from('teams').update({ withdrawn: false })
    .eq('id', teamId).eq('tournament_id', ctx.tournament.id).select('id');
  if (upd.error) return fail('invalid_input', upd.error.message);
  if ((upd.data ?? []).length === 0) return fail('invalid_input', 'Unknown team');
  revalidateTournament(slug);
  return ok(undefined);
}

/**
 * The only moderation there is: sign-up is public, so an organiser can take a photo down.
 *
 * Storage deletes need the service client — no policy grants authenticated a write on
 * storage.objects (see the team-photo migration) — so this reaches for it, unlike the rest of
 * this file's `ctx.sb` writes. That means the tournament match below is the only thing standing
 * between an organiser and someone else's team row, so it is checked explicitly rather than left
 * to RLS.
 */
export async function removeTeamPhoto(slug: string, teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const svc = createServiceSupabase();
  const row = await svc.from('teams').select('id, tournament_id, photo_path').eq('id', teamId).maybeSingle();
  if (row.error || !row.data) return fail('invalid_input', 'Unknown team');
  if (row.data.tournament_id !== ctx.tournament.id) return fail('not_admin');
  const upd = await svc.from('teams').update({ photo_path: null }).eq('id', teamId);
  if (upd.error) return fail('stale_state', 'Could not remove the photo');
  if (row.data.photo_path) await deletePhotos(svc, [row.data.photo_path]);
  revalidateTournament(slug);
  return ok(undefined);
}
