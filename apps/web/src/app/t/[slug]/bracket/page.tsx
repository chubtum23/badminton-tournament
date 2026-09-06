import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadTournamentBundle } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch } from '@/lib/db/mappers';
import { Bracket } from '@/components/Bracket';

export const dynamic = 'force-dynamic';

export default async function BracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const matches = bundle.matches.map(rowToMatch);
  const champion = bundle.tournament.status === 'finished'
    ? bundle.teams.find((x) => x.id === matches.find((m) => m.stage === 'knockout' && m.nextMatchId === null)?.winnerId)
    : undefined;
  return (
    <div className="space-y-4">
      {champion && <p className="rounded bg-amber-50 p-3 text-sm font-semibold">Champions: {champion.name}</p>}
      <Bracket matches={matches} teams={bundle.teams} games={gamesByMatch(bundle.games)} />
    </div>
  );
}
