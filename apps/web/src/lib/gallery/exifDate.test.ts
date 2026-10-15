import { describe, it, expect } from 'vitest';
import { exifDateString, exifOffsetString, stampExifDate } from './exifDate';

/**
 * A minimal JPEG with an EXIF block shaped like the club camera's: IFD0 with DateTime and a pointer
 * to the Exif IFD, which holds DateTimeOriginal, DateTimeDigitized and OffsetTimeOriginal. Then a
 * few bytes standing in for the picture.
 */
function cameraJpeg(little: boolean): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  // Layout (offsets from the TIFF header):
  //   0  header (8)
  //   8  IFD0: 2 entries (2 + 24 + 4 = 30) -> ends at 38
  //  38  IFD0 DateTime value (20) -> 58
  //  58  Exif IFD: 3 entries (2 + 36 + 4 = 42) -> 100
  // 100  DateTimeOriginal value (20), 120 DateTimeDigitized value (20); OffsetTimeOriginal (7) fits? no: 7 > 4, at 140
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(2));
  tiff.push(...u16(0x0132), ...u16(2), ...u32(20), ...u32(38));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(58));
  tiff.push(...u32(0));
  tiff.push(...ascii('2020:10:17 05:55:05'));
  tiff.push(...u16(3));
  tiff.push(...u16(0x9003), ...u16(2), ...u32(20), ...u32(100));
  tiff.push(...u16(0x9004), ...u16(2), ...u32(20), ...u32(120));
  tiff.push(...u16(0x9011), ...u16(2), ...u32(7), ...u32(140));
  tiff.push(...u32(0));
  tiff.push(...ascii('2020:10:17 05:55:05'), ...ascii('2020:10:17 05:55:05'), ...ascii('+10:00'));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xda, 1, 2, 3, 4, 0xff, 0xd9]);
}

const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

describe('stampExifDate', () => {
  const when = new Date(2026, 9, 16, 14, 3, 9); // local time, 16 Oct 2026 14:03:09

  for (const little of [true, false]) {
    it(`rewrites every taken-on date (${little ? 'Intel' : 'Motorola'} byte order)`, () => {
      const before = cameraJpeg(little);
      const after = stampExifDate(before, when);
      expect(text(after)).not.toContain('2020:10:17');
      expect(text(after).split('2026:10:16 14:03:09').length - 1).toBe(3);
      expect(text(after)).toContain(exifOffsetString(when));
      expect(after.length).toBe(before.length);
    });
  }

  it('changes nothing but the date bytes', () => {
    const before = cameraJpeg(true);
    const after = stampExifDate(before, when);
    const changed = [...before].filter((v, i) => v !== after[i]).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(19 * 3 + 6);
    // The picture data after the EXIF block is identical.
    expect([...after.slice(-8)]).toEqual([...before.slice(-8)]);
  });

  it('does not touch the input', () => {
    const before = cameraJpeg(true);
    const copy = new Uint8Array(before);
    stampExifDate(before, when);
    expect([...before]).toEqual([...copy]);
  });

  it('returns a file without EXIF unchanged', () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda, 1, 0xff, 0xd9]);
    expect([...stampExifDate(plain, when)]).toEqual([...plain]);
  });

  it('survives a truncated or garbled header', () => {
    const broken = cameraJpeg(true).slice(0, 30);
    expect(() => stampExifDate(broken, when)).not.toThrow();
    expect(() => stampExifDate(new Uint8Array([1, 2, 3]), when)).not.toThrow();
  });
});

describe('formatting', () => {
  it('writes EXIF local time', () => expect(exifDateString(new Date(2026, 0, 5, 7, 8, 9))).toBe('2026:01:05 07:08:09'));
  it('writes an offset like +10:00', () => expect(exifOffsetString(new Date())).toMatch(/^[+-]\d\d:\d\d$/));
});
