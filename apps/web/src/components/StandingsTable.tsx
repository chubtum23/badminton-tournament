import type { StandingRow } from '@tournament/core';
import type { TeamRow } from '@/lib/db/types';

export function StandingsTable({ rows, teams, advance }: { rows: StandingRow[]; teams: readonly TeamRow[]; advance: number }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-500">
          <th className="py-1">#</th><th>Team</th><th className="text-right">P</th><th className="text-right">W</th><th className="text-right">L</th><th className="text-right">Pts ±</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const t = teams.find((x) => x.id === r.teamId);
          return (
            <tr key={r.teamId} className={`border-t ${i < advance ? 'bg-emerald-50' : ''}`}>
              <td className="py-1 text-slate-500">{i + 1}</td>
              <td className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: t?.colour }} />{r.name}{t?.seed && <span className="rounded bg-amber-100 px-1 text-[10px]">#{t.seed}</span>}</td>
              <td className="text-right">{r.played}</td><td className="text-right">{r.won}</td><td className="text-right">{r.lost}</td>
              <td className="text-right font-mono">{r.pointDiff > 0 ? `+${r.pointDiff}` : r.pointDiff}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
