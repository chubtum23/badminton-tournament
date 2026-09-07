import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Game } from '@tournament/core';
import { applySubmission } from '@/lib/submissions/applySubmission';
import { planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';
import { rowToMatch, settingsFor } from '@/lib/db/mappers';
import type { MatchRow, SubmissionRow, TournamentRow } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

// The tournament is created with the DB defaults, which are the club format: one game to 15.
const WIN: Game[] = [{ gameNo: 1, scoreA: 15, scoreB: 7 }];
const OTHER: Game[] = [{ gameNo: 1, scoreA: 15, scoreB: 10 }];

/**
 * Drives the real participant submission path (`applySubmission`) against the real tables, plus
 * the admin "confirm one side's submission" path (`planResult` + `applyResultPlan`) that
 * confirmSubmission uses. The server actions themselves need a request-scoped cookie jar, so this
 * starts one layer below them, at the first function that talks to the database.
 */
describe.skipIf(!enabled)('applySubmission against the database', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let tournament: TournamentRow;
  const team: Record<string, string> = {};
  const match: Record<string, string> = {};
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

  const matchRow = async (id: string): Promise<MatchRow> => {
    const res = await service.from('matches').select('*').eq('id', id).single();
    if (res.error) throw res.error;
    return res.data as MatchRow;
  };
  const submissionsOf = async (id: string): Promise<SubmissionRow[]> => {
    const res = await service.from('score_submissions').select('id, match_id, submitted_by, games, created_at').eq('match_id', id);
    if (res.error) throw res.error;
    return res.data as SubmissionRow[];
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    admin = await signedInClient(`admin-${slug}@example.com`);

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'submissions test' });
    if (t.error) throw t.error;
    const loaded = await service.from('tournaments').select('*').eq('id', t.data as string).single();
    if (loaded.error) throw loaded.error;
    tournament = loaded.data as TournamentRow;

    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']) {
      const res = await admin.from('teams').insert({ tournament_id: tournament.id, name }).select('id').single();
      if (res.error) throw res.error;
      team[name] = res.data.id as string;
    }
    const pool = await admin.from('pools').insert({ tournament_id: tournament.id, name: 'Pool A', position: 0 }).select('id').single();
    if (pool.error) throw pool.error;

    // Three independent pool matches, one per scenario below.
    const pairs: Array<[string, string, string]> = [
      ['agree', 'Alpha', 'Bravo'], ['resolved', 'Charlie', 'Delta'], ['admin', 'Echo', 'Foxtrot'],
    ];
    for (const [i, [key, a, b]] of pairs.entries()) {
      const res = await admin.from('matches').insert({
        tournament_id: tournament.id, stage: 'pool', pool_id: pool.data.id, slot: i,
        team_a_id: team[a], team_b_id: team[b], status: 'ready',
      }).select('id').single();
      if (res.error) throw res.error;
      match[key] = res.data.id as string;
    }
  });

  it('records the first submission and moves the match to submitted', async () => {
    const r = await applySubmission(service, { tournament, teamId: team.Alpha!, matchId: match.agree!, games: WIN });
    expect(r).toEqual({ ok: true, outcome: 'submitted' });
    expect((await matchRow(match.agree!)).status).toBe('submitted');
    const subs = await submissionsOf(match.agree!);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.submitted_by).toBe('team_a');
  });

  it('confirms when the opponent submits the same games, writing games and clearing submissions', async () => {
    const r = await applySubmission(service, { tournament, teamId: team.Bravo!, matchId: match.agree!, games: WIN });
    expect(r).toEqual({ ok: true, outcome: 'confirmed' });

    const row = await matchRow(match.agree!);
    expect(row.status).toBe('done');
    expect(row.winner_id).toBe(team.Alpha);
    expect(row.finished_at).not.toBeNull();

    const games = await service.from('games').select('game_no, score_a, score_b').eq('match_id', match.agree!).order('game_no');
    if (games.error) throw games.error;
    expect(games.data).toEqual([{ game_no: 1, score_a: 15, score_b: 7 }]);

    expect(await submissionsOf(match.agree!)).toHaveLength(0);
  });

  it('disputes when the opponent submits different games', async () => {
    const first = await applySubmission(service, { tournament, teamId: team.Charlie!, matchId: match.resolved!, games: WIN });
    expect(first).toEqual({ ok: true, outcome: 'submitted' });

    const second = await applySubmission(service, { tournament, teamId: team.Delta!, matchId: match.resolved!, games: OTHER });
    expect(second).toEqual({ ok: true, outcome: 'disputed' });

    expect((await matchRow(match.resolved!)).status).toBe('disputed');
    expect(await submissionsOf(match.resolved!)).toHaveLength(2);
  });

  it('confirms a disputed match when the disputing side resubmits matching games', async () => {
    const r = await applySubmission(service, { tournament, teamId: team.Delta!, matchId: match.resolved!, games: WIN });
    expect(r).toEqual({ ok: true, outcome: 'confirmed' });

    const row = await matchRow(match.resolved!);
    expect(row.status).toBe('done');
    expect(row.winner_id).toBe(team.Charlie);
    expect(await submissionsOf(match.resolved!)).toHaveLength(0);
  });

  it('lets an admin resolve a dispute from one stored submission', async () => {
    expect((await applySubmission(service, { tournament, teamId: team.Echo!, matchId: match.admin!, games: WIN })).ok).toBe(true);
    expect(await applySubmission(service, { tournament, teamId: team.Foxtrot!, matchId: match.admin!, games: OTHER }))
      .toEqual({ ok: true, outcome: 'disputed' });

    // What confirmSubmission does: take the chosen submission's games and persist them as the result.
    const chosen = (await submissionsOf(match.admin!)).find((s) => s.submitted_by === 'team_a');
    expect(chosen).toBeDefined();
    const rowsRes = await service.from('matches').select('*').eq('tournament_id', tournament.id);
    if (rowsRes.error) throw rowsRes.error;
    const rows = rowsRes.data as MatchRow[];
    const plan = planResult({
      settings: settingsFor(tournament, 'pool'), matches: rows.map(rowToMatch), matchId: match.admin!, games: chosen!.games,
    });
    if ('error' in plan) throw new Error(plan.message);
    const persisted = await applyResultPlan(service, {
      tournamentId: tournament.id, matchId: match.admin!, rows, plan, tournamentStatus: tournament.status,
    });
    expect(persisted.ok).toBe(true);

    const row = await matchRow(match.admin!);
    expect(row.status).toBe('done');
    expect(row.winner_id).toBe(team.Echo);
    expect(await submissionsOf(match.admin!)).toHaveLength(0);
  });
});
