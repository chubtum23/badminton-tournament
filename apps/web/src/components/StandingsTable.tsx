import type { ReactNode } from 'react';
import type { StandingRow, UnresolvedTie } from '@tournament/core';
import type { TeamRow } from '@/lib/db/types';

function tieNote(tie: UnresolvedTie): string {
  return tie.affects === 'qualification'
    ? 'Tie for the last qualifying place to be decided'
    : 'Tie for first place to be decided';
}

const th = 'pb-3 pt-1 text-xs font-bold uppercase tracking-label text-muted';
const num = 'px-1 text-center tabular-nums text-muted-strong';

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
      <table className="w-full text-base">
        <thead>
          <tr className="border-b-hair border-line text-left">
            <th className={`${th} w-7`}>#</th>
            <th className={th}>Team</th>
            <th className={`${th} w-10 text-center`}>P</th>
            <th className={`${th} w-10 text-center`}>W</th>
            <th className={`${th} w-12 text-center`}>Pts</th>
            <th className={`${th} w-10 text-center`}>±</th>
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
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t?.colour }} />{r.name}
                    {t?.seed && <span className="bg-orange-tint px-1.5 text-[11px] font-bold text-orange-ink">#{t.seed}</span>}
                    {r.tieUnresolved && <span className="bg-red-100 px-1.5 text-[11px] font-bold uppercase tracking-label text-red-800">tie</span>}
                    {t?.withdrawn && <span className="bg-line-soft px-1.5 text-[11px] font-bold uppercase tracking-label text-muted">withdrawn</span>}
                  </span>
                  {t?.tagline && <span className="block truncate text-xs font-normal text-muted">{t.tagline}</span>}
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
      {manual && <p className="mt-2 text-xs font-bold uppercase tracking-label text-muted">Order set by organiser</p>}
      {ties && ties.length > 0 && (
        <div className="mt-2 space-y-1">
          {ties.map((tie) => <p key={tie.teamIds.join('-')} className="text-xs font-bold uppercase tracking-label text-red-700">{tieNote(tie)}</p>)}
        </div>
      )}
    </>
  );
}
