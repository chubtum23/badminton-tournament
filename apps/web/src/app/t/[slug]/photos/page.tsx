import Link from 'next/link';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug, listAlbumPhotos, listGalleryAlbums, listHighlights } from '@/lib/db/queries';
import { GALLERY_PAGE, albumTitle, toGalleryItems } from '@/lib/gallery/items';
import { driveImage } from '@/lib/gallery/drive';
import { syncIfStale } from '@/lib/gallery/autosync';
import { GalleryView } from '@/components/GalleryGrid';
import { ui } from '@/components/ui';

export const dynamic = 'force-dynamic';

const plural = (n: number) => `${n.toLocaleString()} photo${n === 1 ? '' : 's'}`;

export default async function PhotosPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ album?: string }>;
}) {
  const [{ slug }, { album: albumParam }] = await Promise.all([params, searchParams]);
  const sb = await createServerSupabase();
  const t = await getTournamentBySlug(sb, slug);
  if (!t) notFound();
  after(() => syncIfStale(t));

  const albums = (await listGalleryAlbums(sb, t.id)).filter((a) => !a.hidden && a.visible > 0);
  if (albums.length === 0) {
    return (
      <section className="space-y-5">
        <h2 className={ui.h2}>Photos</h2>
        <p className={ui.empty}>No photos yet. Check back after the event.</p>
      </section>
    );
  }

  // One album, or one picked: show it whole.
  const picked = albums.find((a) => a.id === albumParam) ?? (albums.length === 1 ? albums[0] : undefined);
  if (picked) {
    const { rows, total } = await listAlbumPhotos(sb, picked.id, 0, GALLERY_PAGE);
    return (
      <section className="space-y-5">
        <div className="space-y-2">
          {albums.length > 1 && <Link href={`/t/${slug}/photos`} className="text-sm font-bold uppercase tracking-label text-navy hover:text-orange-ink">← All albums</Link>}
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className={ui.h2}>{albumTitle(picked)}</h2>
            <p className="text-sm text-muted">{plural(total)} · tap one to view and download</p>
          </div>
        </div>
        <GalleryView slug={slug} albumId={picked.id} initial={toGalleryItems(rows)} total={total} />
      </section>
    );
  }

  const highlights = await listHighlights(sb, t.id, albums);
  const totalPhotos = albums.reduce((n, a) => n + a.visible, 0);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className={ui.h2}>Photos</h2>
        <p className="text-sm text-muted">{plural(totalPhotos)} in {albums.length} albums</p>
      </div>

      {highlights.length > 0 && (
        <section className="space-y-4" data-testid="gallery-highlights">
          <h3 className={`${ui.eyebrow} text-orange-ink`}>★ Highlights</h3>
          <GalleryView slug={slug} albumId={null} initial={toGalleryItems(highlights)} total={highlights.length} rowClass="[--row:160px] sm:[--row:260px] lg:[--row:320px]" />
        </section>
      )}

      <section className="space-y-4">
        <h3 className={ui.eyebrow}>Albums</h3>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <li key={a.id}>
              <Link href={`/t/${slug}/photos?album=${a.id}`} className="group block border-2 border-navy bg-white" data-testid="gallery-album">
                <div className="relative aspect-[3/2] overflow-hidden bg-line-soft">
                  {a.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={driveImage(a.cover.fileId, 800)} alt="" loading="lazy" referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t-2 border-navy px-5 py-4">
                  <span className="font-display text-lg font-extrabold uppercase tracking-tight text-ink">{albumTitle(a)}</span>
                  <span className="shrink-0 bg-orange-tint px-2.5 py-1 text-xs font-bold uppercase tracking-label text-orange-ink">{a.visible}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
