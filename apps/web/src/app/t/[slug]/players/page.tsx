import { notFound } from 'next/navigation';
import { playerRatings, teamRatings, type RatedPlayer } from '@tournament/core';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadTournamentBundle } from '@/lib/db/queries';
import { RatingLeaderboard } from '@/components/RatingLeaderboard';
import { ui } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PlayersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  // A player only reaches the leaderboard through a team, which is also where their team name
  // comes from: the players table has no team of its own.
  const people: RatedPlayer[] = bundle.teams.flatMap((t) =>
    t.players.map((p) => ({ id: p.id, name: p.name, teamId: t.id, teamName: t.name })),
  );
  if (people.length === 0) return <p className={ui.empty}>No teams have signed up yet.</p>;
  const rows = playerRatings(people, bundle.ratings.map((r) => ({ playerId: r.player_id, rating: r.rating })));
  return <RatingLeaderboard players={rows} teams={teamRatings(rows)} />;
}
