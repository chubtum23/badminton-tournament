import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { driveFolderListing, driveImage, jpegSize, parseFolderListing, parseFolderTitle, pickPhotos, byName, type PickedPhoto } from './drive';

export type SyncResult = { ok: true; added: number; removed: number; remaining: number } | { ok: false; message: string };

type FolderPhotos = { folderId: string; name: string; photos: PickedPhoto[] };

const MAX_DEPTH = 3;
// Gentle on purpose: Google throttles a burst of image requests from one address (HTTP 429).
const PARALLEL = 4;

async function fetchListing(folderId: string): Promise<{ title: string | null; entries: ReturnType<typeof parseFolderListing> }> {
  const res = await fetch(driveFolderListing(folderId), { cache: 'no-store', headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : `listing ${res.status}`);
  const html = await res.text();
  return { title: parseFolderTitle(html), entries: parseFolderListing(html) };
}

/** Photos in a folder and every folder under it, flattened: an album is one subfolder of the shared folder. */
async function collect(folderId: string, depth: number): Promise<PickedPhoto[]> {
  const { entries } = await fetchListing(folderId);
  const here = pickPhotos(entries);
  if (depth >= MAX_DEPTH) return here;
  const nested = await Promise.all(entries.filter((e) => e.folder).map((e) => collect(e.id, depth + 1)));
  return [...here, ...nested.flat()];
}

/** A small rendering is enough for the shape: the grid only needs each photo's aspect ratio. */
async function measure(fileId: string): Promise<{ width: number; height: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(driveImage(fileId, 120), { cache: 'no-store' });
      // Throttled: back off and try again. Anything else that fails is left for the next sync.
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
      if (!res.ok) return null;
      return jpegSize(new Uint8Array(await res.arrayBuffer()));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Brings the gallery tables in line with the Drive folder. The organiser's arrangement (album
 * titles and order, photo order, highlights, hidden) is kept for everything still in Drive.
 *
 * Measuring a new photo is a fetch, so a first sync of thousands is done in passes: it stops at
 * `budgetMs` and reports how many are left, and the caller runs it again.
 *
 * Any folder that fails to list stops the sync before anything is deleted, so a Drive hiccup can
 * never empty an album.
 */
export async function syncGallery(sb: SupabaseClient, tournamentId: string, folderId: string, budgetMs = 40_000): Promise<SyncResult> {
  const started = Date.now();
  let albums: FolderPhotos[];
  try {
    const root = await fetchListing(folderId);
    const subfolders = root.entries.filter((e) => e.folder).sort((a, b) => byName(a.name, b.name));
    const nested = await Promise.all(subfolders.map(async (f) => ({ folderId: f.id, name: f.name, photos: await collect(f.id, 1) })));
    albums = nested;
    const loose = pickPhotos(root.entries);
    if (loose.length > 0) albums = [{ folderId, name: root.title ?? 'Photos', photos: loose }, ...albums];
  } catch (err) {
    console.warn('gallery listing failed', { tournamentId, message: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "Couldn't read the Drive folder. Check it is shared as \"Anyone with the link\"." };
  }

  // — Albums —
  const have = await sb.from('gallery_albums').select('id, drive_folder_id, drive_name, sort_order').eq('tournament_id', tournamentId);
  if (have.error) return { ok: false, message: have.error.message };
  const byFolder = new Map(have.data.map((a) => [a.drive_folder_id as string, a]));
  let nextOrder = Math.max(-1, ...have.data.map((a) => a.sort_order as number)) + 1;
  const fresh = albums.filter((a) => !byFolder.has(a.folderId))
    .map((a) => ({ tournament_id: tournamentId, drive_folder_id: a.folderId, drive_name: a.name.slice(0, 300), sort_order: nextOrder++ }));
  if (fresh.length > 0) {
    const ins = await sb.from('gallery_albums').upsert(fresh, { onConflict: 'tournament_id,drive_folder_id', ignoreDuplicates: true });
    if (ins.error) return { ok: false, message: ins.error.message };
  }
  for (const a of albums) {
    const row = byFolder.get(a.folderId);
    if (row && row.drive_name !== a.name) await sb.from('gallery_albums').update({ drive_name: a.name.slice(0, 300) }).eq('id', row.id);
  }
  const gone = have.data.filter((a) => !albums.some((x) => x.folderId === a.drive_folder_id)).map((a) => a.id as string);
  if (gone.length > 0) await sb.from('gallery_albums').delete().in('id', gone);
  const now = await sb.from('gallery_albums').select('id, drive_folder_id').eq('tournament_id', tournamentId);
  if (now.error) return { ok: false, message: now.error.message };
  const albumId = new Map(now.data.map((a) => [a.drive_folder_id as string, a.id as string]));

  // — Photos —
  // The same file can only be in one place in Drive, but guard against a listing that repeats one.
  const wanted = new Map<string, PickedPhoto & { albumId: string }>();
  for (const a of albums) for (const p of a.photos) if (!wanted.has(p.fileId)) wanted.set(p.fileId, { ...p, albumId: albumId.get(a.folderId)! });

  const existing: { id: string; drive_file_id: string; album_id: string; name: string; kind: string; raw_file_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await sb.from('gallery_photos').select('id, drive_file_id, album_id, name, kind, raw_file_id')
      .eq('tournament_id', tournamentId).order('id').range(from, from + 999);
    if (page.error) return { ok: false, message: page.error.message };
    existing.push(...page.data);
    if (page.data.length < 1000) break;
  }
  const known = new Map(existing.map((r) => [r.drive_file_id, r]));

  const removedIds = existing.filter((r) => !wanted.has(r.drive_file_id)).map((r) => r.id);
  for (let i = 0; i < removedIds.length; i += 200) await sb.from('gallery_photos').delete().in('id', removedIds.slice(i, i + 200));

  for (const p of wanted.values()) {
    const row = known.get(p.fileId);
    if (row && (row.album_id !== p.albumId || row.name !== p.name || row.kind !== p.kind || row.raw_file_id !== p.rawFileId)) {
      // A photo moved to another album starts at the end of it rather than carrying a stale position.
      const moved = row.album_id !== p.albumId;
      await sb.from('gallery_photos').update({
        album_id: p.albumId, name: p.name, kind: p.kind, raw_file_id: p.rawFileId, ...(moved ? { sort_order: null } : {}),
      }).eq('id', row.id);
    }
  }

  const toAdd = [...wanted.values()].filter((p) => !known.has(p.fileId));
  let added = 0;
  let i = 0;
  const batch: object[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const ins = await sb.from('gallery_photos').upsert(batch.splice(0), { onConflict: 'tournament_id,drive_file_id', ignoreDuplicates: true });
    if (ins.error) console.warn('gallery insert failed', { tournamentId, message: ins.error.message });
  };
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (i < toAdd.length && Date.now() - started < budgetMs) {
      const p = toAdd[i++]!;
      const size = await measure(p.fileId);
      // Drive could not render it (a format it does not preview): leave it out rather than show a hole.
      if (!size) continue;
      batch.push({
        tournament_id: tournamentId, album_id: p.albumId, drive_file_id: p.fileId, name: p.name.slice(0, 300),
        kind: p.kind, raw_file_id: p.rawFileId, width: size.width, height: size.height,
      });
      added++;
      if (batch.length >= 100) await flush();
    }
  }));
  await flush();
  return { ok: true, added, removed: removedIds.length, remaining: Math.max(0, toAdd.length - i) };
}
