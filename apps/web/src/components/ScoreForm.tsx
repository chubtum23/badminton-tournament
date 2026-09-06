'use client';
import { Fragment, useState } from 'react';
import { gamesNeeded, validateGame, type Settings, type Game } from '@tournament/core';

export function ScoreForm({ matchId, settings, existing, teamA, teamB, action, submitLabel, confirmMessage }: {
  matchId: string; settings: Settings; existing: Game[]; teamA: string; teamB: string;
  action: (formData: FormData) => void; submitLabel: string;
  /** When set, the submit is gated behind a window.confirm() with this text. */
  confirmMessage?: string;
}) {
  const rows = Array.from({ length: settings.gamesPerMatch }, (_, i) => i + 1);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const g of existing) { v[`game${g.gameNo}a`] = String(g.scoreA); v[`game${g.gameNo}b`] = String(g.scoreB); }
    return v;
  });
  let winsA = 0, winsB = 0;
  const hints = rows.map((n) => {
    const a = vals[`game${n}a`] ?? '', b = vals[`game${n}b`] ?? '';
    if (a === '' && b === '') return '';
    const v = validateGame(settings, Number(a), Number(b));
    if (!v.ok) return v.reason;
    if (v.winner === 'a') winsA++; else winsB++;
    return v.winner === 'a' ? `${teamA} won` : `${teamB} won`;
  });
  const needed = gamesNeeded(settings);
  const status = winsA >= needed ? `${teamA} wins the match` : winsB >= needed ? `${teamB} wins the match` : `${winsA}-${winsB} in games`;

  return (
    <form
      action={action}
      onSubmit={(e) => { if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault(); }}
      data-testid="score-form"
      className="space-y-2 text-sm"
    >
      <input type="hidden" name="matchId" value={matchId} />
      <div className="grid grid-cols-[auto_1fr_1fr_2fr] items-center gap-2">
        <span />
        <span className="truncate font-medium">{teamA}</span>
        <span className="truncate font-medium">{teamB}</span>
        <span />
        {rows.map((n, i) => (
          <Fragment key={n}>
            <span className="text-slate-500">Game {n}</span>
            <input name={`game${n}a`} inputMode="numeric" value={vals[`game${n}a`] ?? ''} onChange={(e) => setVals({ ...vals, [`game${n}a`]: e.target.value })} className="w-16 rounded border p-1" />
            <input name={`game${n}b`} inputMode="numeric" value={vals[`game${n}b`] ?? ''} onChange={(e) => setVals({ ...vals, [`game${n}b`]: e.target.value })} className="w-16 rounded border p-1" />
            <span className="text-xs text-slate-500">{hints[i]}</span>
          </Fragment>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded bg-slate-900 px-3 py-1 text-white">{submitLabel}</button>
        <span className="text-xs text-slate-600">{status}</span>
      </div>
    </form>
  );
}
