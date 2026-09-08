/**
 * The origin to build private, token-bearing links with.
 *
 * `x-forwarded-host` is attacker-controllable on any deployment that does not strip it, so a link
 * built from it can be pointed at another host. `NEXT_PUBLIC_SITE_URL` pins the real origin when
 * it is set; without it we fall back to the request's own host, which is right for local
 * development and for a single-domain deployment.
 */
export function siteOrigin(hdrs: Headers): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (configured !== '') return configured;
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? 'localhost:3000';
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`;
}
