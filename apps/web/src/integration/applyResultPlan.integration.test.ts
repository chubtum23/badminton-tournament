import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CLASSIC_BEST_OF_THREE } from '@tournament/core';
import { planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';
import { rowToMatch, slotRowsFor } from '@/lib/db/mappers';
import type { MatchRow } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

// Simulates the conditional "claim" write that applyResultPlan performs as its first write:
// an update scoped to .eq('status', before.status).is/.eq('winner_id', before.winner_id) so that
// two concurrent submitters racing on the same match can only have one of them win the claim.
describe.skipIf(!enabled)('result claim race', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let tournamentId: string;
  let matchId: string;
  const slug = `enter-result-${Date.now().toString(36)}`;

  async function signedInClient(email: string): Promise<SupabaseClient> {
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const c = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await c.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return c;
  }

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    admin = await signedInClient(`admin-${slug}@example.com`);

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'result race test' });
    if (t.error) throw t.error;
    tournamentId = t.data as string;

    const teamA = await admin.from('teams').insert({ tournament_id: tournamentId, name: 'Alpha' }).select('id').single();
    if (teamA.error) throw teamA.error;
    const teamB = await admin.from('teams').insert({ tournament_id: tournamentId, name: 'Bravo' }).select('id').single();
    if (teamB.error) throw teamB.error;

    const pool = await admin.from('pools').insert({ tournament_id: tournamentId, name: 'Pool A', position: 0 }).select('id').single();
    if (pool.error) throw pool.error;

    const match = await admin.from('matches').insert({
      tournament_id: tournamentId, stage: 'pool', pool_id: pool.data.id, slot: 0,
      team_a_id: teamA.data.id, team_b_id: teamB.data.id, status: 'ready',
    }).select('id').single();
    if (match.error) throw match.error;
    matchId = match.data.id;
  });

  it('only the first of two concurrent claims on the same match succeeds', async () => {
    // Both "requests" plan against the same before-state: status 'ready', winner_id null.
    const claim = () =>
      admin.from('matches')
        .update({ status: 'done', winner_id: null }) // winner_id set below once teamA id is known
        .eq('id', matchId).eq('status', 'ready').is('winner_id', null)
        .select('id');

    const first = await claim();
    expect(first.error).toBeNull();
    expect(first.data ?? []).toHaveLength(1);

    // Second claim replays the same before-state check; the row is no longer 'ready', so it must
    // match zero rows even though the update payload itself would otherwise be valid.
    const second = await claim();
    expect(second.error).toBeNull();
    expect(second.data ?? []).toHaveLength(0);
  });
});

// applyResultPlan is the shared writer used by both the per-game admin path and the participant
// confirmation path; a confirmed result must supersede any pending submission on that match.
describe.skipIf(!enabled)('applyResultPlan clears pending submissions', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let tournamentId: string;
  let matchId: string;
  let teamAId: string;
  let teamBId: string;
  const slug = `apply-result-plan-${Date.now().toString(36)}`;

  async function signedInClient(email: string): Promise<SupabaseClient> {
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const c = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await c.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return c;
  }

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    admin = await signedInClient(`admin-${slug}@example.com`);

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'applyResultPlan test' });
    if (t.error) throw t.error;
    tournamentId = t.data as string;

    const teamA = await admin.from('teams').insert({ tournament_id: tournamentId, name: 'Alpha' }).select('id').single();
    if (teamA.error) throw teamA.error;
    teamAId = teamA.data.id;
    const teamB = await admin.from('teams').insert({ tournament_id: tournamentId, name: 'Bravo' }).select('id').single();
    if (teamB.error) throw teamB.error;
    teamBId = teamB.data.id;

    const pool = await admin.from('pools').insert({ tournament_id: tournamentId, name: 'Pool A', position: 0 }).select('id').single();
    if (pool.error) throw pool.error;

    const match = await admin.from('matches').insert({
      tournament_id: tournamentId, stage: 'pool', pool_id: pool.data.id, slot: 0,
      team_a_id: teamAId, team_b_id: teamBId, status: 'ready',
    }).select('id').single();
    if (match.error) throw match.error;
    // A meeting owns its game slots from creation; a result is written into them, never inserted.
    const slots = await admin.from('games').insert(slotRowsFor(match.data.id, CLASSIC_BEST_OF_THREE.gamesPerMatch));
    if (slots.error) throw slots.error;
    matchId = match.data.id;

    const submission = await service.from('score_submissions').insert({
      match_id: matchId, submitted_by: 'team_a',
      games: [{ gameNo: 1, scoreA: 15, scoreB: 7 }],
    });
    if (submission.error) throw submission.error;
  });

  it('clears a pending submission for the primary match once its result is applied', async () => {
    const matchRows = await service.from('matches').select('*').eq('tournament_id', tournamentId);
    if (matchRows.error) throw matchRows.error;
    const rows = matchRows.data as MatchRow[];

    const games = [
      { gameNo: 1, scoreA: 15, scoreB: 7 },
      { gameNo: 2, scoreA: 15, scoreB: 9 },
    ];
    // Explicit best-of-three settings: this test asserts two written game rows.
    const plan = planResult({ settings: CLASSIC_BEST_OF_THREE, matches: rows.map(rowToMatch), matchId, games });
    if ('error' in plan) throw new Error(plan.message);

    const result = await applyResultPlan(service, {
      tournamentId, matchId, rows, plan, tournamentStatus: 'pools',
    });
    expect(result.ok).toBe(true);

    const updated = await service.from('matches').select('status').eq('id', matchId).single();
    if (updated.error) throw updated.error;
    expect(updated.data.status).toBe('done');

    const gameRows = await service.from('games').select('game_no, score_a, score_b').eq('match_id', matchId).order('game_no');
    if (gameRows.error) throw gameRows.error;
    // Three slots, always: the third game the result does not name is blanked, not removed.
    expect(gameRows.data).toEqual([
      { game_no: 1, score_a: 15, score_b: 7 }, { game_no: 2, score_a: 15, score_b: 9 }, { game_no: 3, score_a: null, score_b: null },
    ]);

    const subRows = await service.from('score_submissions').select('id').eq('match_id', matchId);
    if (subRows.error) throw subRows.error;
    expect(subRows.data).toHaveLength(0);
  });
});
