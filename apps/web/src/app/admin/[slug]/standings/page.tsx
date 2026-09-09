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
import { poolTag, poolTone, ui } from '@/components/ui';

const th = 'pb-2 pt-1 text-[11px] font-bold uppercase tracking-label text-muted';

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
  const poolIndexOf = (id: string | null) => pools.findIndex((p) => p.id === id);
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
    <div className="space-y-5">
      <FlashMessage />
      {editable && (
        <form action={generate} className={`${ui.card} flex flex-wrap items-end gap-4 px-5 py-4`}>
          <label className={ui.label}>Number of pools
            <input name="poolCount" type="number" min={1} max={teams.length} defaultValue={Math.max(1, Math.round(teams.length / 4))} className={`${ui.field} w-24`} />
          </label>
          <SubmitButton className={ui.solid}>{pools.length ? 'Re-deal randomly' : 'Generate pools'}</SubmitButton>
          <span className="text-[13px] text-muted">{teams.length} teams. Placement is random; seeds are labels only.</span>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {poolResults.map(({ pool: p, rows, ties, manual, playoffs, complete, fixtures }, pi) => {
          const poolTeams = teams.filter((x) => x.pool_id === p.id);
          const tiedPair = ties[0]?.teamIds ?? [];
          // A half-played pool has no finishing order worth arguing about, so the organiser's
          // tie-breaking tools stay out of the way until the pool is done (or already decided).
          const showTieTools = inPlay && (complete || manual);
          // The rank selects live inside the standings rows, so they reach the form by id.
          const formId = `order-${p.id}`;
          return (
            <section key={p.id} className={ui.card}>
              <div className={`${ui.head} ${poolTone(pi).head}`}>
                <h2 className={ui.eyebrow}>{p.name}</h2>
                <span className={ui.eyebrow}>Top {t.advance_per_pool} qualify</span>
              </div>
              <div className="px-5 py-4">
                {editable ? (
                  <ul className="divide-y divide-line-soft">
                    {poolTeams.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <span className="flex items-center gap-2 text-sm font-bold">
                          {x.seed && <span className="bg-orange-tint px-1.5 text-[10px] font-bold text-orange-ink">#{x.seed}</span>}
                          {x.name}
                        </span>
                        <form action={move} className="flex gap-1.5">
                          <input type="hidden" name="teamId" value={x.id} />
                          <label className="sr-only" htmlFor={`move-${x.id}`}>Pool for {x.name}</label>
                          <select id={`move-${x.id}`} name="poolId" defaultValue={p.id} className={ui.fieldSm}>
                            {pools.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                          <SubmitButton className={ui.tiny}>Move</SubmitButton>
                        </form>
                      </li>
                    ))}
                    {poolTeams.length === 0 && <li className="py-2 text-[13px] text-muted">No teams in this pool yet.</li>}
                  </ul>
                ) : (
                  <>
                    {ties.map((tie) => (
                      <p key={tie.teamIds.join('-')} className={`${ui.alarm} mb-3`}>
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
                        <>
                          <label className="sr-only" htmlFor={`rank-${r.teamId}`}>Finishing place for {r.name}</label>
                          <select id={`rank-${r.teamId}`} name={`rank_${r.teamId}`} form={formId} defaultValue={i + 1} className={ui.fieldSm}>
                            {rows.map((_, n) => <option key={n} value={n + 1}>{n + 1}</option>)}
                          </select>
                        </>
                      ) : undefined}
                    />
                    {fixtures.length > 0 && (
                      <div className="mt-5 border-t-hair border-line pt-4">
                        <h3 className={`${ui.eyebrow} mb-2 text-muted`}>Fixtures</h3>
                        <ul className="space-y-1">
                          {fixtures.map((m) => (
                            <li key={m.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                              <span className="font-semibold">{m.teamAId ? nameOf(m.teamAId) : '?'} v {m.teamBId ? nameOf(m.teamBId) : '?'}</span>
                              <span className="shrink-0 tabular-nums text-muted">
                                {m.status === 'done'
                                  ? (games[m.id] ?? []).map((x) => `${x.scoreA}–${x.scoreB}`).join(', ') || m.decidedBy
                                  : `${played(m.id).length}/${(slots[m.id] ?? []).length} games`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {showTieTools && (
                      <div className="mt-5 space-y-4 border-t-hair border-line pt-4">
                        <form id={formId} action={order} className="flex flex-wrap items-center gap-3">
                          <input type="hidden" name="poolId" value={p.id} />
                          <SubmitButton className={ui.secondary}>Set finishing order</SubmitButton>
                          <span className="text-xs text-muted">Pick a place for every team above.</span>
                        </form>
                        {manual && (
                          <form action={clearOrder}>
                            <input type="hidden" name="poolId" value={p.id} />
                            <SubmitButton className={ui.tiny}>Clear manual order</SubmitButton>
                          </form>
                        )}
                        <form action={playoff} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="poolId" value={p.id} />
                          <label className="sr-only" htmlFor={`x-${p.id}`}>First team in the playoff</label>
                          <select id={`x-${p.id}`} name="teamX" defaultValue={tiedPair[0] ?? poolTeams[0]?.id} className={ui.fieldSm}>
                            {poolTeams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                          <span className="text-xs font-bold uppercase tracking-label text-muted">v</span>
                          <label className="sr-only" htmlFor={`y-${p.id}`}>Second team in the playoff</label>
                          <select id={`y-${p.id}`} name="teamY" defaultValue={tiedPair[1] ?? poolTeams[1]?.id} className={ui.fieldSm}>
                            {poolTeams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                          <SubmitButton confirmMessage="Create a playoff match between these two teams?" className={ui.secondary}>Record men&apos;s doubles playoff</SubmitButton>
                        </form>
                        {playoffs.length > 0 && (
                          <p className={ui.help}>
                            {playoffs.length} playoff{playoffs.length === 1 ? '' : 's'} in this pool; enter the result on the Matches page.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
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
            <div className={ui.head}><h2 className={ui.eyebrow}>Overall points</h2></div>
            <div className="px-5 py-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-hair border-line text-left">
                    <th className={`${th} w-12`}>Rank</th><th className={th}>Team</th><th className={`${th} w-24`}>Pool</th>
                    <th className={`${th} w-10 text-center`}>P</th><th className={`${th} w-10 text-center`}>W</th>
                    <th className={`${th} w-12 text-center`}>Pts</th><th className={`${th} w-10 text-center`}>±</th>
                  </tr>
                </thead>
                <tbody>{table.map((r) => {
                  const pi = poolIndexOf(teams.find((x) => x.id === r.teamId)?.pool_id ?? null);
                  return (
                    <tr key={r.teamId} className="border-b-hair border-line-soft">
                      <td className="py-2.5 font-display font-extrabold">{r.overallRank}</td>
                      <td className="py-2.5 font-bold">{r.name}</td>
                      <td className="py-2.5"><span className={poolTag(pi < 0 ? 0 : pi)}>{r.poolName}</span></td>
                      <td className="px-1 text-center tabular-nums text-muted-strong">{r.played}</td>
                      <td className="px-1 text-center tabular-nums text-muted-strong">{r.won}</td>
                      <td className="px-1 text-center font-bold tabular-nums">{r.points}</td>
                      <td className="px-1 text-center tabular-nums text-muted-strong">{r.pointDiff > 0 ? `+${r.pointDiff}` : r.pointDiff}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>
        );
      })()}
    </div>
  );
}
