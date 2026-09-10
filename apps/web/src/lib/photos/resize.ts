'use client';
import { PICK_LIMITS, STORED, squareCrop } from './rules';

/**
 * Decode, crop to a centred square, draw at 512 and re-encode as JPEG. Done here rather than on
 * the server so a 10 MB photo never crosses the wire and the server never decodes anything.
 *
 * HEIC is decoded by the browser or not at all: Safari can, Chrome and Firefox cannot. A failed
 * decode rejects with a sentence the field shows. Bundling a WASM decoder is not worth ~500 KB
 * for a case iOS mostly avoids by converting to JPEG as the file is picked.
 */
export async function resizeToSquareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await load(url);
    if (img.naturalWidth < PICK_LIMITS.minSide || img.naturalHeight < PICK_LIMITS.minSide) {
      throw new Error(`That photo is too small; ${PICK_LIMITS.minSide} pixels is the minimum`);
    }
    const { x, y, size } = squareCrop(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = STORED.side;
    canvas.height = STORED.side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not read that photo');
    ctx.drawImage(img, x, y, size, size, 0, 0, STORED.side, STORED.side);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', STORED.quality));
    if (!blob) throw new Error('Could not read that photo');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This device cannot read that photo format; try another photo'));
    img.src = url;
  });
}
