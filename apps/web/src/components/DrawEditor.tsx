'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/actions/errors';
import { ui } from './ui';

export interface DrawSeat { index: number; teamId: string | null }
export interface DrawPair { label: string; a: DrawSeat; b: DrawSeat }

/**
 * The knockout draw as a list of first-round matches the organiser can rearrange.
 *
 * Picking a team for a place swaps it with wherever that team already stood, so the draw is always
 * a draw: nobody can end up in it twice or drop out of it. Each change is saved as it is made —
 * the draw is shared, so the organiser standing at the other end of the hall sees the same one —
 * and none of it exists as a match until the knockout is started.
 */
export function DrawEditor({ pairs, options, byes, move, moveMatch }: {
  pairs: readonly DrawPair[];
  /** The qualifiers, in the order they should appear in the dropdowns. */
  options: readonly { id: string; name: string }[];
  /** The draw has empty places, so "no team" is a choice. */
  byes: boolean;
  move: (index: number, teamId: string | null) => Promise<ActionResult>;
  /** Moves a whole match to another match's number, swapping the two. */
  moveMatch: (from: number, to: number) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (action: () => Promise<ActionResult>) => {
    start(async () => {
      const r = await action();
      if (!r.ok) { setError(r.message ?? r.error); return; }
      setError(null);
      router.refresh();
    });
  };
  const change = (index: number, value: string) => save(() => move(index, value === '' ? null : value));

  const seat = (s: DrawSeat, label: string) => (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <label className="sr-only" htmlFor={`seat-${s.index}`}>{label}</label>
      <select
        id={`seat-${s.index}`}
        data-testid="draw-seat"
        data-seat={s.index}
        value={s.teamId ?? ''}
        disabled={pending}
        onChange={(e) => change(s.index, e.target.value)}
        className={`${ui.fieldSm} w-full`}
      >
        {byes && <option value="">— bye —</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </span>
  );

  return (
    <div data-testid="draw-editor" className="space-y-2.5" aria-busy={pending}>
      <ul className="space-y-2.5">
        {pairs.map((p, i) => (
          <li key={p.label} className="flex flex-wrap items-center gap-3 border-hair border-line px-4 py-3">
            {pairs.length > 1 ? (
              <span className="w-full sm:w-44">
                <label className="sr-only" htmlFor={`match-${i}`}>Match number for {p.a.teamId ? options.find((o) => o.id === p.a.teamId)?.name : 'bye'} v {p.b.teamId ? options.find((o) => o.id === p.b.teamId)?.name : 'bye'}</label>
                <select
                  id={`match-${i}`}
                  data-testid="draw-match-number"
                  value={i}
                  disabled={pending}
                  onChange={(e) => save(() => moveMatch(i, Number(e.target.value)))}
                  className={`${ui.fieldSm} w-full font-bold`}
                >
                  {pairs.map((o, j) => <option key={o.label} value={j}>{o.label}</option>)}
                </select>
              </span>
            ) : <span className={`${ui.eyebrow} w-full text-muted sm:w-28`}>{p.label}</span>}
            {seat(p.a, `${p.label}, first team`)}
            <span className="text-sm font-medium lowercase text-line-strong">v</span>
            {seat(p.b, `${p.label}, second team`)}
          </li>
        ))}
      </ul>
      {pairs.length > 2 && (
        <p className={ui.help}>Change a match&apos;s number to swap it with that match. The winners of 1 and 2 meet in the next round, then 3 and 4, and so on.</p>
      )}
      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}
