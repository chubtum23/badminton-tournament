import { NextResponse, type NextRequest } from 'next/server';
import { cookieName, resolveTeamByToken, RATE_LIMITED } from '@/lib/participant/token';
import { clientKeyFrom } from '@/lib/participant/clientKey';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await ctx.params;
  const participant = await resolveTeamByToken(slug, token, clientKeyFrom(req.headers));
  // A player who taps a bad or over-used link gets the team page's own explanation, in the site's
  // clothes, rather than a bare line of text. The token itself is never carried forward.
  if (participant === RATE_LIMITED || !participant) {
    const why = participant === RATE_LIMITED ? 'limited' : 'invalid';
    return NextResponse.redirect(new URL(`/t/${slug}/team?link=${why}`, req.url), 303);
  }
  const res = NextResponse.redirect(new URL(`/t/${slug}/team${req.nextUrl.search}`, req.url), 303);
  res.cookies.set(cookieName(slug), token, {
    httpOnly: true, sameSite: 'lax', path: `/t/${slug}`, maxAge: 60 * 60 * 24 * 30, secure: req.nextUrl.protocol === 'https:',
  });
  return res;
}
