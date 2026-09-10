/**
 * Everything about a photo that is a rule rather than a mechanism. Shared by the browser, which
 * checks before doing the work, and the server, which cannot trust that the browser did.
 */
export const PICK_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  minBytes: 2 * 1024,
  minSide: 96,
  types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
} as const;

/** What the resize step is asked to produce. */
export const STORED = { side: 512, quality: 0.82, maxBytes: 400 * 1024 } as const;

/** The sentence to show, or null if the file is fine. */
export function checkPickedFile(file: { size: number; type: string }): string | null {
  if (!PICK_LIMITS.types.includes(file.type as typeof PICK_LIMITS.types[number])) {
    return 'That has to be a JPEG, PNG, WEBP or HEIC photo';
  }
  if (file.size > PICK_LIMITS.maxBytes) return 'That photo is too large; 15 MB is the limit';
  if (file.size < PICK_LIMITS.minBytes) return 'That file is too small to be a photo';
  return null;
}

/**
 * The server's own check on what arrived. The browser does the resizing, so this is the only thing
 * between a hand-rolled POST and an arbitrary file sitting in a public bucket.
 */
export function checkStoredBytes(bytes: Uint8Array): string | null {
  if (bytes.length > STORED.maxBytes) return 'Photo too large';
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return 'Photo is not a JPEG';
  return null;
}

/** The largest centred square inside w x h. */
export function squareCrop(w: number, h: number): { x: number; y: number; size: number } {
  const size = Math.min(w, h);
  return { x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size };
}

/** 32 random hex characters under the tournament's folder. Never reused, so a CDN cannot go stale. */
export function photoPath(tournamentId: string, random: () => string = randomHex32): string {
  return `${tournamentId}/${random()}.jpg`;
}

function randomHex32(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function publicPhotoUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/player-photos/${path}`;
}

/** First and last initial: the fallback avatar's whole content, so it never comes back empty. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * White reads well on the club navy, but a team may pick anything, including a pale yellow that
 * would leave white initials invisible. Relative luminance decides which way to go.
 */
export function inkOn(hex: string): '#FFFFFF' | '#1A1B2E' {
  const v = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(v(0)) + 0.7152 * lin(v(1)) + 0.0722 * lin(v(2));
  return l > 0.45 ? '#1A1B2E' : '#FFFFFF';
}
