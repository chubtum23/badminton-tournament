import type { GalleryPhotoRow } from '@/lib/db/types';
import { driveImage, driveOriginal, jpegNameFor } from './drive';

/** What the grid and viewer need for one photo. Built on the server so the client never sees a row. */
export type GalleryItem = {
  id: string;
  name: string;
  thumb: string;
  full: string;
  /**
   * The JPEG to save. A JPEG is Drive's own download of the file. A RAW is Drive's full-size JPEG
   * rendering, which Drive serves inline, so the page fetches it and saves it under `downloadName`.
   */
  download: string;
  downloadName: string;
  fetchToSave: boolean;
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
    fetchToSave: r.kind === 'raw',
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
