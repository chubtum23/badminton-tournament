import { NextResponse } from 'next/server';
import { requireAdmin } from '@/actions/guard';
import { listGames, listMatches, listPools, listSubmissions, listTeamsWithPlayers } from '@/lib/db/queries';

/**
 * Everything the tournament holds, as one JSON file the organiser can keep. There is no undo for a
 * wiped result, so this is the copy to take before locking the pools and again before the knockout.
 * Private team links are left out: a backup is something people forward.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return new NextResponse('Sign in as an organiser of this tournament first.', { status: 403 });
  const t = ctx.tournament;
  const [teams, pools, matches, games, submissions, announcements] = await Promise.all([
    listTeamsWithPlayers(ctx.sb, t.id), listPools(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id),
    listSubmissions(ctx.sb, t.id),
    ctx.sb.from('announcements').select('*').eq('tournament_id', t.id).order('created_at'),
  ]);
  const ratings = matches.length
    ? await ctx.sb.from('player_ratings').select('*').in('match_id', matches.map((m) => m.id))
    : { data: [], error: null };
  if (announcements.error || ratings.error) {
    return new NextResponse('Could not read everything for the backup; try again.', { status: 500 });
  }
  const takenAt = new Date().toISOString();
  const body = JSON.stringify({
    takenAt, tournament: t, teams, pools, matches, games, submissions,
    announcements: announcements.data, ratings: ratings.data,
  }, null, 2);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-backup-${takenAt.slice(0, 16).replace(/[:T]/g, '-')}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
