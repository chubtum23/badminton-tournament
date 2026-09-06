import { notFound } from 'next/navigation';
import { liveBoard } from '@tournament/core';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadTournamentBundle } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch } from '@/lib/db/mappers';
import { MatchCard } from '@/components/MatchCard';

export const dynamic = 'force-dynamic';

export default async function LivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const { tournament: t, pools, teams } = bundle;
  const matches = bundle.matches.map(rowToMatch);
  const games = gamesByMatch(bundle.games);
  const stage = t.status === 'knockout' || t.status === 'finished' ? 'knockout' : 'pool';
  const board = liveBoard(matches, stage, pools.map((p) => p.id));
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? pools.find((p) => p.id === m.poolId)?.name ?? 'Pool' : `Round ${m.round}`;
  const seeded = teams.filter((x) => x.seed !== null).sort((x, y) => (x.seed ?? 0) - (y.seed ?? 0));
  const recent = matches.filter((m) => m.status === 'done' && m.teamAId && m.teamBId).slice(-6).reverse();

  return (
    <div className="space-y-6">
      {t.status === 'setup' && <p className="rounded border bg-white p-4 text-sm">Pools have not been drawn yet. Check back soon.</p>}
      <section>
        <h2 className="mb-2 font-semibold">Now playing</h2>
        {board.nowPlaying.length === 0 ? <p className="text-sm text-slate-500">No match on court right now.</p> : (
          <div className="grid gap-3 md:grid-cols-2">{board.nowPlaying.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} />)}</div>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Up next</h2>
        {board.upNext.length === 0 ? <p className="text-sm text-slate-500">Nothing queued.</p> : (
          <div className="grid gap-3 md:grid-cols-2">{board.upNext.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)} />)}</div>
        )}
      </section>
      {seeded.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Top seeds</h2>
          <ol className="flex flex-wrap gap-2 text-sm">{seeded.map((x) => <li key={x.id} className="rounded border bg-white px-2 py-1"><span className="mr-1 rounded bg-amber-100 px-1 text-xs">#{x.seed}</span>{x.name}</li>)}</ol>
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Latest results</h2>
          <div className="grid gap-3 md:grid-cols-2">{recent.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} />)}</div>
        </section>
      )}
    </div>
  );
}
