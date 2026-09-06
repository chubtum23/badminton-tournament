import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BADMINTON_DEFAULTS } from '@tournament/core';
import { decideSubmission } from '@/lib/submissions/decide';
import { planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';
import { rowToMatch } from '@/lib/db/mappers';
import type { MatchRow, SubmissionRow } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

// End-to-end path: team_a submits, decideSubmission says 'submitted' and the match status moves;
// team_b then submits the same games, decideSubmission says 'confirmed', and applying the plan
// through applyResultPlan brings the match to 'done'. Exercises the real tables the participant
// and admin actions read and write, without going through the server actions themselves (those
// need a request-scoped cookie jar).
describe.skipIf(!enabled)('submission decide + persist path', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let tournamentId: string;
  let matchId: string;
  let teamAId: string;
  let teamBId: string;
  const slug = `submissions-${Date.now().toString(36)}`;

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

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'submissions test' });
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
    matchId = match.data.id;
  });

  it('team_a submitting moves the match to submitted', async () => {
    const games = [{ gameNo: 1, scoreA: 15, scoreB: 7 }, { gameNo: 2, scoreA: 15, scoreB: 9 }];
    const before = await service.from('matches').select('*').eq('id', matchId).single();
    if (before.error) throw before.error;
    const match = rowToMatch(before.data as MatchRow);

    const decision = decideSubmission({ settings: BADMINTON_DEFAULTS, match, side: 'a', games, latest: {} });
    expect(decision).toEqual({ outcome: 'submitted' });

    const ins = await service.from('score_submissions').insert({ match_id: matchId, submitted_by: 'team_a', games });
    if (ins.error) throw ins.error;
    const upd = await service.from('matches').update({ status: 'submitted' }).eq('id', matchId).eq('status', 'ready').select('id');
    if (upd.error) throw upd.error;
    expect(upd.data).toHaveLength(1);
  });

  it('a matching team_b submission confirms and applying the plan finishes the match', async () => {
    const games = [{ gameNo: 1, scoreA: 15, scoreB: 7 }, { gameNo: 2, scoreA: 15, scoreB: 9 }];

    const matchRow = await service.from('matches').select('*').eq('id', matchId).single();
    if (matchRow.error) throw matchRow.error;
    const match = rowToMatch(matchRow.data as MatchRow);
    expect(match.status).toBe('submitted');

    const subRows = await service.from('score_submissions').select('id, match_id, submitted_by, games, created_at').eq('match_id', matchId);
    if (subRows.error) throw subRows.error;
    const teamASub = (subRows.data as SubmissionRow[]).find((s) => s.submitted_by === 'team_a');
    expect(teamASub).toBeDefined();

    const decision = decideSubmission({ settings: BADMINTON_DEFAULTS, match, side: 'b', games, latest: { a: teamASub } });
    expect(decision).toEqual({ outcome: 'confirmed' });

    const ins = await service.from('score_submissions').insert({ match_id: matchId, submitted_by: 'team_b', games });
    if (ins.error) throw ins.error;

    const rowsRes = await service.from('matches').select('*').eq('tournament_id', tournamentId);
    if (rowsRes.error) throw rowsRes.error;
    const rows = rowsRes.data as MatchRow[];

    const plan = planResult({ settings: BADMINTON_DEFAULTS, matches: rows.map(rowToMatch), matchId, games });
    if ('error' in plan) throw new Error(plan.message);

    const persisted = await applyResultPlan(service, { tournamentId, matchId, rows, plan, tournamentStatus: 'pools' });
    expect(persisted.ok).toBe(true);

    const after = await service.from('matches').select('status, winner_id').eq('id', matchId).single();
    if (after.error) throw after.error;
    expect(after.data.status).toBe('done');
    expect(after.data.winner_id).toBe(teamAId);

    const remainingSubs = await service.from('score_submissions').select('id').eq('match_id', matchId);
    if (remainingSubs.error) throw remainingSubs.error;
    expect(remainingSubs.data).toHaveLength(0);
  });
});
