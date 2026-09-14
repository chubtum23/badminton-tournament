'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Settings } from '@tournament/core';
import { replay, sideOf, validStart, type SheetStart, type Side } from '@/lib/results/scoresheet';

/** Fixed widths of the name and S/R columns, and the narrowest a rally box may get (px). */
const NAME_W = 144;
const NAME_W_PHONE = 76;
const MARK_W = 36;
const MIN_CELL = 32;
const MIN_CELL_PHONE = 26;
const MARK_W_PHONE = 26;

/** Where a sheet in progress is kept, so a refresh or a dropped phone does not lose the tally. */
export const sheetStorageKey = (matchId: string, gameNo: number) => `scoresheet:${matchId}:${gameNo}`;

interface Saved { start: SheetStart; rallies: Side[] }

const load = (key: string): Saved | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    return validStart(v.start) && Array.isArray(v.rallies) && v.rallies.every((r) => r === 'a' || r === 'b') ? v : null;
  } catch { return null; }
};

/**
 * A tap-to-score version of the umpire's paper score sheet (the BWF layout): one row per player,
 * one column per rally, the running score written against whoever serves next. The organiser taps
 * the side that won each rally; the sheet works out the service order and courts, and hands the
 * running score to the Save form so there is nothing to type at the end.
 */
export function ScoreSheet({ matchId, gameNo, settings, teamA, teamB, names, onScore }: {
  matchId: string;
  gameNo: number;
  settings: Settings;
  teamA: string;
  teamB: string;
  /** Four row labels: side A's two players, then side B's. */
  names: readonly [string, string, string, string];
  onScore: (a: number, b: number) => void;
}) {
  const key = sheetStorageKey(matchId, gameNo);
  const [start, setStart] = useState<SheetStart>({ server: 0, receiver: 2 });
  const [rallies, setRallies] = useState<Side[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = load(key);
    if (saved) { setStart(saved.start); setRallies(saved.rallies); }
    setLoaded(true);
  }, [key]);

  const state = useMemo(() => replay(settings, start, rallies), [settings, start, rallies]);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (rallies.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ start, rallies }));
    } catch { /* storage blocked */ }
    if (rallies.length > 0) onScore(state.scoreA, state.scoreB);
    // onScore is a fresh closure each render; the tally is what should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, key, start, rallies, state.scoreA, state.scoreB]);

  const point = (side: Side) => { if (!state.finished) setRallies((r) => [...r, side]); };
  const begun = rallies.length > 0;
  // The sheet has a box for every rally the longest possible game could need (29 for a 15-point
  // game), growing if win-by-two with no cap runs past that. It is always one row, like the paper
  // sheet: the boxes stretch to fill a wide screen and scroll sideways on a narrow one.
  const total = Math.max(2 * (settings.maxPoints ?? settings.pointsPerGame) - 1, state.cells.length + (state.finished ? 0 : 1));
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const phone = width > 0 && width < 520;
  const nameW = phone ? NAME_W_PHONE : NAME_W;
  const markW = phone ? MARK_W_PHONE : MARK_W;
  const minWidth = nameW + markW + total * (phone ? MIN_CELL_PHONE : MIN_CELL);

  // Keep the box being played into in view: scroll along as the rallies pass the right edge, and
  // back if an undo takes it under the pinned name column.
  const focus = Math.min(state.cells.length, total - 1);
  useEffect(() => {
    const el = scroller.current;
    const td = el?.querySelector<HTMLElement>(`[data-col="${focus}"]`);
    if (!el || !td) return;
    const w = td.offsetWidth;
    const pinned = nameW + markW;
    if (td.offsetLeft + 3 * w > el.scrollLeft + el.clientWidth) el.scrollLeft = td.offsetLeft + 3 * w - el.clientWidth;
    else if (td.offsetLeft - w < el.scrollLeft + pinned) el.scrollLeft = Math.max(0, td.offsetLeft - w - pinned);
    measure();
    // measure only reads the scroller, so it need not be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, width, nameW, markW]);

  // Which ends of the rally row are scrolled out of sight, for the fades and the swipe hint.
  const [hidden, setHidden] = useState({ left: false, right: false });
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setHidden((h) => (h.left === left && h.right === right ? h : { left, right }));
  };
  const teamOf = (side: Side) => (side === 'a' ? teamA : teamB);

  const pickServer = (server: number) => {
    const receiverSide = sideOf(server) === 'a' ? 2 : 0;
    // Keep the chosen receiver if they are still on the other side.
    setStart((s) => ({ server, receiver: sideOf(s.receiver) !== sideOf(server) ? s.receiver : receiverSide }));
  };

  const cellBase = 'h-9 p-0 text-center font-display text-sm font-black tabular-nums';

  return (
    // min-w-0 lets this flex item shrink to the screen, so the rally row scrolls inside it instead of
    // stretching the page past the edge of a phone.
    <div data-testid="score-sheet" className="w-full min-w-0 max-w-full space-y-4 border-hair border-line bg-white p-4 max-sm:p-2.5">
      {!begun && (
        <div className="flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-label text-muted-strong">
          <label className="flex items-center gap-2">
            Serving first
            <select value={start.server} onChange={(e) => pickServer(Number(e.target.value))} className="border-hair border-line bg-white px-2 py-1.5 text-sm normal-case text-ink">
              {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Receiving
            <select value={start.receiver} onChange={(e) => setStart((s) => ({ ...s, receiver: Number(e.target.value) }))} className="border-hair border-line bg-white px-2 py-1.5 text-sm normal-case text-ink">
              {names.map((n, i) => (sideOf(i) !== sideOf(start.server) ? <option key={i} value={i}>{n}</option> : null))}
            </select>
          </label>
        </div>
      )}

      <div className="relative">
      {/* Fades over whichever end is scrolled out of sight; the left one starts past the pinned columns. */}
      {hidden.left && (
        <div aria-hidden className="pointer-events-none absolute inset-y-[2px] z-20 w-6 bg-gradient-to-r from-navy/25 to-transparent" style={{ left: nameW + markW + 2 }} />
      )}
      {hidden.right && (
        <div aria-hidden className="pointer-events-none absolute inset-y-[2px] right-[2px] z-20 flex w-10 items-center justify-end bg-gradient-to-l from-navy/30 to-transparent pr-0.5">
          <svg viewBox="0 0 16 16" width="18" height="18" className="border-hair border-navy bg-white p-0.5 text-navy"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" /></svg>
        </div>
      )}
      <div ref={scroller} onScroll={measure} className="overflow-x-auto border-2 border-navy">
        <table className="w-full table-fixed border-separate border-spacing-0" style={{ minWidth }}>
          <colgroup>
            <col style={{ width: nameW }} />
            <col style={{ width: markW }} />
            {Array.from({ length: total }, (_, c) => <col key={c} />)}
          </colgroup>
          <tbody>
            {names.map((name, row) => {
              const bg = sideOf(row) === 'b' ? 'bg-line-soft' : 'bg-white';
              // A heavier line between the two sides; none under the last row, where the frame is.
              const under = row === 1 ? 'border-b-2 border-b-navy' : row === 3 ? '' : 'border-b-hair border-b-navy/30';
              return (
                <tr key={row}>
                  {/* The names and S/R stay pinned while the rallies scroll under them. */}
                  <th scope="row" className={`${bg} ${under} sticky left-0 z-10 truncate border-r-hair border-r-navy/30 px-2 text-left text-xs font-bold uppercase tracking-label text-ink`}>
                    {name}
                  </th>
                  <td className={`${bg} ${under} ${cellBase} sticky z-10 border-r-2 border-r-navy text-orange-ink`} style={{ left: nameW }}>
                    {row === start.server ? 'S' : row === start.receiver ? 'R' : ''}
                  </td>
                  {Array.from({ length: total }, (_, i) => {
                    const cell = state.cells[i];
                    const next = i === state.cells.length && !state.finished;
                    return (
                      <td
                        key={i}
                        data-col={row === 0 ? i : undefined}
                        onClick={next ? () => point(sideOf(row)) : undefined}
                        title={next ? `Point to ${teamOf(sideOf(row))}` : undefined}
                        className={`${cellBase} ${under} ${next ? 'cursor-pointer bg-orange-wash hover:bg-orange-tint' : bg} ${cell?.interval ? 'border-r-2 border-r-orange' : i === total - 1 ? '' : 'border-r-hair border-r-navy/30'}`}
                      >
                        {cell?.row === row ? cell.score : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
      {(hidden.left || hidden.right) && (
        <p data-testid="score-sheet-swipe" className="-mt-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-label text-muted">
          <span aria-hidden>{hidden.left ? '←' : ''}</span>
          Swipe the sheet to see {hidden.right && hidden.left ? 'more' : hidden.right ? 'more rallies' : 'earlier rallies'}
          <span aria-hidden>{hidden.right ? '→' : ''}</span>
        </p>
      )}

      <p className="text-sm text-muted" aria-live="polite">
        {state.finished
          ? <><b className="text-orange-ink">Game over</b> — {teamOf(state.winner!)} win {Math.max(state.scoreA, state.scoreB)}–{Math.min(state.scoreA, state.scoreB)}. The score is filled in below; hit Save.</>
          : <>
              <b className="font-display text-base font-black tabular-nums text-ink">{state.scoreA}–{state.scoreB}</b>
              {' · '}{names[state.server]} to serve from the {state.court} court to {names[state.receiver]}
            </>}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {(['a', 'b'] as const).map((side) => (
          <button
            key={side} type="button" disabled={state.finished} onClick={() => point(side)}
            className="min-w-[8rem] flex-1 bg-orange px-5 py-3 text-sm font-bold uppercase tracking-label text-ink hover:bg-orange-bright disabled:opacity-40"
          >
            + Point {teamOf(side)}
          </button>
        ))}
        <button type="button" disabled={!begun} onClick={() => setRallies((r) => r.slice(0, -1))} className="border-hair border-navy px-4 py-3 text-xs font-bold uppercase tracking-label text-navy hover:bg-line-soft disabled:opacity-40">
          Undo
        </button>
        <button
          type="button" disabled={!begun}
          onClick={() => { if (window.confirm('Wipe this score sheet and start again?')) setRallies([]); }}
          className="border-hair border-line-strong px-4 py-3 text-xs font-bold uppercase tracking-label text-muted-strong hover:border-navy hover:text-navy disabled:opacity-40"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
