import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { listAlbumPhotos } from '@/lib/db/queries';
import { albumTitle, toGalleryItems } from '@/lib/gallery/items';
import type { GalleryPhotoRow } from '@/lib/db/types';
import { PhotoArranger } from '@/components/GalleryAdmin';
import { BackLink } from '@/components/BackLink';
import { ui } from '@/components/ui';

export default async function ArrangeAlbumPage({ params }: { params: Promise<{ slug: string; albumId: string }> }) {
  const { slug, albumId } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const album = await ctx.sb.from('gallery_albums').select('*').eq('id', albumId).eq('tournament_id', ctx.tournament.id).maybeSingle();
  if (!album.data) notFound();

  // Arranging needs the whole album on one screen, so every page is read.
  const rows: GalleryPhotoRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await listAlbumPhotos(ctx.sb, albumId, offset, 1000, true);
    rows.push(...page.rows);
    if (page.rows.length < 1000) break;
  }

  return (
    <div className="space-y-6">
      <BackLink href={`/admin/${slug}/photos`}>All albums</BackLink>
      <section className={ui.card}>
        <div className={`${ui.head} px-9 py-6`}>
          <h2 className={ui.h2}>{albumTitle(album.data)}</h2>
          <span className="text-sm text-muted">{rows.length.toLocaleString()} photos</span>
        </div>
        <div className="px-6 py-6 sm:px-9">
          <PhotoArranger slug={slug} albumId={albumId} items={toGalleryItems(rows)} />
        </div>
      </section>
    </div>
  );
}
