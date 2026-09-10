import { notFound } from 'next/navigation';
import { playerRatings, teamRatings, type RatedPlayer } from '@tournament/core';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadTournamentBundle } from '@/lib/db/queries';
import { TeamDirectory, type DirectoryGroup } from '@/components/TeamDirectory';
import { ui } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function TeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const { pools, teams } = bundle;
  if (teams.length === 0) return <p className={ui.empty}>No teams have signed up yet.</p>;

  const people: RatedPlayer[] = teams.flatMap((t) =>
    t.players.map((p) => ({ id: p.id, name: p.name, teamId: t.id, teamName: t.name })),
  );
  const playerRows = playerRatings(people, bundle.ratings.map((r) => ({ playerId: r.player_id, rating: r.rating })));

  // Grouped by pool, in pool order. Before the draw every team is unpooled, so that section is the
  // whole page rather than an afterthought — which is also what it looks like during sign-up.
  const grouped: DirectoryGroup[] = pools.map((p, i) => ({
    key: p.id,
    name: p.name,
    tone: i,
    teams: teams.filter((t) => t.pool_id === p.id),
  }));
  const unpooled = teams.filter((t) => t.pool_id === null);
  if (unpooled.length > 0) {
    grouped.push({ key: 'unpooled', name: pools.length === 0 ? 'Teams' : 'Not in a pool', tone: null, teams: unpooled });
  }

  return <TeamDirectory groups={grouped} teamRows={teamRatings(playerRows)} playerRows={playerRows} />;
}
