import type { Game } from '@tournament/core';
import type { SubmissionRow } from '@/lib/db/types';

function fmt(games: Game[]) { return games.map((g) => `${g.scoreA}–${g.scoreB}`).join(', '); }

/** The two teams' claimed scores side by side, so the organiser can pick one and move on. */
export function SubmissionCompare({ a, b, teamA, teamB, onConfirm }: {
  a?: SubmissionRow; b?: SubmissionRow; teamA: string; teamB: string;
  /** Renders a confirm form for the given submission id. */
  onConfirm: (submissionId: string) => React.ReactNode;
}) {
  const cell = (label: string, s?: SubmissionRow) => (
    <div data-testid="submission-cell" className="border-hair border-line p-3">
      <div className="text-xs font-bold uppercase tracking-label text-muted">{label} says</div>
      {s
        ? <><div className="mt-1 font-display text-lg font-black tabular-nums">{fmt(s.games)}</div><div className="mt-2.5">{onConfirm(s.id)}</div></>
        : <div className="mt-1 text-xs font-bold uppercase tracking-label text-muted">no submission</div>}
    </div>
  );
  return <div className="grid grid-cols-2 gap-3">{cell(teamA, a)}{cell(teamB, b)}</div>;
}
