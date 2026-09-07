import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { matchResult } from '@tournament/core';
import { planResult } from '@/lib/results/apply';
import { applyResultPlan } from '@/lib/results/persist';
import { rowToMatch, settingsFor, slotRowsFor } from '@/lib/db/mappers';
import { listGames } from '@/lib/db/queries';
import { firstFreeCourt } from '@/lib/schedule/plan';
import type { GameRow, MatchRow, TournamentRow } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

/**
 * The per-game model against the real tables: a meeting owns three game slots from the moment it
 * exists, each game goes to its own court and is scored on its own, and only the last score
 * finishes the meeting. The server actions need a request-scoped cookie jar, so this drives the
 * layer immediately below them — the same reads and writes `saveGameScore` performs.
 */
describe.skipIf(!enabled)('scoring a meeting one game at a time', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let tournament: TournamentRow;
  let matchId: string;
  let teamAId: string;
  let teamBId: string;
  const slug = `per-game-${Date.now().toString(36)}`;

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
  const slotsOf = async (id: string): Promise<GameRow[]> =>
    (await listGames(service, tournament.id)).filter((g) => g.match_id === id).sort((x, y) => x.game_no - y.game_no);

  /** What saveGameScore writes for one finished game: the score, and the game off court. */
  const score = async (gameNo: number, scoreA: number, scoreB: number): Promise<void> => {
    const upd = await service.from('games')
      .update({ score_a: scoreA, score_b: scoreB, time_expired: false, court: null, started_at: null, paused_at: null, paused_ms: 0 })
      .eq('match_id', matchId).eq('game_no', gameNo).select('game_no');
    if (upd.error) throw upd.error;
    expect(upd.data).toHaveLength(1);
  };

  /** The scored slots of the meeting, in the shape the rules package consumes. */
  const playedGames = async () =>
    (await slotsOf(matchId))
      .filter((g) => g.score_a !== null && g.score_b !== null)
      .map((g) => ({ gameNo: g.game_no, scoreA: g.score_a!, scoreB: g.score_b!, timeExpired: g.time_expired }));

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    admin = await signedInClient(`admin-${slug}@example.com`);

    // The DB defaults are the club format: three games to 15, every game played.
    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'per game test' });
    if (t.error) throw t.error;
    const loaded = await service.from('tournaments').select('*').eq('id', t.data as string).single();
    if (loaded.error) throw loaded.error;
    tournament = loaded.data as TournamentRow;
    expect(settingsFor(tournament, 'pool')).toMatchObject({ gamesPerMatch: 3, pointsPerGame: 15, playAllGames: true });

    const a = await admin.from('teams').insert({ tournament_id: tournament.id, name: 'Alpha' }).select('id').single();
    if (a.error) throw a.error;
    teamAId = a.data.id as string;
    const b = await admin.from('teams').insert({ tournament_id: tournament.id, name: 'Bravo' }).select('id').single();
    if (b.error) throw b.error;
    teamBId = b.data.id as string;

    const pool = await admin.from('pools').insert({ tournament_id: tournament.id, name: 'Pool A', position: 0 }).select('id').single();
    if (pool.error) throw pool.error;

    const match = await admin.from('matches').insert({
      tournament_id: tournament.id, stage: 'pool', pool_id: pool.data.id, slot: 0,
      team_a_id: teamAId, team_b_id: teamBId, status: 'ready',
    }).select('id').single();
    if (match.error) throw match.error;
    matchId = match.data.id as string;

    // A meeting owns its game slots from creation; the app's match-creation path inserts these.
    const slots = await admin.from('games').insert(slotRowsFor(matchId, settingsFor(tournament, 'pool').gamesPerMatch));
    if (slots.error) throw slots.error;
  });

  it('gives the meeting three empty, unscheduled slots', async () => {
    const slots = await slotsOf(matchId);
    expect(slots.map((g) => g.game_no)).toEqual([1, 2, 3]);
    expect(slots.every((g) => g.score_a === null && g.court === null && g.started_at === null && g.paused_ms === 0)).toBe(true);
  });

  it('sends one game to a court without disturbing the other two, and the next game gets the next court', async () => {
    const upd = await service.from('games')
      .update({ court: 1, started_at: new Date().toISOString() })
      .eq('match_id', matchId).eq('game_no', 1).select('game_no');
    if (upd.error) throw upd.error;
    expect(upd.data).toHaveLength(1);

    const slots = await slotsOf(matchId);
    expect(slots[0]).toMatchObject({ game_no: 1, court: 1 });
    expect(slots[0]!.started_at).not.toBeNull();
    // The other two games of the same meeting are untouched: they are separate fixtures.
    expect(slots.slice(1).every((g) => g.court === null && g.started_at === null)).toBe(true);

    // Court 1 is now held by a running game, so the next game called goes to court 2.
    expect(firstFreeCourt(await listGames(service, tournament.id), tournament.court_count)).toBe(2);
  });

  it('leaves the meeting undecided while a game is still to be played', async () => {
    await score(1, 15, 9);
    await score(2, 15, 11);

    const slots = await slotsOf(matchId);
    // Scoring game 1 also took it off court and stopped its clock.
    expect(slots[0]).toMatchObject({ score_a: 15, score_b: 9, court: null, started_at: null, paused_ms: 0 });
    expect(slots[2]).toMatchObject({ game_no: 3, score_a: null, score_b: null });

    // Every game is played in this format, so two wins do not end the meeting yet.
    const result = matchResult(settingsFor(tournament, 'pool'), await playedGames());
    expect(result).toMatchObject({ ok: true, complete: false, winner: null });
    expect((await matchRow(matchId)).status).not.toBe('done');
  });

  it('finishes the meeting on the last game, keeping all three slots', async () => {
    await score(3, 8, 15);
    const games = await playedGames();
    expect(games).toHaveLength(3);

    const settings = settingsFor(tournament, 'pool');
    expect(matchResult(settings, games)).toMatchObject({ ok: true, complete: true, winner: 'a', gamesA: 2, gamesB: 1 });

    const rowsRes = await service.from('matches').select('*').eq('tournament_id', tournament.id);
    if (rowsRes.error) throw rowsRes.error;
    const rows = rowsRes.data as MatchRow[];
    const plan = planResult({ settings, matches: rows.map(rowToMatch), matchId, games });
    if ('error' in plan) throw new Error(plan.message);
    expect(plan.winnerId).toBe(teamAId);

    const persisted = await applyResultPlan(service, {
      tournamentId: tournament.id, matchId, rows, plan, tournamentStatus: tournament.status,
    });
    expect(persisted).toEqual({ ok: true });

    const row = await matchRow(matchId);
    expect(row.status).toBe('done');
    expect(row.winner_id).toBe(teamAId);
    expect(row.finished_at).not.toBeNull();

    // applyResultPlan updates the slots in place: still three rows, all scored, none on a court.
    const slots = await slotsOf(matchId);
    expect(slots.map((g) => [g.game_no, g.score_a, g.score_b])).toEqual([[1, 15, 9], [2, 15, 11], [3, 8, 15]]);
    expect(slots.every((g) => g.court === null && g.started_at === null && g.paused_at === null && g.paused_ms === 0)).toBe(true);
    expect(teamBId).not.toBe(row.winner_id);
  });
});
