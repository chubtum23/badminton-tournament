import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadTournamentBundle, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch } from '@/lib/db/mappers';
import { computePool } from '@/lib/standings/compute';
import { StandingsTable } from '@/components/StandingsTable';
import { MatchCard, pendingFor } from '@/components/MatchCard';

export const dynamic = 'force-dynamic';

export default async function PoolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const { tournament: t, pools, teams } = bundle;
  const matches = bundle.matches.map(rowToMatch);
  const games = gamesByMatch(bundle.games);
  if (pools.length === 0) return <p className="text-sm text-slate-500">Pools have not been drawn yet.</p>;
  const latest = latestByMatch(bundle.submissions);
  const pending = (m: typeof matches[number]) => pendingFor(latest, teams, m);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {pools.map((p) => {
        const poolMatches = matches.filter((m) => m.poolId === p.id);
        // Same computation the organiser sees: their manual order and any playoff already applied.
        const { rows, manual } = computePool({ pool: p, teams, matches, games, advancePerPool: t.advance_per_pool });
        return (
          <section key={p.id} className="rounded border bg-white p-4">
            <h2 className="mb-2 font-semibold">{p.name}</h2>
            <StandingsTable rows={rows} teams={teams} advance={t.advance_per_pool} caption={manual ? 'Order set by organiser' : undefined} />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-slate-600">Matches ({poolMatches.filter((m) => m.status === 'done').length}/{poolMatches.length} played)</summary>
              <div className="mt-2 grid gap-2">{poolMatches.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={`#${m.slot}`} pending={pending(m)} />)}</div>
            </details>
          </section>
        );
      })}
    </div>
  );
}
