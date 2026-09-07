/**
 * The rate-limiting identity of a request.
 *
 * `x-real-ip` is written by the trusted proxy in front of the app (Vercel sets it, as do most
 * reverse proxies) and a client cannot forge it, so it wins when present. `x-forwarded-for` is a
 * client-appendable list — an attacker can prepend any number of fake entries — so we take its
 * LAST element, which is the one the nearest proxy appended and therefore the only entry the
 * client could not choose. With neither header we are talking to the client directly (local dev),
 * where a single shared bucket is the honest answer.
 */
export function clientKeyFrom(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    const nearest = parts[parts.length - 1];
    if (nearest) return nearest;
  }
  return 'local';
}
