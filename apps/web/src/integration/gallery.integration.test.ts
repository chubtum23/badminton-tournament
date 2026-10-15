import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
const { syncGallery } = await import('@/lib/gallery/sync');
const { listAlbumPhotos, listGalleryAlbums, listHighlights } = await import('@/lib/db/queries');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const enabled = Boolean(url && serviceKey && anonKey);

/** A fake Drive: folder id -> listing, and every image renders as a 300x200 JPEG. */
type Fake = Record<string, { title: string; entries: { id: string; name: string; folder?: boolean }[] }>;
const jpeg300x200 = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x2c, 0x03, 0, 0, 0, 0, 0]);

function fakeDrive(drive: Fake, failFolder?: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.hostname === 'drive.google.com') {
      const id = u.searchParams.get('id')!;
      if (id === failFolder || !drive[id]) return new Response('nope', { status: 500 });
      const body = drive[id]!.entries.map((e) => {
        const href = e.folder ? `https://drive.google.com/drive/folders/${e.id}` : `https://drive.google.com/file/d/${e.id}/view`;
        return `<div class="flip-entry" id="entry-${e.id}"><a href="${href}"><div class="flip-entry-title">${e.name}</div></a></div>`;
      }).join('');
      return new Response(`<html><title>${drive[id]!.title}</title>${body}</html>`);
    }
    if (u.hostname === 'lh3.googleusercontent.com') return new Response(jpeg300x200);
    return realFetch(input, init);
  }));
}

const realFetch = globalThis.fetch;
afterEach(() => { vi.unstubAllGlobals(); globalThis.fetch = realFetch; });

describe.skipIf(!enabled)('photo gallery from Drive', () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let other: SupabaseClient;
  let tournamentId: string;
  const stamp = Date.now().toString(36);
  const ROOT = 'root_folder_0001';

  async function adminFor(slug: string): Promise<{ client: SupabaseClient; id: string }> {
    const email = `admin-${slug}@example.com`;
    const password = 'Passw0rd!Passw0rd!';
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const t = await client.rpc('create_tournament', { p_slug: slug, p_name: 'Gallery test' });
    if (t.error) throw t.error;
    return { client, id: t.data as string };
  }

  const drive: Fake = {
    [ROOT]: { title: 'Badminton Photos', entries: [{ id: 'wk1_folder_01', name: 'Week 1', folder: true }, { id: 'wk2_folder_01', name: 'Week 2', folder: true }] },
    wk1_folder_01: { title: 'Week 1', entries: [
      { id: 'f_j1', name: 'DSC1.JPG' }, { id: 'f_j1_copy', name: 'DSC1 2.JPG' }, { id: 'f_junk', name: '._DSC1.JPG' },
      { id: 'f_r1', name: 'DSC1.ARW' }, { id: 'f_r2', name: 'DSC2.ARW' }, { id: 'f_j3', name: 'DSC3.JPG' },
    ] },
    wk2_folder_01: { title: 'Week 2', entries: [{ id: 'f_j10', name: 'DSC10.JPG' }, { id: 'nested_folder', name: 'More', folder: true }] },
    nested_folder: { title: 'More', entries: [{ id: 'f_j11', name: 'DSC11.JPG' }] },
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    ({ client: admin, id: tournamentId } = await adminFor(`gallery-${stamp}`));
    ({ client: other } = await adminFor(`gallery2-${stamp}`));
  });

  it('turns subfolders into albums, drops junk and copies, and keeps RAW-only shots', async () => {
    fakeDrive(drive);
    const res = await syncGallery(service, tournamentId, ROOT);
    expect(res).toEqual({ ok: true, added: 5, removed: 0, remaining: 0 });
    const albums = await listGalleryAlbums(anon, tournamentId);
    expect(albums.map((a) => [a.drive_name, a.visible])).toEqual([['Week 1', 3], ['Week 2', 2]]);
    const wk1 = await listAlbumPhotos(anon, albums[0]!.id, 0, 50);
    expect(wk1.rows.map((r) => [r.name, r.kind, r.raw_file_id])).toEqual([
      ['DSC1.JPG', 'jpeg', 'f_r1'], ['DSC2.ARW', 'raw', 'f_r2'], ['DSC3.JPG', 'jpeg', null],
    ]);
    expect(wk1.rows[0]).toMatchObject({ width: 300, height: 200 });
  });

  it('keeps the organiser\'s arrangement through a re-sync, and follows removals in Drive', async () => {
    const albums = await listGalleryAlbums(admin, tournamentId);
    const [wk1, wk2] = albums;
    const photos = (await listAlbumPhotos(admin, wk1!.id, 0, 50)).rows;
    // Reverse the album, star one, hide one, rename and reorder albums.
    expect((await admin.rpc('gallery_reorder', { p_album: wk1!.id, p_ids: photos.map((p) => p.id).reverse() })).error).toBeNull();
    await admin.from('gallery_photos').update({ highlight: true }).eq('id', photos[2]!.id);
    await admin.from('gallery_photos').update({ hidden: true }).eq('id', photos[1]!.id);
    await admin.from('gallery_albums').update({ title: 'Finals day' }).eq('id', wk2!.id);
    expect((await admin.rpc('gallery_reorder_albums', { p_tournament: tournamentId, p_ids: [wk2!.id, wk1!.id] })).error).toBeNull();

    // DSC1.JPG deleted in Drive: its " 2" copy is now the only JPEG of that shot and takes its place
    // (still paired with the ARW), at the end of the arranged album.
    const withoutJ1 = { ...drive, wk1_folder_01: { ...drive.wk1_folder_01!, entries: drive.wk1_folder_01!.entries.filter((e) => e.id !== 'f_j1') } };
    fakeDrive(withoutJ1);
    const res = await syncGallery(service, tournamentId, ROOT);
    expect(res).toMatchObject({ ok: true, added: 1, removed: 1 });
    const after = await listGalleryAlbums(anon, tournamentId);
    expect(after.map((a) => a.title ?? a.drive_name)).toEqual(['Finals day', 'Week 1']);
    const wk1Now = (await listAlbumPhotos(anon, wk1!.id, 0, 50)).rows.map((r) => r.name);
    expect(wk1Now).toEqual(['DSC3.JPG', 'DSC1 2.JPG']);
    expect((await listHighlights(anon, tournamentId, after)).map((r) => r.name)).toEqual(['DSC3.JPG']);
  });

  it('a folder that fails to list deletes nothing', async () => {
    fakeDrive(drive, 'wk2_folder_01');
    const res = await syncGallery(service, tournamentId, ROOT);
    expect(res.ok).toBe(false);
    expect((await listGalleryAlbums(anon, tournamentId)).length).toBe(2);
  });

  it('only this tournament\'s admins can arrange it', async () => {
    const [album] = await listGalleryAlbums(anon, tournamentId);
    const photos = (await listAlbumPhotos(anon, album!.id, 0, 50)).rows;
    const anonWrite = await anon.from('gallery_photos').update({ hidden: true }).eq('id', photos[0]!.id).select('id');
    expect(anonWrite.data ?? []).toEqual([]);
    const otherWrite = await other.from('gallery_photos').update({ hidden: true }).eq('id', photos[0]!.id).select('id');
    expect(otherWrite.data ?? []).toEqual([]);
    await other.rpc('gallery_reorder', { p_album: album!.id, p_ids: photos.map((p) => p.id).reverse() });
    const unchanged = (await listAlbumPhotos(anon, album!.id, 0, 50)).rows.map((r) => r.id);
    expect(unchanged).toEqual(photos.map((p) => p.id));
    const albumWrite = await other.from('gallery_albums').update({ title: 'pwned' }).eq('id', album!.id).select('id');
    expect(albumWrite.data ?? []).toEqual([]);
  });
});
