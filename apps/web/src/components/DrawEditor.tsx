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
export function DrawEditor({ pairs, options, byes, move }: {
  pairs: readonly DrawPair[];
  /** The qualifiers, in the order they should appear in the dropdowns. */
  options: readonly { id: string; name: string }[];
  /** The draw has empty places, so "no team" is a choice. */
  byes: boolean;
  move: (index: number, teamId: string | null) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const change = (index: number, value: string) => {
    start(async () => {
      const r = await move(index, value === '' ? null : value);
      if (!r.ok) { setError(r.message ?? r.error); return; }
      setError(null);
      router.refresh();
    });
  };

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
        {pairs.map((p) => (
          <li key={p.label} className="flex flex-wrap items-center gap-3 border-hair border-line px-4 py-3">
            <span className={`${ui.eyebrow} w-full text-muted sm:w-28`}>{p.label}</span>
            {seat(p.a, `${p.label}, first team`)}
            <span className="text-sm font-medium lowercase text-line-strong">v</span>
            {seat(p.b, `${p.label}, second team`)}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}
