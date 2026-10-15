/**
 * Everything about reading a shared Google Drive folder that is a rule rather than a fetch: pulling
 * the folder id out of a pasted link, reading Drive's folder listing, and deciding which files are
 * photos worth showing. Kept pure so it can be tested against real listings.
 */

export type DriveEntry = { id: string; name: string; folder: boolean };

/** The folder id from anything an organiser might paste: a share link, an open-folder URL, or the bare id. */
export function folderIdFrom(input: string): string | null {
  const v = input.trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,100})/.exec(v) ?? /[?&]id=([A-Za-z0-9_-]{10,100})/.exec(v);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{10,100}$/.test(v) ? v : null;
}

/**
 * The entries of Drive's embeddable folder view (drive.google.com/embeddedfolderview?id=…), which
 * lists a link-shared folder without an API key. Each entry is a div with the file's id, a link
 * that says whether it is a folder, and its title.
 */
export function parseFolderListing(html: string): DriveEntry[] {
  const out: DriveEntry[] = [];
  const re = /<div class="flip-entry" id="entry-([A-Za-z0-9_-]+)"[\s\S]*?<a href="([^"]*)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    out.push({ id: m[1]!, name: decodeEntities(m[3]!.trim()), folder: m[2]!.includes('/folders/') });
  }
  return out;
}

/** The folder's own name, from the listing page's title. */
export function parseFolderTitle(html: string): string | null {
  const m = /<title>([^<]*)<\/title>/.exec(html);
  return m ? decodeEntities(m[1]!.trim()) || null : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const VIEWABLE = /\.(jpe?g|png|webp|heic|heif)$/i;
const RAW = /\.(arw|cr2|cr3|nef|raf|orf|rw2|dng|pef|srw)$/i;

export type PickedPhoto = { fileId: string; name: string; kind: 'jpeg' | 'raw'; rawFileId: string | null };

/**
 * Which files in one folder are photos to show, and how.
 *
 * - Mac "._" files (metadata a Mac writes beside every file on a USB stick) are dropped.
 * - "DSC01234 2.JPG" beside "DSC01234.JPG" is a copy made by dragging twice; only one is kept.
 * - A RAW with a JPEG of the same name is the same shot: the JPEG is shown and the RAW is offered
 *   as a second download. A RAW on its own is shown through Drive's own rendering of it.
 */
export function pickPhotos(entries: readonly DriveEntry[]): PickedPhoto[] {
  const files = entries.filter((e) => !e.folder && !e.name.startsWith('._'));
  const names = new Set(files.map((f) => f.name.toLowerCase()));
  const kept = files.filter((f) => {
    const copy = /^(.*) \d+(\.[^.]+)$/.exec(f.name);
    return !(copy && names.has(`${copy[1]}${copy[2]}`.toLowerCase()));
  });
  // A copy's stem is its original's, so "DSC1 2.JPG" still pairs with "DSC1.ARW".
  const stem = (n: string) => n.replace(/\.[^.]+$/, '').replace(/ \d+$/, '').toLowerCase();
  const raws = new Map<string, string>();
  for (const f of kept) if (RAW.test(f.name)) raws.set(stem(f.name), f.id);
  const viewableStems = new Set(kept.filter((f) => VIEWABLE.test(f.name)).map((f) => stem(f.name)));

  const out: PickedPhoto[] = [];
  for (const f of kept) {
    if (VIEWABLE.test(f.name)) {
      out.push({ fileId: f.id, name: f.name, kind: 'jpeg', rawFileId: raws.get(stem(f.name)) ?? null });
    } else if (RAW.test(f.name) && !viewableStems.has(stem(f.name))) {
      out.push({ fileId: f.id, name: f.name, kind: 'raw', rawFileId: f.id });
    }
  }
  return out.sort((a, b) => byName(a.name, b.name));
}

/** Natural order, so DSC9 sorts before DSC10 and camera numbering reads as shot order. */
export function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Width and height from the start of a JPEG (its first SOF marker), or null if there is none. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
  }
  return null;
}

// — Image addresses —
// lh3 renders any image Drive holds (a RAW included) at the size asked for, already turned upright.

export function driveImage(fileId: string, longEdge: number | 'full'): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=${longEdge === 'full' ? 's0' : `s${longEdge}`}`;
}

/**
 * The file exactly as uploaded (byte for byte), as an attachment under its own name. This address
 * rather than drive.usercontent.google.com because only this one lets a page fetch it: the save
 * button needs the bytes to show progress and to hand them to the iPhone share sheet.
 */
export function driveOriginal(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=d`;
}

export function driveFolderListing(folderId: string): string {
  return `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`;
}

/** "DSC04783.ARW" saves as "DSC04783.jpg" when what is handed over is Drive's JPEG rendering. */
export function jpegNameFor(name: string): string {
  return `${name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'photo'}.jpg`;
}
