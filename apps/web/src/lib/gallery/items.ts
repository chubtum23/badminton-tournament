import type { GalleryPhotoRow } from '@/lib/db/types';
import { driveImage, driveOriginal, jpegNameFor } from './drive';

/** What the grid and viewer need for one photo. Built on the server so the client never sees a row. */
export type GalleryItem = {
  id: string;
  name: string;
  thumb: string;
  full: string;
  /**
   * The full-size JPEG to save: the file itself, or Drive's full-size rendering of a RAW. Both allow
   * a cross-site fetch, which is how the save button shows progress and hands it to the share sheet.
   */
  download: string;
  downloadName: string;
  /** The untouched RAW file, when the photo was shot as one. */
  raw: string | null;
  width: number;
  height: number;
  highlight: boolean;
  hidden: boolean;
};

export const GALLERY_PAGE = 120;

export function toGalleryItems(rows: readonly GalleryPhotoRow[]): GalleryItem[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    thumb: driveImage(r.drive_file_id, 800),
    full: driveImage(r.drive_file_id, 2560),
    download: r.kind === 'raw' ? driveImage(r.drive_file_id, 'full') : driveOriginal(r.drive_file_id),
    downloadName: r.kind === 'raw' ? jpegNameFor(r.name) : r.name,
    raw: r.raw_file_id ? driveOriginal(r.raw_file_id) : null,
    width: r.width,
    height: r.height,
    highlight: r.highlight,
    hidden: r.hidden,
  }));
}

/** An album's display name: the organiser's title, or the Drive folder's. */
export function albumTitle(a: { title: string | null; drive_name: string }): string {
  return a.title ?? a.drive_name;
}
