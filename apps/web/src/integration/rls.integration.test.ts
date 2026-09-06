import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TEAM_PUBLIC_COLUMNS } from '@/lib/db/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

describe.skipIf(!enabled)('row level security', () => {
  let anon: SupabaseClient;
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let outsider: SupabaseClient;
  let tournamentId: string;
  let teamId: string;
  const slug = `rls-${Date.now().toString(36)}`;

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

    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'RLS test' });
    if (t.error) throw t.error;
    tournamentId = t.data as string;
    const team = await admin.from('teams').insert({ tournament_id: tournamentId, name: 'Aces' }).select('id').single();
    if (team.error) throw team.error;
    teamId = team.data.id;
  });

  it('anon can read public team columns', async () => {
    const res = await anon.from('teams').select(TEAM_PUBLIC_COLUMNS).eq('id', teamId);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1);
  });

  it('anon cannot read edit_token', async () => {
    const res = await anon.from('teams').select('id, edit_token').eq('id', teamId);
    expect(res.error?.message ?? '').toMatch(/permission denied/i);
  });

  it('anon cannot insert a tournament', async () => {
    const res = await anon.from('tournaments').insert({ slug: `${slug}-x`, name: 'nope' });
    expect(res.error).not.toBeNull();
  });

  it('a signed-in non-admin cannot write to another tournament', async () => {
    const res = await outsider.from('teams').insert({ tournament_id: tournamentId, name: 'Intruders' }).select('id');
    // RLS violations surface as an error or as zero returned rows
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
    const upd = await outsider.from('tournaments').update({ name: 'hacked' }).eq('id', tournamentId).select('id');
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
  });

  it('an outsider cannot make themselves an admin of another tournament', async () => {
    const them = (await outsider.auth.getUser()).data.user!.id;
    const res = await outsider.from('tournament_admins')
      .insert({ tournament_id: tournamentId, user_id: them }).select('tournament_id');
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
    // The service client bypasses RLS, so this is the authoritative check that nothing landed.
    const check = await service.from('tournament_admins')
      .select('tournament_id').eq('tournament_id', tournamentId).eq('user_id', them);
    expect(check.error).toBeNull();
    expect(check.data ?? []).toHaveLength(0);
  });

  it('a signed-in outsider cannot insert a tournament directly', async () => {
    const res = await outsider.from('tournaments').insert({ slug: `${slug}-direct`, name: 'nope' }).select('id');
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
    const check = await service.from('tournaments').select('id').eq('slug', `${slug}-direct`);
    expect(check.data ?? []).toHaveLength(0);
  });

  it('anon cannot call create_tournament', async () => {
    const res = await anon.rpc('create_tournament', { p_slug: `${slug}-anon`, p_name: 'nope' });
    expect(res.error?.message ?? '').toMatch(/permission denied/i);
  });

  it('the admin can fetch edit tokens through the function; an outsider gets nothing', async () => {
    const mine = await admin.rpc('team_edit_tokens', { t: tournamentId });
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0].edit_token).toHaveLength(24);
    const theirs = await outsider.rpc('team_edit_tokens', { t: tournamentId });
    expect(theirs.data ?? []).toHaveLength(0);
  });

  it('regenerate_team_token changes the token for admins and is refused for outsiders', async () => {
    const before = (await service.from('teams').select('edit_token').eq('id', teamId).single()).data!.edit_token;
    const res = await admin.rpc('regenerate_team_token', { team: teamId });
    expect(res.error).toBeNull();
    expect(res.data).not.toBe(before);
    const denied = await outsider.rpc('regenerate_team_token', { team: teamId });
    expect(denied.error).not.toBeNull();
  });
});
