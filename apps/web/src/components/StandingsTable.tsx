import type { ReactNode } from 'react';
import type { StandingRow, UnresolvedTie } from '@tournament/core';
import type { TeamRow } from '@/lib/db/types';
import { TeamAvatar } from './TeamAvatar';

function tieNote(tie: UnresolvedTie): string {
  return tie.affects === 'qualification'
    ? 'Tie for the last qualifying place to be decided'
    : 'Tie for first place to be decided';
}

const th = 'pb-3 pt-1 text-xs font-bold uppercase tracking-label text-muted';
const num = 'px-1 text-center tabular-nums text-muted-strong';

// Short labels on a phone so the team name keeps its room; full words once there's space.
const STAT_COLS = [
  { short: 'P', full: 'Played', title: 'Matches played', width: 'w-10 sm:w-16' },
  { short: 'W', full: 'Won', title: 'Matches won', width: 'w-10 sm:w-14' },
  { short: 'Pts', full: 'Points', title: 'Table points — one per match won', width: 'w-12 sm:w-16' },
  { short: '±', full: '+/−', title: 'Points scored minus points conceded', width: 'w-10 sm:w-14' },
] as const;

/** The four stat column headers shared by every standings table. */
export function StatHeaders({ th }: { th: string }) {
  return STAT_COLS.map((c) => (
    <th key={c.full} className={`${th} ${c.width} text-center`} title={c.title}>
      <abbr title={c.title} className="no-underline sm:hidden">{c.short}</abbr>
      <span className="hidden sm:inline">{c.full}</span>
    </th>
  ));
}

/** One-line legend under a standings table; spells out the phone abbreviations and what ± counts. */
export function StatKey() {
  return (
    <p className="mt-3 text-xs text-muted" data-testid="standings-key">
      <span className="sm:hidden">P played · W won · Pts one per win · ± points scored minus conceded</span>
      <span className="hidden sm:inline">Points: one per match won · +/−: points scored minus points conceded, which splits teams level on wins</span>
    </p>
  );
}

export function StandingsTable({ rows, teams, advance, manual, ties, actionHeader, rowAction }: {
  rows: StandingRow[]; teams: readonly TeamRow[]; advance: number;
  /** The organiser has set the finishing order for this pool; renders the "Order set by organiser" caption. */
  manual?: boolean;
  /** Unresolved ties to note under the table, one line each. */
  ties?: readonly UnresolvedTie[];
  /** Header for the extra column `rowAction` fills. */
  actionHeader?: ReactNode;
  /** Extra cell per row (the organiser's finishing-order select on the admin page). */
  rowAction?: (row: StandingRow, index: number) => ReactNode;
}) {
  return (
    <>
      {/* The scroller is the backstop for a phone: a table cell grows to fit its content, so one
          unbreakable name would otherwise widen the whole page past the screen. */}
      <div className="overflow-x-auto">
      <table className="w-full text-base">
        <thead>
          <tr className="border-b-hair border-line text-left">
            <th className={`${th} w-7`}>#</th>
            <th className={th}>Team</th>
            <StatHeaders th={th} />
            {rowAction && <th className={`${th} text-right`}>{actionHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const t = teams.find((x) => x.id === r.teamId);
            // The qualifying places are the whole point of a pool table, so they carry a tint
            // rather than only a rule — readable from a bench, and it survives being photographed.
            return (
              <tr
                key={r.teamId}
                data-qualifies={i < advance ? '' : undefined}
                className={`border-b-hair border-line-soft ${i < advance ? 'bg-orange-wash' : ''}`}
              >
                <td className="py-4 font-display text-lg font-extrabold">{i + 1}</td>
                <td className={`py-4 font-bold ${t?.withdrawn ? 'text-muted-soft line-through' : ''}`}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <TeamAvatar teamName={r.name} colour={t?.colour ?? '#2B3390'} path={t?.photo_path ?? null} size={38} />{r.name}
                    {t?.seed && <span className="bg-orange-tint px-1.5 text-[11px] font-bold text-orange-ink">#{t.seed}</span>}
                    {r.tieUnresolved && <span className="bg-red-100 px-1.5 text-[11px] font-bold uppercase tracking-label text-red-800">tie</span>}
                    {t?.withdrawn && <span className="bg-line-soft px-1.5 text-[11px] font-bold uppercase tracking-label text-muted">withdrawn</span>}
                  </span>
                  {/* Clamped rather than truncated: `truncate` is nowrap, and a nowrap line sets the
                      cell's minimum width, which pushed the table wider than a 375px phone. */}
                  {t?.tagline && <span className="line-clamp-2 break-words text-xs font-normal text-muted">{t.tagline}</span>}
                </td>
                <td className={num}>{r.played}</td>
                <td className={num}>{r.won}</td>
                <td className="px-1 text-center font-bold tabular-nums">{r.points}</td>
                <td className={num}>{r.pointDiff > 0 ? `+${r.pointDiff}` : r.pointDiff}</td>
                {rowAction && <td className="py-4 text-right">{rowAction(r, i)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <StatKey />
      {manual && <p className="mt-2 text-xs font-bold uppercase tracking-label text-muted">Order set by organiser</p>}
      {ties && ties.length > 0 && (
        <div className="mt-2 space-y-1">
          {ties.map((tie) => <p key={tie.teamIds.join('-')} className="text-xs font-bold uppercase tracking-label text-red-700">{tieNote(tie)}</p>)}
        </div>
      )}
    </>
  );
}
