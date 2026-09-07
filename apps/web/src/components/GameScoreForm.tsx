'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { validateGame, type Settings } from '@tournament/core';
import type { ActionResult } from '@/actions/errors';
import { OUTCOME_EVENT, OUTCOME_PREFIX } from './RecentOutcome';

/** Text an action can hand back for the inline outcome line. */
const outcomeText = (data: unknown): string | null =>
  typeof data === 'object' && data !== null && 'text' in data && typeof (data as { text: unknown }).text === 'string'
    ? (data as { text: string }).text
    : null;

/**
 * Score entry for one game of a meeting. The organiser enters each game as it finishes, so this
 * holds a single pair of numbers rather than the whole meeting.
 *
 * It calls the server action itself (rather than being a plain `<form action>`), so the outcome
 * lands inline instead of as a redirect: the typed values survive a rejected save, and the page
 * around the form is refreshed on success. A saved game usually unmounts this form — the row
 * turns into a score line, and a finished meeting leaves the "open" filter — so the message is
 * also handed to <RecentOutcome /> at the top of the page.
 */
export function GameScoreForm({ matchId, gameNo, settings, label, teamA, teamB, existing, action, successText = 'Saved' }: {
  matchId: string;
  gameNo: number;
  settings: Settings;
  /** The game's name, e.g. "Men's doubles"; used for the accessible names of the inputs. */
  label: string;
  teamA: string;
  teamB: string;
  /** Prefills the form when the game already has a score (the "Change" path). */
  existing?: { scoreA: number; scoreB: number; timeExpired: boolean };
  action: (formData: FormData) => Promise<ActionResult<unknown>>;
  /** Shown on success unless the action returns its own `text`. */
  successText?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const [a, setA] = useState(existing ? String(existing.scoreA) : '');
  const [b, setB] = useState(existing ? String(existing.scoreB) : '');
  const [expired, setExpired] = useState(existing?.timeExpired ?? false);
  const clocked = settings.timeCapMinutes !== null;

  const typed = a.trim() !== '' && b.trim() !== '';
  const check = validateGame(settings, Number(a), Number(b), expired);
  const ready = typed && check.ok;
  const hint = !typed ? '' : check.ok ? `${check.winner === 'a' ? teamA : teamB} won` : check.reason;

  return (
    <form
      action={(fd) => {
        start(async () => {
          const r = await action(fd);
          if (!r.ok) { setOutcome({ ok: false, text: r.message ?? r.error }); return; }
          const text = outcomeText(r.data) ?? successText;
          setOutcome({ ok: true, text });
          try { sessionStorage.setItem(`${OUTCOME_PREFIX}${matchId}:${gameNo}`, JSON.stringify({ text, at: Date.now() })); } catch { /* storage blocked */ }
          window.dispatchEvent(new Event(OUTCOME_EVENT));
          router.refresh();
        });
      }}
      data-testid="game-score-form"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="gameNo" value={gameNo} />
      <input
        name="scoreA" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)}
        aria-label={`${label} · ${teamA}`} className="w-14 rounded border p-1"
      />
      <input
        name="scoreB" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)}
        aria-label={`${label} · ${teamB}`} className="w-14 rounded border p-1"
      />
      {clocked && (
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input
            type="checkbox" name="timeExpired" checked={expired} onChange={(e) => setExpired(e.target.checked)}
            title="Clock ran out; highest score wins" aria-label={`${label} time up`}
          />
          Time up
        </label>
      )}
      <button disabled={!ready || pending} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40">
        {pending ? 'Saving…' : 'Save'}
      </button>
      {hint && <span className="text-xs text-slate-600">{hint}</span>}
      {outcome && (
        <span data-testid="game-outcome" className={`text-xs ${outcome.ok ? 'text-emerald-700' : 'text-red-700'}`}>{outcome.text}</span>
      )}
    </form>
  );
}
