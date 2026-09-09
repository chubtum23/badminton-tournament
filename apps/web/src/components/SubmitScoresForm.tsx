'use client';
import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { gamesNeeded, matchResult, validateGame, type Settings, type Game } from '@tournament/core';
import type { ActionResult } from '@/actions/errors';
import { OUTCOME_EVENT, OUTCOME_PREFIX } from './RecentOutcome';

/** Scores are the numbers on this screen that matter, so they are set in the display face. */
const scoreBox = 'w-16 border-hair border-line bg-white px-2 py-1.5 text-center font-display text-lg font-black tabular-nums text-ink outline-none focus:border-navy';
const header = 'truncate text-xs font-bold uppercase tracking-label text-muted';

/** Text an action can hand back for the inline outcome line (submitted / confirmed / disputed). */
const outcomeText = (data: unknown): string | null =>
  typeof data === 'object' && data !== null && 'text' in data && typeof (data as { text: unknown }).text === 'string'
    ? (data as { text: string }).text
    : null;

/**
 * Whole-meeting score entry for a participant: a player reports every game of their meeting at
 * once, unlike the organiser, who scores one game at a time through GameScoreForm. The form calls the server action itself (rather than being a plain
 * `<form action>`), so the outcome lands inline instead of as a redirect: the typed values survive
 * a rejected save and the page around the form is refreshed on success.
 */
export function SubmitScoresForm({ matchId, settings, existing, teamA, teamB, action, submitLabel, confirmMessage, successText = 'Saved' }: {
  matchId: string; settings: Settings; existing: Game[]; teamA: string; teamB: string;
  action: (formData: FormData) => Promise<ActionResult<unknown>>; submitLabel: string;
  /** When set, the submit is gated behind a window.confirm() with this text. */
  confirmMessage?: string;
  /** Shown on success unless the action returns its own `text`. */
  successText?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = Array.from({ length: settings.gamesPerMatch }, (_, i) => i + 1);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const g of existing) {
      v[`game${g.gameNo}a`] = String(g.scoreA);
      v[`game${g.gameNo}b`] = String(g.scoreB);
      if (g.timeExpired) v[`game${g.gameNo}x`] = 'on';
    }
    return v;
  });
  const clocked = settings.timeCapMinutes !== null;

  const games: Game[] = [];
  for (const n of rows) {
    const a = vals[`game${n}a`] ?? '', b = vals[`game${n}b`] ?? '';
    if (a === '' && b === '') break;
    games.push({ gameNo: n, scoreA: Number(a), scoreB: Number(b), timeExpired: vals[`game${n}x`] === 'on' });
  }
  const hints = rows.map((n) => {
    const g = games.find((x) => x.gameNo === n);
    if (!g) return '';
    const v = validateGame(settings, g.scoreA, g.scoreB, g.timeExpired ?? false);
    return v.ok ? (v.winner === 'a' ? `${teamA} won` : `${teamB} won`) : v.reason;
  });
  const result = matchResult(settings, games);
  const ready = result.ok && result.complete;
  const status = !result.ok
    ? result.reason
    : result.complete
      ? (result.winner === 'a' ? `${teamA} wins the match` : `${teamB} wins the match`)
      : `${result.gamesA}-${result.gamesB} in games · need ${gamesNeeded(settings)}`;

  return (
    <form
      action={(fd) => {
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        start(async () => {
          const r = await action(fd);
          if (!r.ok) { setOutcome({ ok: false, text: r.message ?? r.error }); return; }
          const text = outcomeText(r.data) ?? successText;
          setOutcome({ ok: true, text });
          // The refresh below often unmounts this card (a saved match leaves the "open" filter),
          // so hand the message to <RecentOutcome /> at the top of the page as well.
          try { sessionStorage.setItem(`${OUTCOME_PREFIX}${matchId}`, JSON.stringify({ text, at: Date.now() })); } catch { /* storage blocked */ }
          window.dispatchEvent(new Event(OUTCOME_EVENT));
          router.refresh();
        });
      }}
      data-testid="score-form"
      className="space-y-2 text-sm"
    >
      <input type="hidden" name="matchId" value={matchId} />
      <div className={`grid items-center gap-2.5 ${clocked ? 'grid-cols-[auto_1fr_1fr_auto_2fr]' : 'grid-cols-[auto_1fr_1fr_2fr]'}`}>
        <span />
        <span className={header}>{teamA}</span>
        <span className={header}>{teamB}</span>
        {clocked && <span className={header}>Time up</span>}
        <span />
        {rows.map((n, i) => (
          <Fragment key={n}>
            <span className="text-xs font-bold uppercase tracking-label text-muted">Game {n}</span>
            <input name={`game${n}a`} inputMode="numeric" value={vals[`game${n}a`] ?? ''} onChange={(e) => setVals({ ...vals, [`game${n}a`]: e.target.value })} className={scoreBox} />
            <input name={`game${n}b`} inputMode="numeric" value={vals[`game${n}b`] ?? ''} onChange={(e) => setVals({ ...vals, [`game${n}b`]: e.target.value })} className={scoreBox} />
            {clocked && (
              <input type="checkbox" name={`game${n}x`} checked={vals[`game${n}x`] === 'on'} onChange={(e) => setVals({ ...vals, [`game${n}x`]: e.target.checked ? 'on' : '' })} title="Clock ran out; highest score wins" aria-label={`Game ${n} time up`} className="h-4 w-4 accent-navy" />
            )}
            <span className="text-xs font-semibold text-muted">{hints[i]}</span>
          </Fragment>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={!ready || pending} className="bg-orange px-6 py-2.5 text-xs font-bold uppercase tracking-label text-ink hover:bg-orange-bright disabled:opacity-40">{pending ? 'Saving…' : submitLabel}</button>
        <span className="text-xs font-bold uppercase tracking-label text-muted-strong">{status}</span>
        {outcome && <span data-testid="score-outcome" className={`text-xs font-bold uppercase tracking-label ${outcome.ok ? 'text-orange-ink' : 'text-red-700'}`}>{outcome.text}</span>}
      </div>
    </form>
  );
}
