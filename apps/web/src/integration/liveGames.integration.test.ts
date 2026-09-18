import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { settingsFor, slotRowsFor } from '@/lib/db/mappers';
import { parsePush } from '@/lib/results/liveSheet';
import type { TournamentRow } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

/** The shared score sheet: organisers write it through push_live_game, everyone reads it. */
describe.skipIf(!enabled)('live score sheets', () => {
  let anon: SupabaseClient;
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let stranger: SupabaseClient;
  let tournament: TournamentRow;
  let matchId: string;
  const slug = `live-${Date.now().toString(36)}`;

  async function signedInClient(email: string): Promise<SupabaseClient> {
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const c = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await c.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return c;
  }

  const push = (c: SupabaseClient, gameNo: number, rallies: string, rev: number, server = 0, receiver = 2) =>
    c.rpc('push_live_game', { p_match: matchId, p_game: gameNo, p_server: server, p_receiver: receiver, p_rallies: rallies, p_rev: rev });

  beforeAll(async () => {
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    admin = await signedInClient(`admin-${slug}@example.com`);
    stranger = await signedInClient(`stranger-${slug}@example.com`);

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'live test' });
    if (t.error) throw t.error;
    const loaded = await service.from('tournaments').select('*').eq('id', t.data as string).single();
    if (loaded.error) throw loaded.error;
    tournament = loaded.data as TournamentRow;
    const a = await admin.from('teams').insert({ tournament_id: tournament.id, name: 'Alpha' }).select('id').single();
    const b = await admin.from('teams').insert({ tournament_id: tournament.id, name: 'Bravo' }).select('id').single();
    if (a.error || b.error) throw a.error ?? b.error;
    const match = await admin.from('matches').insert({
      tournament_id: tournament.id, stage: 'knockout', slot: 0, round: 1,
      team_a_id: a.data.id, team_b_id: b.data.id, status: 'ready',
    }).select('id').single();
    if (match.error) throw match.error;
    matchId = match.data.id as string;
    const slots = await admin.from('games').insert(slotRowsFor(matchId, settingsFor(tournament, 'knockout').gamesPerMatch));
    if (slots.error) throw slots.error;
  });

  it('an organiser starts a sheet and anyone can read it', async () => {
    const res = await push(admin, 1, 'ab', 0);
    expect(res.error).toBeNull();
    expect(parsePush(res.data)).toEqual({ kind: 'applied', row: { start: { server: 0, receiver: 2 }, rallies: ['a', 'b'], rev: 1 } });
    const seen = await anon.from('live_games').select('rallies, rev').eq('match_id', matchId).eq('game_no', 1).single();
    expect(seen.data).toEqual({ rallies: 'ab', rev: 1 });
  });

  it('a write on the current revision moves the sheet on', async () => {
    const res = await push(admin, 1, 'aba', 1);
    expect(parsePush(res.data)).toMatchObject({ kind: 'applied', row: { rev: 2 } });
  });

  it('a write on a stale revision is refused and handed the current sheet', async () => {
    const res = await push(admin, 1, 'abb', 1);
    expect(parsePush(res.data)).toEqual({ kind: 'stale', row: { start: { server: 0, receiver: 2 }, rallies: ['a', 'b', 'a'], rev: 2 } });
    // A second "first write" loses the same way rather than overwriting.
    expect(parsePush((await push(admin, 1, 'b', 0)).data)).toMatchObject({ kind: 'stale', row: { rev: 2 } });
  });

  it('nobody else can write: not the public, not another organiser, not directly', async () => {
    expect((await push(anon, 1, 'abab', 2)).error).not.toBeNull();
    expect((await push(stranger, 1, 'abab', 2)).error).not.toBeNull();
    // Straight at the table, as the public and as an organiser: no insert, update or delete gets in.
    for (const c of [anon, stranger, admin]) {
      const upd = await c.from('live_games').update({ rallies: 'bbbb' }).eq('match_id', matchId).select('rev');
      expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
      const ins = await c.from('live_games').insert({ match_id: matchId, game_no: 3, tournament_id: tournament.id, server: 0, receiver: 2, rallies: 'bbbb' });
      expect(ins.error).not.toBeNull();
      const del = await c.from('live_games').delete().eq('match_id', matchId).select('rev');
      expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    }
    const still = await service.from('live_games').select('rallies').eq('match_id', matchId).eq('game_no', 1).single();
    expect(still.data?.rallies).toBe('aba');
  });

  it('rejects a malformed sheet', async () => {
    expect((await push(admin, 2, 'abx', 0)).error).not.toBeNull();
    expect((await push(admin, 2, 'ab', 0, 0, 1)).error).not.toBeNull(); // server and receiver on one side
  });

  it('the sheet closes when the game gets its final score', async () => {
    const upd = await service.from('games').update({ score_a: 15, score_b: 9 }).eq('match_id', matchId).eq('game_no', 1);
    if (upd.error) throw upd.error;
    const gone = await service.from('live_games').select('rev').eq('match_id', matchId).eq('game_no', 1);
    expect(gone.data).toEqual([]);
    expect(parsePush((await push(admin, 1, 'abab', 2)).data)).toEqual({ kind: 'scored' });
  });
});
