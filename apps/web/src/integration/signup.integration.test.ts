import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TOURNAMENT_PUBLIC_COLUMNS } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

const roster = { p_mixed1: 'Alex', p_mixed2: 'Ben', p_woman: 'Priya' };
const profile = { p_tagline: 'smash', p_colour: '#dc2626', p_description: 'We like shuttles' };

describe.skipIf(!enabled)('team sign-up', () => {
  let anon: SupabaseClient;
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  let tournamentId: string;
  const slug = `signup-${Date.now().toString(36)}`;

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
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    admin = await signedInClient(`admin-${slug}@example.com`);
    outsider = await signedInClient(`outsider-${slug}@example.com`);
    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'Sign-up test' });
    if (t.error) throw t.error;
    tournamentId = t.data as string;
  });

  const signUp = (name: string, extra: Record<string, unknown> = {}) =>
    anon.rpc('sign_up_team', { p_slug: slug, p_join_code: null, p_name: name, ...profile, ...roster, ...extra });

  it('creates the team, three players with genders and roles, and returns the token once', async () => {
    const res = await signUp('Smashers');
    expect(res.error).toBeNull();
    expect(res.data).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const team = await service.from('teams').select('id, edit_token, description').eq('tournament_id', tournamentId).eq('name', 'Smashers').single();
    expect(team.data!.edit_token).toBe(res.data);
    expect(team.data!.description).toBe('We like shuttles');
    const links = await service.from('team_players').select('role, players(name, gender)').eq('team_id', team.data!.id);
    const got = (links.data as unknown as Array<{ role: string; players: { name: string; gender: string } }>)
      .map((l) => `${l.role}:${l.players.name}:${l.players.gender}`).sort();
    expect(got).toEqual(['mixed1:Alex:male', 'mixed2:Ben:male', 'woman:Priya:female']);
  });

  it('anon still cannot read the token afterwards', async () => {
    const res = await anon.from('teams').select('id, edit_token').eq('tournament_id', tournamentId);
    expect(res.error?.message ?? '').toMatch(/permission denied/i);
  });

  it('refuses a duplicate name, case-insensitively', async () => {
    const res = await signUp('SMASHERS');
    expect(res.error?.message).toBe('duplicate_name');
  });

  it('refuses a wrong join code once one is set, and accepts it trimmed and any case', async () => {
    await service.from('tournaments').update({ join_code: 'Club2026' }).eq('id', tournamentId);
    const bad = await signUp('Late Birds', { p_join_code: 'nope' });
    expect(bad.error?.message).toBe('bad_join_code');
    const good = await signUp('Late Birds', { p_join_code: '  club2026 ' });
    expect(good.error).toBeNull();
    await service.from('tournaments').update({ join_code: null }).eq('id', tournamentId);
  });

  it('refuses a blank player name', async () => {
    const res = await signUp('Blanks', { p_woman: '   ' });
    expect(res.error?.message).toBe('invalid_input');
  });

  it('refuses when sign-ups are closed and when the tournament has left setup', async () => {
    await service.from('tournaments').update({ signup_open: false }).eq('id', tournamentId);
    expect((await signUp('Closed Out')).error?.message).toBe('signup_closed');
    await service.from('tournaments').update({ signup_open: true, status: 'pools' }).eq('id', tournamentId);
    expect((await signUp('Too Late')).error?.message).toBe('signup_closed');
    await service.from('tournaments').update({ status: 'setup' }).eq('id', tournamentId);
  });

  it('anon cannot call write_roster or the admin functions', async () => {
    const team = await service.from('teams').select('id').eq('tournament_id', tournamentId).limit(1).single();
    expect((await anon.rpc('write_roster', { p_team: team.data!.id, ...roster })).error?.message ?? '').toMatch(/permission denied/i);
    expect((await anon.rpc('admin_set_roster', { p_team: team.data!.id, ...roster })).error?.message ?? '').toMatch(/permission denied/i);
    expect((await anon.rpc('admin_add_team', { p_tournament: tournamentId, p_name: 'Nope', ...roster })).error?.message ?? '').toMatch(/permission denied/i);
  });

  it('admin_add_team and admin_set_roster write a complete roster in one go', async () => {
    const added = await admin.rpc('admin_add_team', { p_tournament: tournamentId, p_name: 'Organiser Made', ...roster });
    expect(added.error).toBeNull();
    const set = await admin.rpc('admin_set_roster', { p_team: added.data as string, p_mixed1: 'Ben', p_mixed2: 'Alex', p_woman: 'Priya' });
    expect(set.error).toBeNull();
    const links = await service.from('team_players').select('role, players(name)').eq('team_id', added.data as string);
    const got = (links.data as unknown as Array<{ role: string; players: { name: string } }>).map((l) => `${l.role}:${l.players.name}`).sort();
    expect(got).toEqual(['mixed1:Ben', 'mixed2:Alex', 'woman:Priya']);
    const players = await service.from('players').select('id').eq('tournament_id', tournamentId);
    // 3 teams signed up here (Smashers, Late Birds, Organiser Made) → 9 players; a re-set must not leak the old three.
    expect(players.data).toHaveLength(9);
  });

  it('anon cannot read join_code but can read every other tournament column', async () => {
    const leak = await anon.from('tournaments').select('id, join_code').eq('id', tournamentId);
    expect(leak.error?.message ?? '').toMatch(/permission denied/i);
    const ok = await anon.from('tournaments').select(TOURNAMENT_PUBLIC_COLUMNS).eq('id', tournamentId);
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
  });

  it('signup_needs_code tells anon whether a code is set, without revealing it', async () => {
    expect((await anon.rpc('signup_needs_code', { p_slug: slug })).data).toBe(false);
    await service.from('tournaments').update({ join_code: 'Club2026' }).eq('id', tournamentId);
    expect((await anon.rpc('signup_needs_code', { p_slug: slug })).data).toBe(true);
    await service.from('tournaments').update({ join_code: null }).eq('id', tournamentId);
    expect((await anon.rpc('signup_needs_code', { p_slug: slug })).data).toBe(false);
  });

  it('only the tournament admin can read the join code back', async () => {
    await service.from('tournaments').update({ join_code: 'Club2026' }).eq('id', tournamentId);
    const mine = await admin.rpc('tournament_join_code', { t: tournamentId });
    expect(mine.error).toBeNull();
    expect(mine.data).toBe('Club2026');
    expect((await outsider.rpc('tournament_join_code', { t: tournamentId })).error?.message).toBe('not_admin');
    expect((await anon.rpc('tournament_join_code', { t: tournamentId })).error?.message ?? '').toMatch(/permission denied/i);
    await service.from('tournaments').update({ join_code: null }).eq('id', tournamentId);
  });

  it('a case-insensitive duplicate is refused by the function and by the index behind it', async () => {
    const seeded = await service.from('teams').insert({ tournament_id: tournamentId, name: 'Race' }).select('id').single();
    expect(seeded.error).toBeNull();
    expect((await signUp('race')).error?.message).toBe('duplicate_name');
    const direct = await service.from('teams').insert({ tournament_id: tournamentId, name: 'RACE' }).select('id');
    expect(direct.error?.code).toBe('23505');
  });

  it('the old add_teams function is gone', async () => {
    const res = await admin.rpc('add_teams', { p_tournament: tournamentId, p_teams: [] });
    expect(res.error).not.toBeNull();
  });
});
