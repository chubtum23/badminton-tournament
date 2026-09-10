import { describe, it, expect } from 'vitest';
import { checkPickedFile, checkStoredBytes, squareCrop, photoPath, initialsOf, inkOn } from './rules';

const jpeg = (n: number) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff], 0); return b; };

describe('checkPickedFile', () => {
  it('accepts an ordinary phone photo', () => expect(checkPickedFile({ size: 4_000_000, type: 'image/jpeg' })).toBeNull());
  it('accepts heic, which iPhones sometimes hand over', () => expect(checkPickedFile({ size: 4_000_000, type: 'image/heic' })).toBeNull());
  it('rejects over 15 MB', () => expect(checkPickedFile({ size: 15 * 1024 * 1024 + 1, type: 'image/jpeg' })).toMatch(/too large/i));
  it('rejects under 2 KB', () => expect(checkPickedFile({ size: 1024, type: 'image/jpeg' })).toMatch(/too small/i));
  it('rejects a video dressed as a profile picture', () => expect(checkPickedFile({ size: 100_000, type: 'video/mp4' })).toMatch(/JPEG, PNG/));
});

describe('checkStoredBytes', () => {
  it('accepts a small jpeg', () => expect(checkStoredBytes(jpeg(80_000))).toBeNull());
  it('rejects over 400 KB', () => expect(checkStoredBytes(jpeg(400 * 1024 + 1))).toMatch(/too large/i));
  it('rejects bytes that are not a jpeg', () => expect(checkStoredBytes(new Uint8Array([0x89, 0x50, 0x4e]))).toMatch(/not a JPEG/));
});

describe('squareCrop', () => {
  it('takes the middle of a landscape photo', () => expect(squareCrop(400, 300)).toEqual({ x: 50, y: 0, size: 300 }));
  it('takes the middle of a portrait photo', () => expect(squareCrop(300, 400)).toEqual({ x: 0, y: 50, size: 300 }));
  it('leaves a square alone', () => expect(squareCrop(300, 300)).toEqual({ x: 0, y: 0, size: 300 }));
});

describe('photoPath', () => {
  it('puts a random name under the tournament', () => {
    expect(photoPath('0b1c2d3e-4f56-4789-8abc-def012345678', () => 'a'.repeat(32)))
      .toBe(`0b1c2d3e-4f56-4789-8abc-def012345678/${'a'.repeat(32)}.jpg`);
  });
});

describe('initialsOf', () => {
  it('takes both ends of a full name', () => expect(initialsOf('Priya Raman')).toBe('PR'));
  it('takes one letter from a single name', () => expect(initialsOf('Priya')).toBe('P'));
  it('skips the middle name', () => expect(initialsOf('Alex John Chen')).toBe('AC'));
  it('never comes back empty', () => expect(initialsOf('   ')).toBe('?'));
});

describe('inkOn', () => {
  it('is white on the club navy', () => expect(inkOn('#2B3390')).toBe('#FFFFFF'));
  it('is dark on a pale colour', () => expect(inkOn('#FFE94A')).toBe('#1A1B2E'));
});
