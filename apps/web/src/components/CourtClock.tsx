'use client';
import { useEffect, useState } from 'react';
import { remainingMs, type ClockState } from '@/lib/results/clock';

/**
 * Counts the stage's time cap down from when the match went to court. The end time is derived
 * (not stored), so every viewer sees the same clock without anything being written per tick.
 *
 * A stoppage does not eat into the cap: while `pausedAt` is set the clock is frozen and the
 * ticker is not even started, and `pausedMs` gives every earlier stoppage back to the match.
 */
export function CourtClock({ startedAt, capMinutes, pausedAt = null, pausedMs = 0 }: {
  startedAt: string;
  capMinutes: number;
  /** Set while the clock is stopped; null while it is running. */
  pausedAt?: string | null;
  /** Total milliseconds already spent paused. */
  pausedMs?: number;
}) {
  const state: ClockState = { startedAt, capMinutes, pausedAt, pausedMs };
  const paused = pausedAt !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return; // frozen: nothing to tick
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paused]);
  const left = Math.max(0, Math.round((remainingMs(state, now) ?? 0) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const tone = left === 0 ? 'bg-red-600 text-white' : paused ? 'bg-amber-500 text-white' : 'bg-slate-900 text-white';
  return (
    <span data-testid="court-clock" className={`rounded px-1.5 font-mono text-xs ${tone}`}>
      {left === 0 ? 'TIME' : paused ? `${mm}:${ss} paused` : `${mm}:${ss}`}
    </span>
  );
}
