import type { Game, Match, Settings, StandingRow } from '@tournament/core';
import type { GameRow, PoolRow, TeamRow, TournamentRow } from '@/lib/db/types';
import { centreMatch, drawModel, halfRounds, roundTitle, type DrawPool } from '@/lib/draw/model';
import { CourtClock } from './CourtClock';

/**
 * The whole draw on one screen: every pool table feeding the knockout.
 *
 * With an even number of pools the first half feed in from the left, the rest from the right,
 * and the final sits in the middle — which fits a hall screen without scrolling. Anything else
 * (three pools, a bracket this layout cannot split evenly) falls back to plain left-to-right.
 * Below 1100px both shapes become the same sideways-scrolling column of rounds, because a
 * mirrored tree on a phone is unreadable.
 */
export function DrawTree({ tournament, pools, teams, matches, games, slots, standings, settings }: {
  tournament: TournamentRow;
  pools: readonly PoolRow[];
  teams: readonly TeamRow[];
  matches: readonly Match[];
  /** Scored games per match, for the running score inside each knockout box. */
  games: Readonly<Record<string, Game[]>>;
  /** Every game row per match; a live meeting's courts and clocks are read off these. */
  slots: Readonly<Record<string, GameRow[]>>;
  /** Finishing order per pool id, as computePool returns it. */
  standings: Readonly<Record<string, readonly StandingRow[]>>;
  /** The knockout's rules, for the clock's time cap. */
  settings: Settings;
}) {
  const model = drawModel({ pools, teams, matches, standings, advancePerPool: tournament.advance_per_pool });
  const totalRounds = model.rounds.length;
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const slotRow = (m: Match, id: string | null) => {
    const t = id ? teamById.get(id) : undefined;
    const won = m.winnerId !== null && m.winnerId === id;
    const side = id !== null && id === m.teamAId ? 'a' : 'b';
    const scored = (games[m.id] ?? []).length;
    const wonGames = (games[m.id] ?? []).filter((g) => (side === 'a' ? g.scoreA > g.scoreB : g.scoreB > g.scoreA)).length;
    const decided = m.status === 'done' && m.decidedBy !== 'played';
    return (
      <div className={`flex items-center justify-between gap-2 px-2 py-1 ${won ? 'font-semibold' : ''}`}>
        <span className="flex min-w-0 items-center gap-1">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: t?.colour ?? '#cbd5e1' }} />
          <span className="truncate">{t?.name ?? (m.status === 'done' && !id ? 'bye' : 'TBD')}</span>
        </span>
        <span className="shrink-0 font-mono text-xs text-slate-600">
          {decided ? <span className="uppercase tracking-wide">{m.decidedBy}</span> : scored > 0 ? wonGames : ''}
        </span>
      </div>
    );
  };

  /** A knockout match: its two sides, and under them the court and clock while it is on. */
  const box = (m: Match) => {
    const live = (slots[m.id] ?? []).filter((s) => s.started_at !== null && s.score_a === null);
    return (
      <div className={`dt-box divide-y rounded border-2 bg-white text-sm ${m.status === 'live' ? 'border-emerald-500 shadow-md' : 'border-blue-900'}`}>
        {slotRow(m, m.teamAId)}
        {slotRow(m, m.teamBId)}
        {live.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-2 py-0.5 text-[10px] text-emerald-700">
            <span>LIVE · Court {live.map((s) => s.court ?? '?').join(', ')}</span>
            {settings.timeCapMinutes !== null && live[0]!.started_at && (
              <CourtClock startedAt={live[0]!.started_at} capMinutes={settings.timeCapMinutes}
                pausedAt={live[0]!.paused_at} pausedMs={live[0]!.paused_ms} />
            )}
          </div>
        )}
      </div>
    );
  };

  const heading = (text: string) => (
    <div className="mb-2 rounded bg-blue-900 px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-white">{text}</div>
  );

  const poolBox = (p: DrawPool) => (
    <section key={p.id} className="rounded border-2 border-blue-900 bg-white">
      <h3 className="rounded-t bg-blue-900 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">{p.name}</h3>
      {p.rows.length === 0 ? (
        <p className="px-2 py-1 text-xs text-slate-500">No teams yet.</p>
      ) : p.rows.map((r) => (
        <div key={r.teamId} className={`flex items-center justify-between gap-2 border-t px-2 py-1 text-sm first:border-t-0 ${r.qualifies ? 'bg-emerald-50 font-semibold' : ''}`}>
          <span className="flex min-w-0 items-center gap-1">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: r.colour }} />
            <span className={`truncate ${r.withdrawn ? 'text-slate-400 line-through' : ''}`}>{r.name}</span>
          </span>
          <span className="shrink-0 font-mono text-xs text-slate-600">{r.points}</span>
        </div>
      ))}
    </section>
  );

  /** One column of knockout matches. `offset` maps the column back to its real round number. */
  const roundColumn = (list: Match[], title: string) => (
    <div key={title + list.map((m) => m.id).join()} className="dt-round">
      {heading(title)}
      <div className="dt-slots">
        {list.map((m) => <div key={m.id} className="dt-slot">{box(m)}</div>)}
      </div>
    </div>
  );

  const notStarted = (
    <div className="flex min-w-[12rem] flex-col justify-center">
      <p className="rounded border-2 border-dashed border-blue-300 bg-white p-3 text-center text-xs text-slate-500">
        The knockout bracket appears here once every pool match is played.
      </p>
    </div>
  );

  // Plain left-to-right: all pools stacked in one column, then every round in order. This is the
  // narrow layout, and the fallback whenever the pools cannot be split into two equal halves.
  const flat = (
    <div className="flex gap-8" style={{ minHeight: `${Math.max(4, (model.rounds[0]?.length ?? 2) * 6)}rem` }}>
      <div className="dt-round space-y-3">{model.pools.map(poolBox)}</div>
      {totalRounds === 0 ? notStarted : (
        <div className="dt-l flex gap-8">
          {model.rounds.map((list, i) => roundColumn(list, roundTitle(i + 1, totalRounds)))}
        </div>
      )}
    </div>
  );

  if (!model.mirrored) return <div className="overflow-x-auto pb-4">{flat}</div>;

  const half = Math.ceil(model.pools.length / 2);
  const left = halfRounds(model, 'left');
  const right = halfRounds(model, 'right');
  const final = centreMatch(model);
  const titleFor = (list: Match[]) => roundTitle(list[0]?.round ?? 1, totalRounds);

  return (
    <>
      {/* Narrow screens get the stacked, sideways-scrolling shape. */}
      <div className="overflow-x-auto pb-4 xl:hidden">{flat}</div>

      {/* Wide screens get the mirror, with the final in the middle. */}
      <div className="hidden pb-4 xl:block">
        <div className="flex items-stretch gap-8" style={{ minHeight: `${Math.max(4, (left[0]?.length ?? 2) * 6)}rem` }}>
          <div className="dt-round space-y-3">{model.pools.slice(0, half).map(poolBox)}</div>
          <div className="dt-l flex flex-1 gap-8">{left.map((list) => roundColumn(list, titleFor(list)))}</div>
          <div className="flex min-w-[13rem] flex-col justify-center">
            <div className="mb-2 text-center text-lg font-black uppercase tracking-widest text-blue-900">Final</div>
            {final ? box(final) : (
              <p className="rounded border-2 border-dashed border-blue-300 bg-white p-3 text-center text-xs text-slate-500">
                {totalRounds === 0 ? 'Once every pool match is played.' : 'Waiting on the semi-finals.'}
              </p>
            )}
          </div>
          <div className="dt-r flex flex-1 gap-8">{right.map((list) => roundColumn(list, titleFor(list)))}</div>
          <div className="dt-round space-y-3">{model.pools.slice(half).map(poolBox)}</div>
        </div>
      </div>
    </>
  );
}
