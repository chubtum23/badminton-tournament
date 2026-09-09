import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { gameSlotsByMatch, loadTournamentBundle, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { computePool } from '@/lib/standings/compute';
import { DrawTree } from '@/components/DrawTree';
import { Bracket } from '@/components/Bracket';
import { pendingFor } from '@/components/MatchCard';
import { ui } from '@/components/ui';

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
    <div className="space-y-5">
      {champion && (
        <p className={`${ui.card} ${ui.headOrange} px-5 py-4 font-display text-xl font-black uppercase`}>
          Champions: {champion.name}
        </p>
      )}
      {pools.length === 0 ? (
        <p className={ui.empty}>The pools have not been drawn yet.</p>
      ) : (
        <DrawTree tournament={t} pools={pools} teams={teams} matches={matches} games={games} slots={slots}
          standings={standings} settings={settingsFor(t, 'knockout')} />
      )}
      {matches.some((m) => m.stage === 'knockout') && (
        <details className={ui.card}>
          <summary className={`${ui.head} disclosure`}>
            <span className={ui.eyebrow}>Knockout on its own, with every game score</span>
          </summary>
          <div className="p-5">
            <Bracket matches={matches} teams={teams} games={games} slots={slots}
              pendingFor={(m) => pendingFor(latest, teams, m)} />
          </div>
        </details>
      )}
    </div>
  );
}
