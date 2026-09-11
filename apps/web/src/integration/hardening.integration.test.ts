import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

/** Pre-launch hardening: an organiser of one tournament cannot reach into another, and the result lock. */
describe.skipIf(!enabled)('cross-tournament guards and the result lock', () => {
  let anon: SupabaseClient;
  let service: SupabaseClient;
  let victim: SupabaseClient;
  let attacker: SupabaseClient;
  let victimT: string;
  let victimPool: string;
  let victimPlayer: string;
  let attackerTeam: string;
  const slug = `hard-${Date.now().toString(36)}`;

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
    victim = await signedInClient(`victim-${slug}@example.com`);
    attacker = await signedInClient(`attacker-${slug}@example.com`);

    const vt = await victim.rpc('create_tournament', { p_slug: `${slug}-v`, p_name: 'Victim' });
    if (vt.error) throw vt.error;
    victimT = vt.data as string;
    const vteam = await victim.rpc('admin_add_team', { p_tournament: victimT, p_name: 'Victims', p_mixed1: 'Al', p_mixed2: 'Bo', p_woman: 'Cy' });
    if (vteam.error) throw vteam.error;
    const link = await anon.from('team_players').select('player_id').eq('team_id', vteam.data as string).limit(1).single();
    if (link.error) throw link.error;
    victimPlayer = link.data.player_id;
    const pool = await victim.from('pools').insert({ tournament_id: victimT, name: 'Pool A', position: 1 }).select('id').single();
    if (pool.error) throw pool.error;
    victimPool = pool.data.id;

    const at = await attacker.rpc('create_tournament', { p_slug: `${slug}-a`, p_name: 'Attacker' });
    if (at.error) throw at.error;
    const ateam = await attacker.from('teams').insert({ tournament_id: at.data as string, name: 'Raiders' }).select('id').single();
    if (ateam.error) throw ateam.error;
    attackerTeam = ateam.data.id;
  });

  it("cannot link its own team to another tournament's player", async () => {
    const res = await attacker.from('team_players').insert({ team_id: attackerTeam, player_id: victimPlayer, role: 'mixed1' });
    expect(res.error).not.toBeNull();
    const still = await service.from('players').select('id').eq('id', victimPlayer);
    expect(still.data ?? []).toHaveLength(1);
  });

  it("cannot move its own team into another tournament's pool", async () => {
    const res = await attacker.from('teams').update({ pool_id: victimPool }).eq('id', attackerTeam).select('id');
    expect(res.error).not.toBeNull();
  });

  it("cannot point its own team's photo at another tournament's folder", async () => {
    const path = `${victimT}/${randomUUID().replace(/-/g, '')}.jpg`;
    const res = await attacker.from('teams').update({ photo_path: path }).eq('id', attackerTeam).select('id');
    expect(res.error).not.toBeNull();
  });

  it('an organiser cannot delete a whole tournament through the API', async () => {
    const res = await victim.from('tournaments').delete().eq('id', victimT).select('id');
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
    const still = await service.from('tournaments').select('id').eq('id', victimT);
    expect(still.data ?? []).toHaveLength(1);
  });

  it('the result lock admits one holder at a time and frees on release', async () => {
    const h1 = randomUUID(), h2 = randomUUID();
    expect((await victim.rpc('try_result_lock', { p_tournament: victimT, p_holder: h1 })).data).toBe(true);
    expect((await victim.rpc('try_result_lock', { p_tournament: victimT, p_holder: h2 })).data).toBe(false);
    // Team submissions take it with the service role.
    expect((await service.rpc('try_result_lock', { p_tournament: victimT, p_holder: h2 })).data).toBe(false);
    await victim.rpc('release_result_lock', { p_tournament: victimT, p_holder: h1 });
    const svc = await service.rpc('try_result_lock', { p_tournament: victimT, p_holder: h2 });
    expect(svc.error).toBeNull();
    expect(svc.data).toBe(true);
    await service.rpc('release_result_lock', { p_tournament: victimT, p_holder: h2 });
  });

  it('an expired lease can be taken over', async () => {
    const h1 = randomUUID(), h2 = randomUUID();
    // The shortest lease the function allows is one second.
    expect((await victim.rpc('try_result_lock', { p_tournament: victimT, p_holder: h1, p_ttl_ms: 1 })).data).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await victim.rpc('try_result_lock', { p_tournament: victimT, p_holder: h2 })).data).toBe(true);
    await victim.rpc('release_result_lock', { p_tournament: victimT, p_holder: h2 });
  });

  it("outsiders and anonymous visitors cannot take a tournament's lock", async () => {
    const out = await attacker.rpc('try_result_lock', { p_tournament: victimT, p_holder: randomUUID() });
    expect(out.error).not.toBeNull();
    const an = await anon.rpc('try_result_lock', { p_tournament: victimT, p_holder: randomUUID() });
    expect(an.error).not.toBeNull();
  });
});
