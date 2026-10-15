import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { setGalleryFolder } from '@/actions/gallery';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listGalleryAlbums } from '@/lib/db/queries';
import { albumTitle } from '@/lib/gallery/items';
import { driveImage } from '@/lib/gallery/drive';
import { AlbumManager, SyncButton, type AdminAlbum } from '@/components/GalleryAdmin';
import { LocalDateTime } from '@/components/LocalDateTime';
import { SubmitButton } from '@/components/SubmitButton';
import { FlashMessage } from '@/components/FlashMessage';
import { ui } from '@/components/ui';

export const maxDuration = 60;

export default async function PhotosAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const albums = await listGalleryAlbums(ctx.sb, t.id);
  const here = `/admin/${slug}/photos`;
  async function saveFolder(formData: FormData) { 'use server'; redirectWithMsg(here, await setGalleryFolder(slug, formData), 'Drive folder saved'); }

  const rows: AdminAlbum[] = albums.map((a) => ({
    id: a.id, title: albumTitle(a), driveName: a.drive_name, hasTitle: a.title !== null, hidden: a.hidden,
    visible: a.visible, total: a.total, cover: a.cover ? driveImage(a.cover.fileId, 300) : null,
  }));
  const photos = albums.reduce((n, a) => n + a.visible, 0);

  return (
    <div className="space-y-6">
      <FlashMessage />
      <section className={ui.card}>
        <div className={`${ui.head} px-9 py-6`}>
          <h2 className={ui.h2}>Google Drive folder</h2>
          <a href={`/t/${slug}/photos`} className={ui.tiny}>View public page</a>
        </div>
        <div className="space-y-6 px-9 py-9">
          <form action={saveFolder} className="space-y-4">
            <label className={ui.label}>
              Shared folder link
              <input
                name="folder" defaultValue={t.gallery_folder_id ? `https://drive.google.com/drive/folders/${t.gallery_folder_id}` : ''}
                placeholder="https://drive.google.com/drive/folders/…" className={`${ui.field} normal-case tracking-normal`}
              />
            </label>
            <p className={ui.help}>
              In Drive, share the folder as <strong>Anyone with the link → Viewer</strong>. Each folder inside it becomes an album.
              JPEGs and camera RAW files (like .ARW) both show; RAW files also get a download of the original.
              Leave blank and save to switch the gallery off.
            </p>
            <SubmitButton className={ui.solid}>Save folder</SubmitButton>
          </form>
          {t.gallery_folder_id && (
            <div className="space-y-2 border-t-hair border-line pt-6">
              <SyncButton slug={slug} />
              <p className={ui.help}>
                {photos.toLocaleString()} photos in {albums.length} albums.{' '}
                {t.gallery_synced_at ? <>Last checked <LocalDateTime iso={t.gallery_synced_at} compact />. </> : null}
                New photos in Drive also show up on their own within about 10 minutes.
              </p>
            </div>
          )}
        </div>
      </section>

      {albums.length > 0 && (
        <section className={ui.card}>
          <div className={`${ui.head} px-9 py-6`}><h2 className={ui.h2}>Albums</h2></div>
          <div className="px-9 py-9"><AlbumManager slug={slug} albums={rows} /></div>
        </section>
      )}
    </div>
  );
}
