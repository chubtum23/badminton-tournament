'use client';
import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { gamesNeeded, matchResult, validateGame, type Settings, type Game } from '@tournament/core';
import type { ActionResult } from '@/actions/errors';
import { parseGameRows } from '@/lib/submissions/parseGames';
import { OUTCOME_EVENT, OUTCOME_PREFIX } from './RecentOutcome';
import { ui } from './ui';

/** Scores are the numbers on this screen that matter, so they are set in the display face. */
const scoreBox = 'w-16 border-hair border-line bg-white px-2 py-1.5 text-center font-display text-lg font-black tabular-nums text-ink outline-none focus:border-navy';
const header = 'truncate text-xs font-bold uppercase tracking-label text-muted';

/**
 * The row grid. On a phone the hint drops to a line of its own under its row (it spans the grid),
 * because "Mixed doubles #1" plus two score boxes already fill 375px. From `sm` it is a column.
 * Literal strings so Tailwind can see every class.
 */
const GRID = {
  plain: 'grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_minmax(4rem,6rem)] sm:grid-cols-[auto_minmax(4rem,6rem)_minmax(4rem,6rem)_minmax(0,1fr)]',
  clocked: 'grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_minmax(4rem,6rem)_auto] sm:grid-cols-[auto_minmax(4rem,6rem)_minmax(4rem,6rem)_auto_minmax(0,1fr)]',
};

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
 *
 * Rows are read with the same strict rules the server applies (parseGameRows), so a half-filled
 * row is named here before anything is sent rather than being posted as a 0.
 */
export function SubmitScoresForm({ matchId, settings, existing, teamA, teamB, action, submitLabel, confirmMessage, successText = 'Saved', gameLabels }: {
  matchId: string; settings: Settings; existing: Game[]; teamA: string; teamB: string;
  action: (formData: FormData) => Promise<ActionResult<unknown>>; submitLabel: string;
  /** When set, the submit is gated behind a window.confirm() with this text. */
  confirmMessage?: string;
  /** Shown on success unless the action returns its own `text`. */
  successText?: string;
  /** The tournament's names for its games ("Mixed doubles #1"…); "Game n" past the end. */
  gameLabels?: readonly string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = Array.from({ length: settings.gamesPerMatch }, (_, i) => i + 1);
  const label = (n: number) => gameLabels?.[n - 1] ?? `Game ${n}`;
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
  const read = (f: string) => vals[f] ?? '';

  const parsed = parseGameRows(read, settings.gamesPerMatch, label);
  // Each row's own verdict, worked out row by row so one bad row does not blank the others.
  const hints = rows.map((n) => {
    const a = read(`game${n}a`).trim(), b = read(`game${n}b`).trim();
    if (a === '' && b === '') return '';
    if (a === '' || b === '') return 'Enter both scores';
    const v = validateGame(settings, Number(a), Number(b), read(`game${n}x`) !== '');
    return v.ok ? (v.winner === 'a' ? `${teamA} won` : `${teamB} won`) : v.reason;
  });
  const result = parsed.ok ? matchResult(settings, parsed.games) : null;
  const ready = result !== null && result.ok && result.complete;
  const status = !parsed.ok
    ? parsed.message
    : !result!.ok
      ? result!.reason
      : result!.complete
        ? (result!.winner === 'a' ? `${teamA} wins the match` : `${teamB} wins the match`)
        // Every game is played in the club format, so "need 2" would invite stopping at 2-0.
        : settings.playAllGames
          ? `Enter all ${settings.gamesPerMatch} games · ${parsed.games.length} of ${settings.gamesPerMatch} so far`
          : `${result!.gamesA}-${result!.gamesB} in games · need ${gamesNeeded(settings)}`;

  const set = (field: string, value: string) => setVals({ ...vals, [field]: value });

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
      autoComplete="off"
      className="space-y-2 text-sm"
    >
      <input type="hidden" name="matchId" value={matchId} />
      <div className={`grid items-center gap-x-2.5 gap-y-2 ${clocked ? GRID.clocked : GRID.plain}`}>
        <span />
        <span className={header} title={teamA}>{teamA}</span>
        <span className={header} title={teamB}>{teamB}</span>
        {clocked && <span className={header}>Time up</span>}
        <span className="hidden sm:block" />
        {rows.map((n, i) => (
          <Fragment key={n}>
            <span className="text-xs font-bold uppercase tracking-label text-muted">{label(n)}</span>
            <input name={`game${n}a`} inputMode="numeric" autoComplete="off" aria-label={`${label(n)}: ${teamA} points`} value={read(`game${n}a`)} onChange={(e) => set(`game${n}a`, e.target.value)} className={scoreBox} />
            <input name={`game${n}b`} inputMode="numeric" autoComplete="off" aria-label={`${label(n)}: ${teamB} points`} value={read(`game${n}b`)} onChange={(e) => set(`game${n}b`, e.target.value)} className={scoreBox} />
            {clocked && (
              // The label is the tap target: a bare 16px box is too small to hit on a phone.
              <label title="Clock ran out; highest score wins" className="flex h-11 w-11 cursor-pointer items-center justify-center">
                <input type="checkbox" name={`game${n}x`} checked={read(`game${n}x`) === 'on'} onChange={(e) => set(`game${n}x`, e.target.checked ? 'on' : '')} aria-label={`${label(n)}: time up`} className={ui.checkbox} />
              </label>
            )}
            {/* Empty hints collapse on a phone, where they would otherwise leave a gap row; from
                `sm` an empty one must stay, or the next row's cells would slide into its column. */}
            <span className="col-span-full -mt-1 text-xs font-semibold text-muted empty:hidden sm:col-span-1 sm:mt-0 sm:empty:block">{hints[i]}</span>
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
