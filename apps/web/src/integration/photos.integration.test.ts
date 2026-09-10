import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const enabled = Boolean(url && serviceKey && anonKey);

/** A real, tiny JPEG: SOI, a comment segment, EOI. Enough to pass the magic-number check. */
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x04, 0x41, 0x42, 0xff, 0xd9]);

describe.skipIf(!enabled)('player photos', () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let tournamentId: string;
  const slug = `photos-${Date.now().toString(36)}`;
  const path = () => `${tournamentId}/${'ab'.repeat(16)}.jpg`;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const email = `admin-${slug}@example.com`;
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const admin = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await admin.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'Photo test' });
    if (t.error) throw t.error;
    tournamentId = t.data as string;
  });

  it('anon cannot write to the bucket', async () => {
    const up = await anon.storage.from('player-photos').upload(`${tournamentId}/${'cd'.repeat(16)}.jpg`, jpegBytes, { contentType: 'image/jpeg' });
    expect(up.error).not.toBeNull();
  });

  it('signs a team up with one photo and two without', async () => {
    const up = await service.storage.from('player-photos').upload(path(), jpegBytes, { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();
    const res = await service.rpc('sign_up_team', {
      p_slug: slug, p_join_code: null, p_name: 'Photo Team', p_tagline: '', p_colour: '#2B3390',
      p_description: '', p_mixed1: 'Alex', p_mixed2: 'Ben', p_woman: 'Priya',
      p_photo1: path(), p_photo2: null, p_photow: null,
    });
    expect(res.error).toBeNull();
    const rows = await service.from('players').select('name, photo_path').eq('tournament_id', tournamentId);
    expect(rows.data).toEqual(expect.arrayContaining([
      { name: 'Alex', photo_path: path() },
      { name: 'Ben', photo_path: null },
    ]));
  });

  it('refuses a path that is not shaped like one of ours', async () => {
    const bad = await service.from('players').update({ photo_path: '../secrets.jpg' })
      .eq('tournament_id', tournamentId).eq('name', 'Ben').select('id');
    expect(bad.error).not.toBeNull();
  });

  it('keeps a photo with its player when a swap moves them between roles', async () => {
    const team = await service.from('teams').select('id').eq('tournament_id', tournamentId).single();
    // swapMixed passes the paths swapped along with the names, so Alex keeps his face at Mixed #2.
    const res = await service.rpc('write_roster', {
      p_team: team.data!.id, p_mixed1: 'Ben', p_mixed2: 'Alex', p_woman: 'Priya',
      p_photo1: null, p_photo2: path(), p_photow: null,
    });
    expect(res.error).toBeNull();
    const alex = await service.from('players').select('photo_path').eq('tournament_id', tournamentId).eq('name', 'Alex').single();
    expect(alex.data!.photo_path).toBe(path());
  });
});
