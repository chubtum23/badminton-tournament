'use client';
import { useEffect, useState } from 'react';

/**
 * Counts the stage's time cap down from when the match went to court. The end time is derived
 * (not stored), so every viewer sees the same clock without anything being written per tick.
 */
export function CourtClock({ startedAt, capMinutes }: { startedAt: string; capMinutes: number }) {
  const end = new Date(startedAt).getTime() + capMinutes * 60_000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((end - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <span data-testid="court-clock" className={`rounded px-1.5 font-mono text-xs ${left === 0 ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>
      {left === 0 ? 'TIME' : `${mm}:${ss}`}
    </span>
  );
}
