import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { overallLeaderboard } from '@tournament/core';
import { clearManualOrder, createPlayoff, generatePools, moveTeam, setManualOrder } from '@/actions/pools';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { fail } from '@/actions/errors';
import { gameSlotsByMatch, listGames, listMatches, listPools, listTeams } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch } from '@/lib/db/mappers';
import { computePool } from '@/lib/standings/compute';
import { StandingsTable } from '@/components/StandingsTable';
import { SubmitButton } from '@/components/SubmitButton';
import { FlashMessage } from '@/components/FlashMessage';
import { ui } from '@/components/ui';

export default async function PoolsAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [pools, teams, matchRows, gameRows] = await Promise.all([
    listPools(ctx.sb, t.id), listTeams(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id),
  ]);
  const editable = t.status === 'setup';
  // Playoffs and the organiser's order are pool-stage tools; once the knockout starts the tables
  // are history and the bracket is edited with "replace team" instead.
  const inPlay = t.status === 'pools';
  const matches = matchRows.map(rowToMatch);
  const games = gamesByMatch(gameRows);
  // A meeting is three games now, so a finished fixture lists every game score and one still going
  // shows how many of its games have been played.
  const slots = gameSlotsByMatch(gameRows);
  const played = (id: string) => (slots[id] ?? []).filter((g) => g.score_a !== null);
  const here = `/admin/${slug}/standings`;
  const nameOf = (id: string) => teams.find((x) => x.id === id)?.name ?? '?';
  // Each pool's table is wanted twice — in its own section and in the overall leaderboard below —
  // so it is computed once here and read from both places.
  const poolResults = pools.map((pool) => ({ pool, ...computePool({ pool, teams, matches, games, advancePerPool: t.advance_per_pool }) }));

  async function generate(formData: FormData) {
    'use server';
    redirectWithMsg(here, await generatePools(slug, Number(formData.get('poolCount'))), 'Pools generated');
  }
  async function move(formData: FormData) {
    'use server';
    redirectWithMsg(here, await moveTeam(slug, String(formData.get('teamId')), String(formData.get('poolId'))), 'Team moved');
  }
  async function playoff(formData: FormData) {
    'use server';
    redirectWithMsg(here, await createPlayoff(slug, String(formData.get('poolId')), String(formData.get('teamX')), String(formData.get('teamY'))), 'Playoff created');
  }
  async function order(formData: FormData) {
    'use server';
    const poolId = String(formData.get('poolId'));
    const entries: { teamId: string; rank: number }[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('rank_')) continue;
      entries.push({ teamId: key.slice('rank_'.length), rank: Number(value) });
    }
    // The action checks that every team appears; only the positions can collide here.
    if (new Set(entries.map((e) => e.rank)).size !== entries.length) {
      return redirectWithMsg(here, fail('invalid_input', 'Give every team a different position'), 'Order set');
    }
    const ordered = entries.sort((a, b) => a.rank - b.rank).map((e) => e.teamId);
    redirectWithMsg(here, await setManualOrder(slug, poolId, ordered), 'Order set');
  }
  async function clearOrder(formData: FormData) {
    'use server';
    redirectWithMsg(here, await clearManualOrder(slug, String(formData.get('poolId'))), 'Order cleared');
  }

  return (
    <div className="space-y-4">
      <FlashMessage />
      {editable && (
        <form action={generate} className="flex items-end gap-2 rounded border bg-white p-4 text-sm">
          <label>Number of pools
            <input name="poolCount" type="number" min={1} max={teams.length} defaultValue={Math.max(1, Math.round(teams.length / 4))} className="mt-1 w-24 rounded border p-2" />
          </label>
          <SubmitButton className="rounded bg-slate-900 px-4 py-2 text-white">{pools.length ? 'Re-deal randomly' : 'Generate pools'}</SubmitButton>
          <span className="text-slate-500">{teams.length} teams. Placement is random; seeds are labels only.</span>
        </form>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {poolResults.map(({ pool: p, rows, ties, manual, playoffs, complete, fixtures }) => {
          const poolTeams = teams.filter((x) => x.pool_id === p.id);
          const tiedPair = ties[0]?.teamIds ?? [];
          // A half-played pool has no finishing order worth arguing about, so the organiser's
          // tie-breaking tools stay out of the way until the pool is done (or already decided).
          const showTieTools = inPlay && (complete || manual);
          // The rank selects live inside the standings rows, so they reach the form by id.
          const formId = `order-${p.id}`;
          return (
            <section key={p.id} className="rounded border bg-white p-4">
              <h2 className="mb-2 font-semibold">{p.name}</h2>
              {editable ? (
                <ul className="space-y-1 text-sm">
                  {poolTeams.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-2">
                      <span>{x.seed && <span className="mr-1 rounded bg-amber-100 px-1 text-xs">#{x.seed}</span>}{x.name}</span>
                      <form action={move} className="flex gap-1">
                        <input type="hidden" name="teamId" value={x.id} />
                        <select name="poolId" defaultValue={p.id} className="rounded border p-1 text-xs">
                          {pools.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <SubmitButton className="rounded border px-2 text-xs">Move</SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  {ties.map((tie) => (
                    <p key={tie.teamIds.join('-')} className="mb-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
                      {tie.teamIds.map(nameOf).join(' and ')} are {tie.affects === 'qualification' ? 'tied for the last qualifying place' : 'tied at the top of the pool'}.
                      {' '}Record a playoff or set the finishing order below.
                    </p>
                  ))}
                  <StandingsTable
                    rows={rows}
                    teams={teams}
                    advance={t.advance_per_pool}
                    manual={manual}
                    actionHeader={showTieTools ? 'Place' : undefined}
                    rowAction={showTieTools ? (r, i) => (
                      <select name={`rank_${r.teamId}`} form={formId} defaultValue={i + 1} className="rounded border p-1 text-xs">
                        {rows.map((_, n) => <option key={n} value={n + 1}>{n + 1}</option>)}
                      </select>
                    ) : undefined}
                  />
                  {fixtures.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Fixtures</h3>
                      <ul className="space-y-0.5 text-xs">
                        {fixtures.map((m) => (
                          <li key={m.id} className="flex items-baseline justify-between gap-2">
                            <span>{m.teamAId ? nameOf(m.teamAId) : '?'} v {m.teamBId ? nameOf(m.teamBId) : '?'}</span>
                            <span className="shrink-0 font-mono text-slate-500">
                              {m.status === 'done'
                                ? (games[m.id] ?? []).map((x) => `${x.scoreA}-${x.scoreB}`).join(', ') || m.decidedBy
                                : `${played(m.id).length}/${(slots[m.id] ?? []).length} games`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {showTieTools && (
                    <div className="mt-3 space-y-3 border-t pt-3 text-sm">
                      <form id={formId} action={order} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="poolId" value={p.id} />
                        <SubmitButton className="rounded border px-2 py-1 text-xs">Set finishing order</SubmitButton>
                        <span className="text-xs text-slate-500">Pick a place for every team above.</span>
                      </form>
                      {manual && (
                        <form action={clearOrder}>
                          <input type="hidden" name="poolId" value={p.id} />
                          <SubmitButton className="rounded border px-2 py-1 text-xs">Clear manual order</SubmitButton>
                        </form>
                      )}
                      <form action={playoff} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="poolId" value={p.id} />
                        <select name="teamX" defaultValue={tiedPair[0] ?? poolTeams[0]?.id} className="rounded border p-1 text-xs">
                          {poolTeams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <span className="text-xs text-slate-500">v</span>
                        <select name="teamY" defaultValue={tiedPair[1] ?? poolTeams[1]?.id} className="rounded border p-1 text-xs">
                          {poolTeams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <SubmitButton confirmMessage="Create a playoff match between these two teams?" className="rounded border px-2 py-1 text-xs">Record men&apos;s doubles playoff</SubmitButton>
                      </form>
                      {playoffs.length > 0 && (
                        <p className="text-xs text-slate-500">
                          {playoffs.length} playoff{playoffs.length === 1 ? '' : 's'} in this pool; enter the result on the Matches page.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      {/* Locking and unlocking the pools are the organiser's home-page decisions now; this page
          shows the tables. Once the draw is locked every pool has a table worth totalling. */}
      {!editable && pools.length > 0 && (() => {
        const table = overallLeaderboard(
          poolResults.map((r) => ({ poolName: r.pool.name, rows: r.rows })),
          teams.filter((x) => x.withdrawn).map((x) => x.id),
        );
        return (
          <section className={ui.card} data-testid="leaderboard">
            <h2 className={`${ui.h2} mb-2`}>Overall points</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Rank</th><th>Team</th><th>Pool</th><th className="text-right">P</th><th className="text-right">W</th><th className="text-right">Pts</th><th className="text-right">±</th></tr></thead>
              <tbody>{table.map((r) => (
                <tr key={r.teamId} className="border-t"><td className="py-1 text-slate-500">{r.overallRank}</td><td>{r.name}</td><td className="text-slate-500">{r.poolName}</td><td className="text-right">{r.played}</td><td className="text-right">{r.won}</td><td className="text-right font-semibold">{r.points}</td><td className="text-right font-mono">{r.pointDiff > 0 ? `+${r.pointDiff}` : r.pointDiff}</td></tr>
              ))}</tbody>
            </table>
          </section>
        );
      })()}
    </div>
  );
}
