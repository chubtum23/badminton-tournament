import type { Game } from '@tournament/core';
import type { SubmissionRow } from '@/lib/db/types';

function fmt(games: Game[]) { return games.map((g) => `${g.scoreA}-${g.scoreB}`).join(', '); }

export function SubmissionCompare({ a, b, teamA, teamB, onConfirm }: {
  a?: SubmissionRow; b?: SubmissionRow; teamA: string; teamB: string;
  /** Renders a confirm form for the given submission id. */
  onConfirm: (submissionId: string) => React.ReactNode;
}) {
  const cell = (label: string, s?: SubmissionRow) => (
    <div className="rounded border p-2">
      <div className="text-xs text-slate-500">{label} says</div>
      {s ? <><div className="font-mono text-sm">{fmt(s.games)}</div><div className="mt-1">{onConfirm(s.id)}</div></> : <div className="text-xs text-slate-400">no submission</div>}
    </div>
  );
  return <div className="grid grid-cols-2 gap-2">{cell(teamA, a)}{cell(teamB, b)}</div>;
}
