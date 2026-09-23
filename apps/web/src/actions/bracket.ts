'use server';
import { revalidatePath } from 'next/cache';
import { randomInt, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TournamentRow } from '@/lib/db/types';
import { randomSeats, seatsMatch, seededSeats, swapSeats, type Seats } from '@/lib/bracket/draw';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';
import { listGames, listMatches, listPools, listTeams } from '@/lib/db/queries';
import { matchToRow, settingsFor, slotRowsFor } from '@/lib/db/mappers';
import { planKnockout } from '@/lib/bracket/plan';
import { knockoutInput } from '@/lib/bracket/input';
import { withResultLock } from '@/lib/results/lock';

const busy = (message: string): ActionResult => fail('stale_state', message);

export async function startKnockout(slug: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'pools') return fail('stale_state', 'Knockout can only start from the pool stage');
  const t = ctx.tournament;
  // Under the result lock so the pool tables it seeds from cannot change while it reads them.
  return withResultLock(ctx.sb, t.id, async () => {
    const [pools, teams, matchRows, gameRows] = await Promise.all([
      listPools(ctx.sb, t.id), listTeams(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id),
    ]);
    if (matchRows.some((m) => m.stage === 'knockout')) return fail('stale_state', 'Knockout already started');
    const plan = planKnockout({
      ...knockoutInput({ tournament: t, pools, teams, matchRows, gameRows }),
      newId: randomUUID,
    });
    if ('error' in plan) return fail('invalid_input', plan.error);

    // Claim the pools -> knockout transition first (and verify a row was actually
    // affected) so a racing or retried start request can't pass the earlier
    // `status === 'pools'` guard twice and insert a second set of bracket matches:
    // Supabase returns no error when an update's filter matches zero rows. This
    // mirrors how lockPools in src/actions/pools.ts claims its status transition
    // before inserting matches.
    const claim = await ctx.sb.from('tournaments').update({ status: 'knockout' })
      .eq('id', t.id).eq('status', 'pools').select('id');
    if (claim.error) return fail('invalid_input', claim.error.message);
    if ((claim.data ?? []).length === 0) return fail('stale_state', 'Knockout was already started');

    // Insert later rounds first so next_match_id always references an existing row.
    const rounds = [...new Set(plan.matches.map((m) => m.round ?? 0))].sort((a, b) => b - a);
    const gamesPerMatch = settingsFor(t, 'knockout').gamesPerMatch;
    for (const r of rounds) {
      const roundMatches = plan.matches.filter((m) => m.round === r);
      const ins = await ctx.sb.from('matches').insert(roundMatches.map((m) => matchToRow(m, t.id)));
      if (ins.error) return fail('invalid_input', ins.error.message);
      // Each match's games exist from the moment the match does, so they can be scheduled unplayed.
      const insSlots = await ctx.sb.from('games').insert(roundMatches.flatMap((m) => slotRowsFor(m.id, gamesPerMatch)));
      if (insSlots.error) return fail('invalid_input', insSlots.error.message);
    }
    for (const p of [`/admin/${slug}`, `/admin/${slug}/draw`, `/admin/${slug}/matches`, `/t/${slug}`, `/t/${slug}/bracket`]) revalidatePath(p);
    return ok(undefined);
  }, busy);
}

/**
 * The qualifiers as the pools now stand, with the draw the organiser has arranged (or the seeded
 * one). Shared by the three draw actions so they all read the same tables the same way.
 */
async function currentDraw(ctx: { sb: SupabaseClient; tournament: TournamentRow }): Promise<{ qualifiers: string[]; seats: Seats } | { error: string }> {
  const [pools, teams, matchRows, gameRows] = await Promise.all([
    listPools(ctx.sb, ctx.tournament.id), listTeams(ctx.sb, ctx.tournament.id),
    listMatches(ctx.sb, ctx.tournament.id), listGames(ctx.sb, ctx.tournament.id),
  ]);
  const input = knockoutInput({ tournament: ctx.tournament, pools, teams, matchRows, gameRows });
  const plan = planKnockout({ ...input, newId: () => 'x' });
  if ('error' in plan) return { error: plan.error };
  const qualifiers = plan.qualifiers.flatMap((q) => q.ranked);
  const stored = ctx.tournament.ko_seed_order;
  return {
    qualifiers,
    seats: seatsMatch(stored, qualifiers) ? [...stored!] : seededSeats(plan.qualifiers, input.advancePerPool),
  };
}

/** Writes a draw, or clears it back to the seeded one with null. Only before the knockout starts. */
async function writeDraw(slug: string, make: (current: { qualifiers: string[]; seats: Seats }) => Seats | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ctx.tournament.status !== 'pools') return fail('stale_state', 'The draw can only be set between the pools and the knockout');
  return withResultLock(ctx.sb, ctx.tournament.id, async () => {
    const current = await currentDraw(ctx);
    if ('error' in current) return fail('invalid_input', current.error);
    const seats = make(current);
    if (seats !== null && !seatsMatch(seats, current.qualifiers)) {
      return fail('invalid_input', 'That draw does not hold exactly the teams that qualified; reload the page');
    }
    const upd = await ctx.sb.from('tournaments').update({ ko_seed_order: seats })
      .eq('id', ctx.tournament.id).eq('status', 'pools').select('id');
    if (upd.error) return fail('invalid_input', upd.error.message);
    if ((upd.data ?? []).length === 0) return fail('stale_state', 'The tournament moved on; reload');
    revalidateTournament(slug);
    return ok(undefined);
  }, busy);
}

/** A fresh random draw. Shuffled on the server, so every organiser's screen sees the same one. */
export async function randomiseDraw(slug: string): Promise<ActionResult> {
  return writeDraw(slug, ({ qualifiers }) => randomSeats(qualifiers, () => randomInt(1_000_000) / 1_000_000));
}

/** Back to the seeded draw: pool winners against runners-up. */
export async function useSeededDraw(slug: string): Promise<ActionResult> {
  return writeDraw(slug, () => null);
}

/** Moves one team to one place in the draw, swapping it with whoever is already there. */
export async function moveInDraw(slug: string, index: number, teamId: string | null): Promise<ActionResult> {
  if (!Number.isInteger(index) || index < 0) return fail('invalid_input', 'Unknown place in the draw');
  return writeDraw(slug, ({ seats }) => swapSeats(seats, index, teamId));
}

/**
 * Swaps one side of a knockout match for another team, for when a qualifier withdraws or the
 * organiser corrects who came through. Only matches with nothing played can be changed; the update
 * is conditional on the side still holding the team we planned against.
 */
export async function replaceTeamInMatch(slug: string, matchId: string, side: 'a' | 'b', teamId: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (side !== 'a' && side !== 'b') return fail('invalid_input', 'Pick a side');
  return withResultLock(ctx.sb, ctx.tournament.id, async () => {
    const [teams, rows, gameRows] = await Promise.all([
      listTeams(ctx.sb, ctx.tournament.id), listMatches(ctx.sb, ctx.tournament.id), listGames(ctx.sb, ctx.tournament.id),
    ]);
    const match = rows.find((r) => r.id === matchId);
    if (!match) return fail('invalid_input', 'Unknown match');
    if (match.stage !== 'knockout') return fail('invalid_input', 'Only knockout matches can have a team replaced');
    if (match.status === 'done') return fail('match_not_editable', 'This match already has a result');
    if (gameRows.some((g) => g.match_id === matchId && g.score_a !== null)) {
      return fail('match_not_editable', 'This match already has game scores. Clear them on the Matches page before replacing a team.');
    }
    if (!teams.some((t) => t.id === teamId)) return fail('invalid_input', 'Unknown team');
    const current = side === 'a' ? match.team_a_id : match.team_b_id;
    const other = side === 'a' ? match.team_b_id : match.team_a_id;
    if (other === teamId) return fail('invalid_input', 'That team is already on the other side of this match');
    if (current === teamId) return ok(undefined);

    const column = side === 'a' ? 'team_a_id' : 'team_b_id';
    // A match with both sides known is playable; one still empty stays pending.
    const status = other === null ? match.status : 'ready';
    let q = ctx.sb.from('matches').update({ [column]: teamId, status })
      .eq('id', matchId).eq('status', match.status);
    q = current === null ? q.is(column, null) : q.eq(column, current);
    const upd = await q.select('id');
    if (upd.error) return fail('invalid_input', upd.error.message);
    if ((upd.data ?? []).length === 0) return fail('stale_state', 'Match changed underneath you; reload');

    // The update above already puts a two-sided match back to 'ready', so a submitted/disputed match
    // is no longer flagged. Its stored submissions still name the team that just left the slot, so
    // they go too; otherwise the card would show the old team's unconfirmed score against the new one.
    const delSubs = await ctx.sb.from('score_submissions').delete().eq('match_id', matchId);
    if (delSubs.error) return fail('invalid_input', delSubs.error.message);
    // Nothing is scored (checked above), but a game may be on court with the old team's clock.
    const resetGames = await ctx.sb.from('games')
      .update({ score_a: null, score_b: null, time_expired: false, court: null, started_at: null, paused_at: null, paused_ms: 0 })
      .eq('match_id', matchId);
    if (resetGames.error) return fail('invalid_input', resetGames.error.message);
    revalidateTournament(slug);
    return ok(undefined);
  }, busy);
}
