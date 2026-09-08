import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { listGames, listMatches, listSubmissions } from '@/lib/db/queries';
import { settingsFor, slotRowsFor } from '@/lib/db/mappers';
import { syncMatchStatus } from '@/lib/schedule/status';
import type { MatchRow, TournamentRow } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

/**
 * A meeting's status has to follow its games. `startGame` and `takeGameOffCourt` write the game row
 * and then hand off to `syncMatchStatus`, which reads the meeting's games back to decide between
 * 'live' and 'ready'. That read-after-write is the thing under test: memoising `listGames` per
 * request (React `cache`) made `syncMatchStatus` see the rows as they were *before* the write, so a
 * meeting stayed 'ready' with a game on court and stayed 'live' after the last court was cleared.
 *
 * The server actions themselves need a request-scoped cookie jar, so this drives the helper they
 * both call, against the real tables, in the same order the actions do: write the game, then sync.
 */
/**
 * The behavioural test below runs outside a React request scope, where `cache()` falls through to
 * calling the function — so it alone cannot fail on the memoisation bug. This does: React's `cache`
 * returns a rest-args wrapper of arity 0, so a query that is memoised is structurally detectable.
 * Any query a server action re-reads after writing must stay a plain function.
 */
describe('queries a server action re-reads after writing are not request-memoised', () => {
  it.each([['listGames', listGames], ['listMatches', listMatches], ['listSubmissions', listSubmissions]] as const)(
    '%s takes its arguments directly rather than through a cache() wrapper',
    (_name, fn) => { expect(fn.length).toBe(2); },
  );
});

describe.skipIf(!enabled)('match status follows its games', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let tournament: TournamentRow;
  let matchId: string;
  const slug = `game-status-${Date.now().toString(36)}`;

  async function signedInClient(email: string): Promise<SupabaseClient> {
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const c = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await c.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return c;
  }

  const matchRow = async (): Promise<MatchRow> => {
    const res = await service.from('matches').select('*').eq('id', matchId).single();
    if (res.error) throw res.error;
    return res.data as MatchRow;
  };

  /** Exactly what `startGame` writes for one game, minus the status sync. */
  const sendToCourt = async (gameNo: number, court: number): Promise<void> => {
    const upd = await service.from('games')
      .update({ court, started_at: new Date().toISOString() })
      .eq('match_id', matchId).eq('game_no', gameNo).is('score_a', null).select('game_no');
    if (upd.error) throw upd.error;
    expect(upd.data).toHaveLength(1);
  };

  /** Exactly what `takeGameOffCourt` writes, minus the status sync. */
  const clearCourt = async (gameNo: number): Promise<void> => {
    const upd = await service.from('games')
      .update({ court: null, started_at: null, paused_at: null, paused_ms: 0 })
      .eq('match_id', matchId).eq('game_no', gameNo).is('score_a', null).select('game_no');
    if (upd.error) throw upd.error;
    expect(upd.data).toHaveLength(1);
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    admin = await signedInClient(`admin-${slug}@example.com`);

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'game status test' });
    if (t.error) throw t.error;
    const loaded = await service.from('tournaments').select('*').eq('id', t.data as string).single();
    if (loaded.error) throw loaded.error;
    tournament = loaded.data as TournamentRow;

    const a = await admin.from('teams').insert({ tournament_id: tournament.id, name: 'Alpha' }).select('id').single();
    if (a.error) throw a.error;
    const b = await admin.from('teams').insert({ tournament_id: tournament.id, name: 'Bravo' }).select('id').single();
    if (b.error) throw b.error;

    const pool = await admin.from('pools').insert({ tournament_id: tournament.id, name: 'Pool A', position: 0 }).select('id').single();
    if (pool.error) throw pool.error;

    const match = await admin.from('matches').insert({
      tournament_id: tournament.id, stage: 'pool', pool_id: pool.data.id, slot: 0,
      team_a_id: a.data.id, team_b_id: b.data.id, status: 'ready',
    }).select('id').single();
    if (match.error) throw match.error;
    matchId = match.data.id as string;

    const slots = await admin.from('games').insert(slotRowsFor(matchId, settingsFor(tournament, 'pool').gamesPerMatch));
    if (slots.error) throw slots.error;
  });

  it('starts out ready with no game on court', async () => {
    expect((await matchRow()).status).toBe('ready');
  });

  it('goes live once a game is sent to a court', async () => {
    await sendToCourt(1, 1);
    await syncMatchStatus(service, tournament.id, matchId);
    const row = await matchRow();
    expect(row.status).toBe('live');

    const g = await service.from('games').select('court, started_at').eq('match_id', matchId).eq('game_no', 1).single();
    if (g.error) throw g.error;
    expect(g.data.court).toBe(1);
    expect(g.data.started_at).not.toBeNull();
  });

  it('stays live while a second game is also on court, and after the first comes off', async () => {
    await sendToCourt(2, 2);
    await syncMatchStatus(service, tournament.id, matchId);
    expect((await matchRow()).status).toBe('live');

    await clearCourt(1);
    await syncMatchStatus(service, tournament.id, matchId);
    expect((await matchRow()).status).toBe('live');
  });

  it('goes back to ready once the last court is cleared', async () => {
    await clearCourt(2);
    await syncMatchStatus(service, tournament.id, matchId);
    expect((await matchRow()).status).toBe('ready');
  });

  it('is live again once a game has a score, even with no court held', async () => {
    const upd = await service.from('games')
      .update({ score_a: 15, score_b: 10, time_expired: false, court: null, started_at: null })
      .eq('match_id', matchId).eq('game_no', 1).select('game_no');
    if (upd.error) throw upd.error;
    await syncMatchStatus(service, tournament.id, matchId);
    expect((await matchRow()).status).toBe('live');
  });
});
