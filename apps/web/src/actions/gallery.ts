'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceSupabase } from '@/lib/supabase/service';
import { getTournamentBySlug, listAlbumPhotos } from '@/lib/db/queries';
import { folderIdFrom } from '@/lib/gallery/drive';
import { syncGallery } from '@/lib/gallery/sync';
import { GALLERY_PAGE, toGalleryItems, type GalleryItem } from '@/lib/gallery/items';

function revalidateGallery(slug: string): void {
  revalidatePath(`/admin/${slug}/photos`, 'layout');
  revalidatePath(`/t/${slug}/photos`, 'layout');
}

/** Saves the shared folder and runs the first sync pass. A blank link turns the gallery off. */
export async function setGalleryFolder(slug: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const raw = String(formData.get('folder') ?? '').trim();
  const folderId = raw === '' ? null : folderIdFrom(raw);
  if (raw !== '' && !folderId) return fail('invalid_input', "That doesn't look like a Google Drive folder link");
  const upd = await ctx.sb.from('tournaments').update({ gallery_folder_id: folderId, gallery_synced_at: null }).eq('id', ctx.tournament.id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  if (!folderId) {
    await ctx.sb.from('gallery_albums').delete().eq('tournament_id', ctx.tournament.id);
    revalidateGallery(slug);
    return ok(undefined);
  }
  const res = await syncGallery(createServiceSupabase(), ctx.tournament.id, folderId, 25_000);
  revalidateGallery(slug);
  if (!res.ok) return fail('invalid_input', res.message);
  if (res.remaining === 0) await ctx.sb.from('tournaments').update({ gallery_synced_at: new Date().toISOString() }).eq('id', ctx.tournament.id);
  return ok(undefined);
}

/** One sync pass. The admin page calls it again while `remaining` is above zero. */
export async function syncGalleryNow(slug: string): Promise<ActionResult<{ added: number; removed: number; remaining: number }>> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const folderId = ctx.tournament.gallery_folder_id;
  if (!folderId) return fail('invalid_input', 'Add a Drive folder link first');
  const res = await syncGallery(createServiceSupabase(), ctx.tournament.id, folderId, 40_000);
  if (!res.ok) return fail('invalid_input', res.message);
  if (res.remaining === 0) await ctx.sb.from('tournaments').update({ gallery_synced_at: new Date().toISOString() }).eq('id', ctx.tournament.id);
  revalidateGallery(slug);
  return ok({ added: res.added, removed: res.removed, remaining: res.remaining });
}

/** The next page of an album. Public: it reads nothing the public page does not already show. */
export async function loadAlbumPage(slug: string, albumId: string, offset: number, withHidden = false): Promise<{ items: GalleryItem[]; total: number }> {
  const empty = { items: [], total: 0 };
  if (!Number.isInteger(offset) || offset < 0 || typeof albumId !== 'string') return empty;
  const sb = await createServerSupabase();
  const t = await getTournamentBySlug(sb, slug);
  if (!t) return empty;
  // Hidden photos are only for an admin of this tournament.
  if (withHidden && 'error' in (await requireAdmin(slug))) return empty;
  const album = await sb.from('gallery_albums').select('id, hidden').eq('id', albumId).eq('tournament_id', t.id).maybeSingle();
  if (!album.data || (album.data.hidden && !withHidden)) return empty;
  const { rows, total } = await listAlbumPhotos(sb, albumId, offset, GALLERY_PAGE, withHidden);
  return { items: toGalleryItems(rows), total };
}

// — Arranging —

export async function updateAlbum(slug: string, albumId: string, patch: { title?: string | null; hidden?: boolean }): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const upd: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = (patch.title ?? '').trim();
    if (t.length > 80) return fail('invalid_input', 'Album names can be up to 80 characters');
    upd.title = t === '' ? null : t;
  }
  if (patch.hidden !== undefined) upd.hidden = Boolean(patch.hidden);
  const res = await ctx.sb.from('gallery_albums').update(upd).eq('id', albumId).eq('tournament_id', ctx.tournament.id);
  if (res.error) return fail('invalid_input', res.error.message);
  revalidateGallery(slug);
  return ok(undefined);
}

export async function reorderAlbums(slug: string, ids: string[]): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (!Array.isArray(ids) || ids.length > 500) return fail('invalid_input');
  const res = await ctx.sb.rpc('gallery_reorder_albums', { p_tournament: ctx.tournament.id, p_ids: ids });
  if (res.error) return fail('invalid_input', res.error.message);
  revalidateGallery(slug);
  return ok(undefined);
}

/** The whole album's order, as arranged on screen. `null` puts it back to camera order. */
export async function reorderPhotos(slug: string, albumId: string, ids: string[] | null): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (ids === null) {
    const res = await ctx.sb.from('gallery_photos').update({ sort_order: null }).eq('album_id', albumId).eq('tournament_id', ctx.tournament.id);
    if (res.error) return fail('invalid_input', res.error.message);
  } else {
    if (!Array.isArray(ids) || ids.length > 5000) return fail('invalid_input');
    const res = await ctx.sb.rpc('gallery_reorder', { p_album: albumId, p_ids: ids });
    if (res.error) return fail('invalid_input', res.error.message);
  }
  revalidateGallery(slug);
  return ok(undefined);
}

export async function updatePhotos(slug: string, ids: string[], patch: { highlight?: boolean; hidden?: boolean }): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000) return fail('invalid_input');
  const upd: Record<string, boolean> = {};
  if (patch.highlight !== undefined) upd.highlight = Boolean(patch.highlight);
  if (patch.hidden !== undefined) upd.hidden = Boolean(patch.hidden);
  for (let i = 0; i < ids.length; i += 500) {
    const res = await ctx.sb.from('gallery_photos').update(upd).eq('tournament_id', ctx.tournament.id).in('id', ids.slice(i, i + 500));
    if (res.error) return fail('invalid_input', res.error.message);
  }
  revalidateGallery(slug);
  return ok(undefined);
}
