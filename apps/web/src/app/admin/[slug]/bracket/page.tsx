import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { startKnockout } from '@/actions/bracket';
import { listGames, listMatches, listPools, listTeams } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, teamRefs } from '@/lib/db/mappers';
import { planKnockout } from '@/lib/bracket/plan';
import { Bracket } from '@/components/Bracket';
import { FlashMessage } from '@/components/FlashMessage';

export default async function BracketAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [pools, teams, matchRows, gameRows] = await Promise.all([
    listPools(ctx.sb, t.id), listTeams(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id),
  ]);
  const matches = matchRows.map(rowToMatch);
  const games = gamesByMatch(gameRows);

  async function start() {
    'use server';
    const r = await startKnockout(slug);
    redirect(`/admin/${slug}/bracket?msg=${encodeURIComponent(r.ok ? 'Knockout started' : r.message ?? r.error)}`);
  }

  if (t.status === 'pools') {
    let n = 0;
    const preview = planKnockout({
      pools: pools.map((p) => ({ id: p.id, name: p.name })), teams: teamRefs(teams),
      teamPoolIds: Object.fromEntries(teams.map((x) => [x.id, x.pool_id ?? ''])),
      matches, games, advancePerPool: t.advance_per_pool, newId: () => `preview-${++n}`,
    });
    return (
      <div className="space-y-4">
        <FlashMessage />
        {'error' in preview ? (
          <p className="rounded border bg-white p-4 text-sm">Not ready: {preview.error}</p>
        ) : (
          <>
            <section className="rounded border bg-white p-4 text-sm">
              <h2 className="mb-2 font-semibold">Qualifiers</h2>
              <ul className="grid gap-1 md:grid-cols-2">
                {preview.qualifiers.map((q) => (
                  <li key={q.poolId}><span className="text-slate-500">{pools.find((p) => p.id === q.poolId)?.name}:</span> {q.ranked.slice(0, t.advance_per_pool).map((id) => teams.find((x) => x.id === id)?.name).join(', ')}</li>
                ))}
              </ul>
            </section>
            <Bracket matches={preview.matches} teams={teams} games={{}} />
            <form action={start}><button className="rounded bg-emerald-700 px-4 py-2 text-white">Start knockout with this bracket</button></form>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FlashMessage />
      {t.status === 'setup' && <p className="text-sm text-slate-500">Lock the pools first.</p>}
      <Bracket matches={matches} teams={teams} games={games} hrefFor={() => `/admin/${slug}/matches?filter=all`} />
      {t.status === 'finished' && <p className="rounded bg-amber-50 p-3 text-sm">Tournament finished. Champion: {teams.find((x) => x.id === matches.find((m) => m.stage === 'knockout' && m.nextMatchId === null)?.winnerId)?.name}</p>}
    </div>
  );
}
