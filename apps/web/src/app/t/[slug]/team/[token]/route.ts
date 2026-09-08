import { NextResponse, type NextRequest } from 'next/server';
import { cookieName, resolveTeamByToken, RATE_LIMITED } from '@/lib/participant/token';
import { clientKeyFrom } from '@/lib/participant/clientKey';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await ctx.params;
  const participant = await resolveTeamByToken(slug, token, clientKeyFrom(req.headers));
  if (participant === RATE_LIMITED) {
    return new NextResponse('Too many attempts. Try again in a minute.', { status: 429 });
  }
  if (!participant) return new NextResponse('This team link is not valid.', { status: 404 });
  const res = NextResponse.redirect(new URL(`/t/${slug}/team${req.nextUrl.search}`, req.url), 303);
  res.cookies.set(cookieName(slug), token, {
    httpOnly: true, sameSite: 'lax', path: `/t/${slug}`, maxAge: 60 * 60 * 24 * 30, secure: req.nextUrl.protocol === 'https:',
  });
  return res;
}
