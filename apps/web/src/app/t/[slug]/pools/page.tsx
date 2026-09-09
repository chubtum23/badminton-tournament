import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { gameSlotsByMatch, loadTournamentBundle, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch } from '@/lib/db/mappers';
import { computePool } from '@/lib/standings/compute';
import { StandingsTable } from '@/components/StandingsTable';
import { MatchCard, pendingFor } from '@/components/MatchCard';
import { poolTone, ui } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PoolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const { tournament: t, pools, teams } = bundle;
  const matches = bundle.matches.map(rowToMatch);
  const games = gamesByMatch(bundle.games);
  // Each meeting is three labelled games; the cards list them rather than one score column.
  const slots = gameSlotsByMatch(bundle.games);
  if (pools.length === 0) return <p className={ui.empty}>Pools have not been drawn yet.</p>;
  const latest = latestByMatch(bundle.submissions);
  const pending = (m: typeof matches[number]) => pendingFor(latest, teams, m);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {pools.map((p, pi) => {
        const poolMatches = matches.filter((m) => m.poolId === p.id && m.stage === 'pool');
        const doneCount = poolMatches.filter((m) => m.status === 'done').length;
        // Same computation the organiser sees: their manual order and any playoff already applied.
        const { rows, ties, manual, playoffs } = computePool({ pool: p, teams, matches, games, advancePerPool: t.advance_per_pool });
        return (
          <section key={p.id} className={ui.card}>
            <div className={`${ui.head} ${poolTone(pi).head}`}>
              <h2 className={ui.eyebrow}>{p.name}</h2>
              <span className={ui.eyebrow}>Top {t.advance_per_pool} qualify</span>
            </div>
            <div className="px-7 py-6">
              <StandingsTable rows={rows} teams={teams} advance={t.advance_per_pool} manual={manual} ties={ties} />
            </div>
            <details className="border-t-hair border-line">
              <summary className={`${ui.eyebrow} disclosure flex items-center justify-between gap-3 px-7 py-5 text-muted`}>
                <span>Matches</span>
                <span className="ml-auto">{doneCount}/{poolMatches.length} played</span>
              </summary>
              <div className="grid gap-5 px-7 pb-7">
                {poolMatches.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={`#${m.slot}`} tone={poolTone(pi).head} pending={pending(m)} tournament={t} slots={slots[m.id]} />)}
                {playoffs.length > 0 && (
                  <>
                    <h3 className={`${ui.eyebrow} text-muted`}>Playoff</h3>
                    {playoffs.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label="Playoff" tone={poolTone(pi).head} pending={pending(m)} tournament={t} slots={slots[m.id]} />)}
                  </>
                )}
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}
