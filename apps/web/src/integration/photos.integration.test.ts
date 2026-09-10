import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { uploadPhoto, deletePhotos } from '@/lib/photos/storage';
import { STORED } from '@/lib/photos/rules';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const enabled = Boolean(url && serviceKey && anonKey);

/** A real, tiny JPEG: SOI, a comment segment, EOI. Enough to pass the magic-number check. */
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x04, 0x41, 0x42, 0xff, 0xd9]);

/** A JPEG-shaped buffer of a given size: real SOI marker up front, padded out like a resized photo. */
function jpegOfSize(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  b.set([0xff, 0xd8, 0xff], 0);
  return b;
}

describe.skipIf(!enabled)('team photos', () => {
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

  it('signs a team up with a photo', async () => {
    const up = await service.storage.from('player-photos').upload(path(), jpegBytes, { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();
    const res = await service.rpc('sign_up_team', {
      p_slug: slug, p_join_code: null, p_name: 'Photo Team', p_tagline: '', p_colour: '#2B3390',
      p_description: '', p_mixed1: 'Alex', p_mixed2: 'Ben', p_woman: 'Priya',
      p_photo: path(),
    });
    expect(res.error).toBeNull();
    const row = await service.from('teams').select('name, photo_path').eq('tournament_id', tournamentId).eq('name', 'Photo Team').single();
    expect(row.data).toEqual({ name: 'Photo Team', photo_path: path() });
  });

  it('signs a team up without a photo', async () => {
    const res = await service.rpc('sign_up_team', {
      p_slug: slug, p_join_code: null, p_name: 'No Photo Team', p_tagline: '', p_colour: '#2B3390',
      p_description: '', p_mixed1: 'Cam', p_mixed2: 'Dev', p_woman: 'Ella',
    });
    expect(res.error).toBeNull();
    const row = await service.from('teams').select('name, photo_path').eq('tournament_id', tournamentId).eq('name', 'No Photo Team').single();
    expect(row.data).toEqual({ name: 'No Photo Team', photo_path: null });
  });

  it('refuses a path that is not shaped like one of ours', async () => {
    const bad = await service.from('teams').update({ photo_path: '../secrets.jpg' })
      .eq('tournament_id', tournamentId).eq('name', 'Photo Team').select('id');
    expect(bad.error).not.toBeNull();
  });
});

describe.skipIf(!enabled)('uploadPhoto / deletePhotos', () => {
  let service: SupabaseClient;
  let tournamentId: string;
  const slug = `photos-storage-${Date.now().toString(36)}`;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    const email = `admin-${slug}@example.com`;
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const admin = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await admin.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const t = await admin.rpc('create_tournament', { p_slug: slug, p_name: 'Photo storage test' });
    if (t.error) throw t.error;
    tournamentId = t.data as string;
  });

  it('uploads a resized-JPEG-shaped file and lands at the expected path', async () => {
    const file = new File([jpegOfSize(80_000)], 'photo.jpg', { type: 'image/jpeg' });
    const path = await uploadPhoto(service, tournamentId, file);
    expect(path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f]{32}\.jpg$/);
    const dl = await service.storage.from('player-photos').download(path!);
    expect(dl.error).toBeNull();
  });

  it('rejects bytes that are not a JPEG and stores nothing', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0])], 'photo.png', { type: 'image/jpeg' });
    const before = await service.storage.from('player-photos').list(tournamentId);
    const path = await uploadPhoto(service, tournamentId, file);
    expect(path).toBeNull();
    const after = await service.storage.from('player-photos').list(tournamentId);
    expect((after.data ?? []).length).toBe((before.data ?? []).length);
  });

  it('rejects a file over 400 KB and stores nothing', async () => {
    const file = new File([jpegOfSize(STORED.maxBytes + 1)], 'photo.jpg', { type: 'image/jpeg' });
    const before = await service.storage.from('player-photos').list(tournamentId);
    const path = await uploadPhoto(service, tournamentId, file);
    expect(path).toBeNull();
    const after = await service.storage.from('player-photos').list(tournamentId);
    expect((after.data ?? []).length).toBe((before.data ?? []).length);
  });

  it('deletes an object that exists, and does not throw on one that does not', async () => {
    const file = new File([jpegOfSize(50_000)], 'photo.jpg', { type: 'image/jpeg' });
    const path = await uploadPhoto(service, tournamentId, file);
    expect(path).not.toBeNull();
    await expect(deletePhotos(service, [path!, `${tournamentId}/${'0'.repeat(32)}.jpg`])).resolves.toBeUndefined();
    const dl = await service.storage.from('player-photos').download(path!);
    expect(dl.error).not.toBeNull();
  });
});
