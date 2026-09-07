import type { ReactNode } from 'react';
import type { StandingRow, UnresolvedTie } from '@tournament/core';
import type { TeamRow } from '@/lib/db/types';

function tieNote(tie: UnresolvedTie): string {
  return tie.affects === 'qualification'
    ? 'Tie for the last qualifying place to be decided'
    : 'Tie for first place to be decided';
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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1">#</th><th>Team</th><th className="text-right">P</th><th className="text-right">W</th><th className="text-right">Pts</th><th className="text-right">±</th>
            {rowAction && <th className="text-right">{actionHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const t = teams.find((x) => x.id === r.teamId);
            return (
              <tr key={r.teamId} className={`border-t ${i < advance ? 'bg-emerald-50' : ''}`}>
                <td className="py-1 text-slate-500">{i + 1}</td>
                <td className={t?.withdrawn ? 'text-slate-400 line-through' : ''}>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: t?.colour }} />{r.name}
                    {t?.seed && <span className="rounded bg-amber-100 px-1 text-[10px]">#{t.seed}</span>}
                    {r.tieUnresolved && <span className="rounded bg-red-100 px-1 text-[10px] text-red-800">tie</span>}
                    {t?.withdrawn && <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-600">withdrawn</span>}
                  </span>
                  {t?.tagline && <span className="block truncate text-[11px] font-normal text-slate-500">{t.tagline}</span>}
                </td>
                <td className="text-right">{r.played}</td><td className="text-right">{r.won}</td><td className="text-right">{r.points}</td>
                <td className="text-right font-mono">{r.pointDiff > 0 ? `+${r.pointDiff}` : r.pointDiff}</td>
                {rowAction && <td className="text-right">{rowAction(r, i)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {manual && <p className="mt-1 text-xs text-slate-500">Order set by organiser</p>}
      {ties && ties.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {ties.map((tie) => <p key={tie.teamIds.join('-')} className="text-xs text-red-700">{tieNote(tie)}</p>)}
        </div>
      )}
    </>
  );
}
