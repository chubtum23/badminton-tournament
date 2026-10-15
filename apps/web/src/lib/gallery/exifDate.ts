/**
 * Rewrites the "when was this taken" dates inside a JPEG to a given moment, leaving every other
 * byte alone (the picture itself is untouched).
 *
 * Why: the club camera's clock is years out, and a phone's photo library files a saved photo by the
 * date it says it was taken. Saved as is, it vanishes into a past year; stamped with the moment it
 * was saved, it lands at the top of the camera roll where the person expects it.
 *
 * Only the EXIF fields phones sort by are touched: DateTime (0x0132) in IFD0, and DateTimeOriginal
 * (0x9003), DateTimeDigitized (0x9004) and their time-zone offsets (0x9010-0x9012) in the Exif IFD.
 * Each is a fixed-length ASCII value overwritten in place, so no offsets move. A file with no EXIF,
 * or one that does not parse, is returned unchanged.
 */
export function stampExifDate(input: Uint8Array, when: Date): Uint8Array {
  const out = new Uint8Array(input);
  try {
    const tiff = findExifTiff(out);
    if (tiff === null) return out;
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const little = out[tiff] === 0x49 && out[tiff + 1] === 0x49;
    if (!little && !(out[tiff] === 0x4d && out[tiff + 1] === 0x4d)) return out;
    const u16 = (at: number) => view.getUint16(at, little);
    const u32 = (at: number) => view.getUint32(at, little);

    const date = exifDateString(when);
    const offset = exifOffsetString(when);

    /** Overwrites one ASCII entry's value if it is long enough to hold `text` plus its terminator. */
    const write = (entry: number, text: string) => {
      const type = u16(entry + 2);
      const count = u32(entry + 4);
      if (type !== 2 || count < text.length + 1) return;
      const at = count > 4 ? tiff + u32(entry + 8) : entry + 8;
      if (at + count > out.length) return;
      for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
      out[at + text.length] = 0;
    };

    /** Visits each entry of the IFD at `ifd` (relative to the TIFF header); returns the next IFD's offset, or 0. */
    const walk = (ifd: number, visit: (tag: number, entry: number) => void): number => {
      const start = tiff + ifd;
      if (start + 2 > out.length) return 0;
      const n = u16(start);
      for (let k = 0; k < n; k++) {
        const entry = start + 2 + k * 12;
        if (entry + 12 > out.length) return 0;
        visit(u16(entry), entry);
      }
      const next = start + 2 + n * 12;
      return next + 4 <= out.length ? u32(next) : 0;
    };

    let exifIfd: number | null = null;
    const ifd1 = walk(u32(tiff + 4), (tag, entry) => {
      if (tag === 0x0132) write(entry, date);
      if (tag === 0x8769) exifIfd = u32(entry + 8);
    });
    // IFD1 describes the built-in thumbnail and carries its own copy of DateTime.
    if (ifd1 > 0) walk(ifd1, (tag, entry) => { if (tag === 0x0132) write(entry, date); });
    if (exifIfd !== null) {
      walk(exifIfd, (tag, entry) => {
        if (tag === 0x9003 || tag === 0x9004) write(entry, date);
        if (tag === 0x9010 || tag === 0x9011 || tag === 0x9012) write(entry, offset);
      });
    }
    return out;
  } catch {
    // A malformed header is not worth failing a save over: hand the file over as it came.
    return new Uint8Array(input);
  }
}

/** Start of the TIFF header inside the first APP1 "Exif" segment, or null. */
function findExifTiff(b: Uint8Array): number | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    if (marker === 0xda || marker === 0xd9) return null; // image data starts: no EXIF before it
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0 && b[i + 9] === 0) {
      return i + 10;
    }
    i += 2 + len;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY:MM:DD HH:MM:SS" in the device's local time, as EXIF writes it. */
export function exifDateString(d: Date): string {
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "+10:00": the device's offset from UTC, so the local time above is read correctly. */
export function exifOffsetString(d: Date): string {
  const mins = -d.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
