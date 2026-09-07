import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { gameSlotsByMatch, loadTournamentBundle, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch } from '@/lib/db/mappers';
import { Bracket } from '@/components/Bracket';
import { pendingFor } from '@/components/MatchCard';

export const dynamic = 'force-dynamic';

export default async function BracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const matches = bundle.matches.map(rowToMatch);
  const latest = latestByMatch(bundle.submissions);
  const champion = bundle.tournament.status === 'finished'
    ? bundle.teams.find((x) => x.id === matches.find((m) => m.stage === 'knockout' && m.nextMatchId === null)?.winnerId)
    : undefined;
  return (
    <div className="space-y-4">
      {champion && <p className="rounded bg-amber-50 p-3 text-sm font-semibold">Champions: {champion.name}</p>}
      <Bracket matches={matches} teams={bundle.teams} games={gamesByMatch(bundle.games)} slots={gameSlotsByMatch(bundle.games)}
        pendingFor={(m) => pendingFor(latest, bundle.teams, m)} />
    </div>
  );
}
