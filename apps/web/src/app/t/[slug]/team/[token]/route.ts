import { NextResponse, type NextRequest } from 'next/server';
import { cookieName, resolveTeamByToken } from '@/lib/participant/token';
import { allow } from '@/lib/participant/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await ctx.params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(`token:${ip}`, 30, 60_000)) {
    return new NextResponse('Too many attempts. Try again in a minute.', { status: 429 });
  }
  const participant = await resolveTeamByToken(slug, token);
  if (!participant) return new NextResponse('This team link is not valid.', { status: 404 });
  const res = NextResponse.redirect(new URL(`/t/${slug}/team`, req.url), 303);
  res.cookies.set(cookieName(slug), token, {
    httpOnly: true, sameSite: 'lax', path: `/t/${slug}`, maxAge: 60 * 60 * 24 * 30, secure: req.nextUrl.protocol === 'https:',
  });
  return res;
}
