'use client';
import { useEffect, useMemo, useState } from 'react';
import { remainingMs } from '@/lib/results/clock';
import { replay } from '@/lib/results/scoresheet';
import {
  blankSheet, decodeFreeSheet, encodeFreeSheet, FREE_SHEET_KEY, FREE_SHEET_SETTINGS as settings, type FreeSheet, type FreeSide,
} from '@/lib/results/freeSheet';
import { ScoreSheet } from './ScoreSheet';
import { ui } from './ui';

/**
 * A score sheet that belongs to no match: pick or type the two sides and score one game. It is
 * kept on this phone only (so a refresh loses nothing) and never touches the tournament.
 *
 * It always plays the club game (to 15 on a 13-minute clock), whatever the event's rules say. The
 * clock starts with the first rally or by hand; when it runs out the side ahead wins, and a level
 * score plays one more rally.
 */
export function FreeScoreSheet({ slug, teams }: {
  slug: string;
  /** Every team, already turned into the side it would bring. */
  teams: FreeSide[];
}) {
  const key = FREE_SHEET_KEY(slug);
  const [sheet, setSheet] = useState<FreeSheet>(blankSheet);
  const [loaded, setLoaded] = useState(false);

  // The sides fold away once scoring starts, leaving one line naming who is on court.
  const [sidesOpen, setSidesOpen] = useState(true);

  useEffect(() => {
    try {
      const stored = decodeFreeSheet(localStorage.getItem(key));
      setSheet(stored);
      setSidesOpen(stored.rallies.length === 0);
    } catch { /* storage blocked */ }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, encodeFreeSheet(sheet)); } catch { /* storage blocked */ }
  }, [key, sheet, loaded]);

  const setSide = (which: 'a' | 'b', side: FreeSide) => setSheet((s) => ({ ...s, [which]: side }));
  const pickTeam = (which: 'a' | 'b', teamId: string) =>
    setSide(which, { ...(teams.find((t) => t.teamId === teamId) ?? { teamId: '', label: which === 'a' ? 'Side 1' : 'Side 2', players: ['', ''] }) });
  const setPlayer = (which: 'a' | 'b', i: 0 | 1, name: string) => {
    const side = sheet[which];
    setSide(which, { ...side, players: i === 0 ? [name, side.players[1]] : [side.players[0], name] });
  };

  const begun = sheet.rallies.length > 0;
  const { clock } = sheet;
  const running = clock.startedAt !== null && clock.pausedAt === null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, clock]);
  const left = remainingMs({ ...clock, capMinutes: settings.timeCapMinutes }, now);
  const timeUp = left === 0;
  const tally = useMemo(() => replay(settings, sheet.start, sheet.rallies), [sheet.start, sheet.rallies]);
  // At time the side ahead has won; only a level score carries on, for one deciding rally.
  const decidedByTime = timeUp && !tally.finished && tally.scoreA !== tally.scoreB;

  const setClock = (next: FreeSheet['clock']) => setSheet((s) => ({ ...s, clock: next }));
  const startClock = () => setClock({ startedAt: new Date().toISOString(), pausedAt: null, pausedMs: 0 });
  const pauseClock = () => setClock({ ...clock, pausedAt: new Date().toISOString() });
  const resumeClock = () => setClock({ ...clock, pausedAt: null, pausedMs: clock.pausedMs + (Date.now() - Date.parse(clock.pausedAt!)) });
  const secs = Math.ceil((left ?? (settings.timeCapMinutes ?? 0) * 60_000) / 1000);
  const shown = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const newGame = () => {
    if (begun && !window.confirm('Clear the sides and the score and start a new game?')) return;
    setSheet(blankSheet());
    setSidesOpen(true);
  };
  const pairOf = (side: FreeSide) => side.players.filter((p) => p.trim()).join(' & ');
  const nameOr = (name: string, fallback: string) => name.trim() || fallback;
  const names = [
    nameOr(sheet.a.players[0], `${sheet.a.label} player 1`), nameOr(sheet.a.players[1], `${sheet.a.label} player 2`),
    nameOr(sheet.b.players[0], `${sheet.b.label} player 1`), nameOr(sheet.b.players[1], `${sheet.b.label} player 2`),
  ] as const;

  return (
    <div className="space-y-6">
      <section className={ui.card}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <div>
            <h2 className={ui.h2}>{sheet.a.label} v {sheet.b.label}</h2>
            <span className={`${ui.eyebrow} text-muted`}>One game to {settings.pointsPerGame} · {settings.timeCapMinutes} min</span>
          </div>
          <button type="button" className={ui.primary} data-testid="free-sheet-new" onClick={newGame}>Start a new game</button>
        </div>
        <details open={sidesOpen} onToggle={(e) => setSidesOpen(e.currentTarget.open)} className="border-b-2 border-navy" data-testid="free-sheet-sides">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-7 py-4">
            <span className="min-w-0 text-[15px] text-ink">
              <b className={`${ui.eyebrow} mr-2 text-muted`}>Sides</b>
              {sidesOpen ? 'Pick the two teams' : `${pairOf(sheet.a) || sheet.a.label} v ${pairOf(sheet.b) || sheet.b.label}`}
            </span>
            <span aria-hidden className="text-sm font-bold text-navy">{sidesOpen ? '▲' : 'Change ▼'}</span>
          </summary>
          <div className="grid gap-6 px-7 pb-7 sm:grid-cols-2">
            {(['a', 'b'] as const).map((which, n) => (
              <fieldset key={which} className="space-y-3" data-testid={`free-sheet-side-${which}`}>
                <label className={ui.label}>
                  Side {n + 1}
                  <select className={ui.field} value={sheet[which].teamId} onChange={(e) => pickTeam(which, e.target.value)}>
                    <option value="">Select team</option>
                    {teams.map((t) => <option key={t.teamId} value={t.teamId}>{t.label}</option>)}
                  </select>
                </label>
                {([0, 1] as const).map((i) => (
                  <label key={i} className={ui.label}>
                    Player {i + 1}
                    <input className={ui.field} value={sheet[which].players[i]} maxLength={60}
                      onChange={(e) => setPlayer(which, i, e.target.value)} />
                  </label>
                ))}
              </fieldset>
            ))}
            <p className={`${ui.help} mt-0 sm:col-span-2`}>
              A team fills in its two men. Nothing here is saved to the tournament: when a tiebreak is done,
              put the winner first in the pool on Standings.
            </p>
          </div>
        </details>
        <div className={`${ui.body} space-y-6`}>
          <div className="flex flex-wrap items-center gap-3" data-testid="free-sheet-clock">
            <span className={`px-3 py-1.5 font-display text-lg font-black tabular-nums tracking-label ${timeUp ? 'bg-red-600 text-white' : clock.pausedAt ? 'bg-orange text-ink' : 'bg-navy text-bone'}`}>
              {timeUp ? 'TIME' : clock.pausedAt ? `${shown} paused` : shown}
            </span>
            {clock.startedAt === null
              ? <button type="button" className={ui.tiny} onClick={startClock}>Start clock</button>
              : !timeUp && <button type="button" className={ui.tiny} onClick={clock.pausedAt ? resumeClock : pauseClock}>{clock.pausedAt ? 'Resume' : 'Pause'}</button>}
          </div>
          {timeUp && !tally.finished && (
            <p className={ui.warn} aria-live="polite">
              {decidedByTime
                ? <><b>Time</b> — {tally.scoreA > tally.scoreB ? sheet.a.label : sheet.b.label} win {Math.max(tally.scoreA, tally.scoreB)}–{Math.min(tally.scoreA, tally.scoreB)}. Nothing is saved; sort the pool on Standings if this settled a tie.</>
                : <><b>Time</b> — level at {tally.scoreA}–{tally.scoreB}. The next rally wins it.</>}
            </p>
          )}
          {loaded && (
            <ScoreSheet
              settings={settings} teamA={sheet.a.label} teamB={sheet.b.label} names={names}
              start={sheet.start} rallies={sheet.rallies}
              onChange={(next) => {
                // A rally after the time has decided it is refused; an undo or a reset still goes through.
                if (decidedByTime && next.rallies.length > sheet.rallies.length) return;
                if (sheet.rallies.length === 0 && next.rallies.length > 0) setSidesOpen(false);
                setSheet((s) => ({
                  ...s, start: next.start, rallies: next.rallies,
                  clock: s.clock.startedAt === null && next.rallies.length > 0 ? { startedAt: new Date().toISOString(), pausedAt: null, pausedMs: 0 } : s.clock,
                }));
              }}
              doneNote=" Nothing is saved; sort the pool on Standings if this settled a tie."
            />
          )}
        </div>
      </section>
    </div>
  );
}
