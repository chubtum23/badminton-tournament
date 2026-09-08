import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { gameSlotsByMatch, loadTournamentBundle, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { computePool } from '@/lib/standings/compute';
import { DrawTree } from '@/components/DrawTree';
import { Bracket } from '@/components/Bracket';
import { pendingFor } from '@/components/MatchCard';

export const dynamic = 'force-dynamic';

export default async function BracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const { tournament: t, pools, teams } = bundle;
  const matches = bundle.matches.map(rowToMatch);
  const games = gamesByMatch(bundle.games);
  const slots = gameSlotsByMatch(bundle.games);
  const latest = latestByMatch(bundle.submissions);
  // The same tables the Pools page shows, so the tree and the standings can never disagree.
  const standings = Object.fromEntries(pools.map((p) => [
    p.id,
    computePool({ pool: p, teams, matches, games, advancePerPool: t.advance_per_pool }).rows,
  ]));
  const champion = t.status === 'finished'
    ? teams.find((x) => x.id === matches.find((m) => m.stage === 'knockout' && m.nextMatchId === null)?.winnerId)
    : undefined;

  return (
    <div className="space-y-4">
      {champion && <p className="rounded bg-amber-50 p-3 text-sm font-semibold">Champions: {champion.name}</p>}
      {pools.length === 0 ? (
        <p className="text-sm text-slate-500">The pools have not been drawn yet.</p>
      ) : (
        <DrawTree tournament={t} pools={pools} teams={teams} matches={matches} games={games} slots={slots}
          standings={standings} settings={settingsFor(t, 'knockout')} />
      )}
      {matches.some((m) => m.stage === 'knockout') && (
        <details className="rounded border bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold">Knockout on its own, with every game score</summary>
          <div className="mt-3">
            <Bracket matches={matches} teams={teams} games={games} slots={slots}
              pendingFor={(m) => pendingFor(latest, teams, m)} />
          </div>
        </details>
      )}
    </div>
  );
}
