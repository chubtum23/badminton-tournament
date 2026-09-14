'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Settings } from '@tournament/core';
import { replay, sideOf, validStart, type SheetStart, type Side } from '@/lib/results/scoresheet';

/** Rallies per strip of the sheet; strips stack like the rows of the paper form. */
const COLS = 20;

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
  const strips = Math.max(2, Math.ceil((state.cells.length + 1) / COLS));
  const teamOf = (side: Side) => (side === 'a' ? teamA : teamB);

  const pickServer = (server: number) => {
    const receiverSide = sideOf(server) === 'a' ? 2 : 0;
    // Keep the chosen receiver if they are still on the other side.
    setStart((s) => ({ server, receiver: sideOf(s.receiver) !== sideOf(server) ? s.receiver : receiverSide }));
  };

  const cellBase = 'h-8 w-8 min-w-8 border-hair border-navy/40 text-center font-display text-sm font-black tabular-nums';

  return (
    <div data-testid="score-sheet" className="w-full space-y-4 border-hair border-line bg-white p-4">
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

      <div className="overflow-x-auto">
        <div className="inline-block space-y-2">
          {Array.from({ length: strips }, (_, strip) => (
            <table key={strip} className="border-collapse border-2 border-navy">
              <tbody>
                {names.map((name, row) => {
                  const shaded = sideOf(row) === 'b';
                  return (
                    <tr key={row} className={`${shaded ? 'bg-line-soft' : 'bg-white'} ${row === 2 ? 'border-t-2 border-navy' : ''}`}>
                      <th scope="row" className="max-w-[9rem] truncate border-hair border-navy/40 px-2 text-left text-xs font-bold uppercase tracking-label text-ink">
                        {name}
                      </th>
                      {strip === 0 && (
                        <td className={`${cellBase} border-r-2 border-r-navy text-orange-ink`}>
                          {row === start.server ? 'S' : row === start.receiver ? 'R' : ''}
                        </td>
                      )}
                      {Array.from({ length: COLS }, (_, c) => {
                        const i = strip * COLS + c;
                        const cell = state.cells[i];
                        const next = i === state.cells.length && !state.finished;
                        return (
                          <td
                            key={c}
                            onClick={next ? () => point(sideOf(row)) : undefined}
                            title={next ? `Point to ${teamOf(sideOf(row))}` : undefined}
                            className={`${cellBase} ${next ? 'cursor-pointer bg-orange-wash/60 hover:bg-orange-tint' : ''} ${cell?.interval ? 'border-r-2 border-r-orange' : ''}`}
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
          ))}
        </div>
      </div>

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
