import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { replaceTeamInMatch, startKnockout } from '@/actions/bracket';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { gameSlotsByMatch, listGames, listMatches, listPools, listTeams } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { planKnockout } from '@/lib/bracket/plan';
import { knockoutInput } from '@/lib/bracket/input';
import { Bracket } from '@/components/Bracket';
import { DrawTree } from '@/components/DrawTree';
import { computePool } from '@/lib/standings/compute';
import { teamName } from '@/components/MatchCard';
import { FlashMessage } from '@/components/FlashMessage';
import { SubmitButton } from '@/components/SubmitButton';

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
  const slots = gameSlotsByMatch(gameRows);
  // The same tables the Standings page shows, so the tree can never disagree with them.
  const standings = Object.fromEntries(pools.map((p) => [
    p.id, computePool({ pool: p, teams, matches, games, advancePerPool: t.advance_per_pool }).rows,
  ]));
  const here = `/admin/${slug}/draw`;

  async function start() {
    'use server';
    const r = await startKnockout(slug);
    redirect(`${here}?msg=${encodeURIComponent(r.ok ? 'Knockout started' : r.message ?? r.error)}`);
  }
  async function replace(formData: FormData) {
    'use server';
    const side = String(formData.get('side')) === 'b' ? 'b' : 'a';
    redirectWithMsg(here, await replaceTeamInMatch(slug, String(formData.get('matchId')), side, String(formData.get('teamId'))), 'Team replaced');
  }

  if (t.status === 'pools') {
    let n = 0;
    // Same input the real start uses, so the preview refuses for exactly the same reasons
    // (unfinished matches, an unresolved tie on a qualification line, a pool too small).
    const preview = planKnockout({ ...knockoutInput({ tournament: t, pools, teams, matchRows, gameRows }), newId: () => `preview-${++n}` });
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
            <form action={start}><SubmitButton className="rounded bg-emerald-700 px-4 py-2 text-white">Start knockout with this bracket</SubmitButton></form>
          </>
        )}
      </div>
    );
  }

  // A withdrawal (or a corrected pool table) can leave the wrong team in an unplayed knockout
  // match; these forms swap one side without touching anything that has already been played.
  const replaceable = matches.filter((m) => m.stage === 'knockout' && m.status !== 'done');
  const selectable = teams.filter((x) => !x.withdrawn);

  return (
    <div className="space-y-4">
      <FlashMessage />
      {t.status === 'setup' && <p className="text-sm text-slate-500">Lock the pools first.</p>}
      {pools.length > 0 && (
        <DrawTree tournament={t} pools={pools} teams={teams} matches={matches} games={games} slots={slots}
          standings={standings} settings={settingsFor(t, 'knockout')} />
      )}
      <Bracket matches={matches} teams={teams} games={games} slots={slots} hrefFor={() => `/admin/${slug}/matches?pool=all`} />
      {t.status === 'finished' && <p className="rounded bg-amber-50 p-3 text-sm">Tournament finished. Champion: {teams.find((x) => x.id === matches.find((m) => m.stage === 'knockout' && m.nextMatchId === null)?.winnerId)?.name}</p>}
      {replaceable.length > 0 && (
        <section className="rounded border bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold">Replace a team</h2>
          <ul className="space-y-2">
            {replaceable.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 border-t pt-2 first:border-t-0 first:pt-0">
                <span className="text-slate-500">Round {m.round} · #{m.slot}</span>
                <span>{teamName(teams, m.teamAId)} v {teamName(teams, m.teamBId)}</span>
                <form action={replace} className="flex flex-wrap items-center gap-1">
                  <input type="hidden" name="matchId" value={m.id} />
                  <select name="side" defaultValue="a" className="rounded border p-1 text-xs">
                    <option value="a">a</option>
                    <option value="b">b</option>
                  </select>
                  <select name="teamId" defaultValue={m.teamAId ?? selectable[0]?.id} className="rounded border p-1 text-xs">
                    {selectable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <SubmitButton className="rounded border px-2 py-1 text-xs">Replace</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
