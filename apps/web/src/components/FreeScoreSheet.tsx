'use client';
import { useEffect, useMemo, useState } from 'react';
import { remainingMs } from '@/lib/results/clock';
import { replay } from '@/lib/results/scoresheet';
import {
  blankSheet, decodeFreeGames, decodeHistory, encodeFreeGames, FREE_GAMES_KEY, FREE_HISTORY_KEY, FREE_SHEET_KEY,
  FREE_SHEET_SETTINGS as settings, pastGameOf, type FreeGame, type FreeSheet, type FreeSide, type PastGame,
} from '@/lib/results/freeSheet';
import { ScoreSheet } from './ScoreSheet';
import { ui } from './ui';

/**
 * Score sheets that belong to no match: as many games at once as there are courts to watch, each
 * with its own two sides, sheet and clock. They are kept on this phone only (so a refresh loses
 * nothing) and never touch the tournament. A finished game moves to the history below, where it can
 * be looked back at or deleted.
 *
 * Every game is the club game (to 15 on a 13-minute clock), whatever the event's rules say.
 */
export function FreeScoreSheet({ slug, teams }: {
  slug: string;
  /** Every team, already turned into the side it would bring. */
  teams: FreeSide[];
}) {
  const gamesKey = FREE_GAMES_KEY(slug);
  const historyKey = FREE_HISTORY_KEY(slug);
  const [games, setGames] = useState<FreeGame[]>([]);
  const [history, setHistory] = useState<PastGame[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const legacyKey = FREE_SHEET_KEY(slug);
      setGames(decodeFreeGames(localStorage.getItem(gamesKey), localStorage.getItem(legacyKey), () => crypto.randomUUID()));
      // The one-game sheet has been carried into the list; leaving it would bring it back after a delete.
      localStorage.removeItem(legacyKey);
      setHistory(decodeHistory(localStorage.getItem(historyKey)));
    } catch { /* storage blocked */ }
    setLoaded(true);
  }, [slug, gamesKey, historyKey]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(gamesKey, encodeFreeGames(games)); } catch { /* storage blocked */ }
  }, [gamesKey, games, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch { /* storage blocked */ }
  }, [historyKey, history, loaded]);

  const newGame = () => {
    if (!window.confirm('Are you sure you want to start a new game? It is added alongside the games already going.')) return;
    setGames((g) => [...g, { id: crypto.randomUUID(), sheet: blankSheet() }]);
  };
  const update = (id: string, change: (s: FreeSheet) => FreeSheet) =>
    setGames((g) => g.map((x) => (x.id === id ? { ...x, sheet: change(x.sheet) } : x)));
  const finish = (game: FreeGame) => {
    const past = pastGameOf(game.sheet, game.id, Date.now());
    if (past) setHistory((h) => [past, ...h]);
    setGames((g) => g.filter((x) => x.id !== game.id));
  };
  const remove = (id: string) => setGames((g) => g.filter((x) => x.id !== id));

  return (
    <div className="space-y-6">
      <section className={ui.card}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <div>
            <h2 className={ui.h2}>Score sheets</h2>
            <span className={`${ui.eyebrow} text-muted`}>
              {games.length === 1 ? '1 game going' : `${games.length} games going`} · each to {settings.pointsPerGame}, {settings.timeCapMinutes} min
            </span>
          </div>
          <button type="button" className={ui.primary} data-testid="free-sheet-new" onClick={newGame}>Start a new game</button>
        </div>
        {loaded && games.length === 0 && (
          <p className="px-7 py-6 text-[15px] text-muted">
            No games going. Start one for a tiebreak or anything else — nothing here is saved to the tournament.
          </p>
        )}
      </section>

      {games.map((g, i) => (
        <FreeGameCard
          key={g.id} game={g} number={i + 1} teams={teams} startOpen={games.length === 1 || g.sheet.rallies.length === 0}
          onChange={(change) => update(g.id, change)}
          onFinish={() => finish(g)}
          onDelete={() => remove(g.id)}
        />
      ))}

      {history.length > 0 && (
        <section className={ui.card} data-testid="free-sheet-history">
          <div className={ui.head}>
            <h2 className={ui.eyebrow}>Games played on this phone</h2>
            <span className={`${ui.eyebrow} text-muted`}>{history.length}</span>
          </div>
          <ul>
            {history.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 border-b-hair border-line-soft px-7 py-4 last:border-b-0">
                <span className="min-w-0">
                  <span className="block font-display text-base font-extrabold uppercase">
                    {g.a} <span className="tabular-nums">{g.scoreA}–{g.scoreB}</span> {g.b}
                  </span>
                  <span className="block text-sm text-muted">
                    {g.winner ? `${g.winner} won${g.byTime ? ' on time' : ''}` : 'Unfinished'}
                    {g.pairA || g.pairB ? ` · ${g.pairA || g.a} v ${g.pairB || g.b}` : ''}
                    {g.at && !Number.isNaN(Date.parse(g.at)) ? ` · ${new Date(g.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                  </span>
                </span>
                <button type="button" className={ui.tiny} data-testid="free-sheet-delete"
                  onClick={() => { if (window.confirm(`Delete ${g.a} v ${g.b} (${g.scoreA}–${g.scoreB})?`)) setHistory((h) => h.filter((x) => x.id !== g.id)); }}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * One game: its sides, clock and sheet, folded down to a single line (who, score, clock) when the
 * organiser is watching another court. The clock starts with the first rally or by hand; when it
 * runs out the side ahead wins, and a level score plays one more rally.
 */
function FreeGameCard({ game, number, teams, startOpen, onChange, onFinish, onDelete }: {
  game: FreeGame;
  number: number;
  teams: FreeSide[];
  startOpen: boolean;
  onChange: (change: (s: FreeSheet) => FreeSheet) => void;
  onFinish: () => void;
  onDelete: () => void;
}) {
  const { sheet } = game;
  const [open, setOpen] = useState(startOpen);
  // The sides fold away once scoring starts, leaving one line naming who is on court.
  const [sidesOpen, setSidesOpen] = useState(sheet.rallies.length === 0);

  const setSide = (which: 'a' | 'b', side: FreeSide) => onChange((s) => ({ ...s, [which]: side }));
  const pickTeam = (which: 'a' | 'b', teamId: string) =>
    setSide(which, { ...(teams.find((t) => t.teamId === teamId) ?? { teamId: '', label: which === 'a' ? 'Side 1' : 'Side 2', players: ['', ''] }) });
  const setPlayer = (which: 'a' | 'b', i: 0 | 1, name: string) => {
    const side = sheet[which];
    setSide(which, { ...side, players: i === 0 ? [name, side.players[1]] : [side.players[0], name] });
  };

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
  const over = tally.finished || decidedByTime;

  const setClock = (next: FreeSheet['clock']) => onChange((s) => ({ ...s, clock: next }));
  const startClock = () => setClock({ startedAt: new Date().toISOString(), pausedAt: null, pausedMs: 0 });
  const pauseClock = () => setClock({ ...clock, pausedAt: new Date().toISOString() });
  const resumeClock = () => setClock({ ...clock, pausedAt: null, pausedMs: clock.pausedMs + (Date.now() - Date.parse(clock.pausedAt!)) });
  const secs = Math.ceil((left ?? (settings.timeCapMinutes ?? 0) * 60_000) / 1000);
  const shown = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const clockText = timeUp ? 'TIME' : clock.pausedAt ? `${shown} paused` : shown;
  const clockTone = timeUp ? 'bg-red-600 text-white' : clock.pausedAt ? 'bg-orange text-ink' : 'bg-navy text-bone';

  const pairOf = (side: FreeSide) => side.players.filter((p) => p.trim()).join(' & ');
  const nameOr = (name: string, fallback: string) => name.trim() || fallback;
  const names = [
    nameOr(sheet.a.players[0], `${sheet.a.label} player 1`), nameOr(sheet.a.players[1], `${sheet.a.label} player 2`),
    nameOr(sheet.b.players[0], `${sheet.b.label} player 1`), nameOr(sheet.b.players[1], `${sheet.b.label} player 2`),
  ] as const;
  const begun = sheet.rallies.length > 0;

  return (
    <section className={ui.card} data-testid="free-game">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={`${ui.head} cursor-pointer list-none`} data-testid="free-game-summary">
          <span className="min-w-0">
            <span className={`${ui.eyebrow} block text-muted`}>Game {number}</span>
            <span className="block font-display text-lg font-extrabold uppercase">{sheet.a.label} v {sheet.b.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="font-display text-2xl font-black tabular-nums">{tally.scoreA}–{tally.scoreB}</span>
            <span className={`px-2 py-1 font-display text-xs font-black tabular-nums tracking-label ${clockTone}`}>{clockText}</span>
            <span aria-hidden className="text-sm font-bold text-navy">{open ? '▲' : '▼'}</span>
          </span>
        </summary>

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
            <span className={`px-3 py-1.5 font-display text-lg font-black tabular-nums tracking-label ${clockTone}`}>{clockText}</span>
            {clock.startedAt === null
              ? <button type="button" className={ui.tiny} onClick={startClock}>Start clock</button>
              : !timeUp && <button type="button" className={ui.tiny} onClick={clock.pausedAt ? resumeClock : pauseClock}>{clock.pausedAt ? 'Resume' : 'Pause'}</button>}
          </div>
          {timeUp && !tally.finished && (
            <p className={ui.warn} aria-live="polite">
              {decidedByTime
                ? <><b>Time</b> — {tally.scoreA > tally.scoreB ? sheet.a.label : sheet.b.label} win {Math.max(tally.scoreA, tally.scoreB)}–{Math.min(tally.scoreA, tally.scoreB)}.</>
                : <><b>Time</b> — level at {tally.scoreA}–{tally.scoreB}. The next rally wins it.</>}
            </p>
          )}
          <ScoreSheet
            settings={settings} teamA={sheet.a.label} teamB={sheet.b.label} names={names}
            start={sheet.start} rallies={sheet.rallies}
            onChange={(next) => {
              // A rally after the time has decided it is refused; an undo or a reset still goes through.
              if (decidedByTime && next.rallies.length > sheet.rallies.length) return;
              if (sheet.rallies.length === 0 && next.rallies.length > 0) setSidesOpen(false);
              onChange((s) => ({
                ...s, start: next.start, rallies: next.rallies,
                clock: s.clock.startedAt === null && next.rallies.length > 0 ? { startedAt: new Date().toISOString(), pausedAt: null, pausedMs: 0 } : s.clock,
              }));
            }}
            doneNote=" Press Finish game to move it to the games played below."
          />
          <div className="flex flex-wrap items-center justify-end gap-2 border-t-hair border-line pt-4">
            <button type="button" className={`${over ? ui.solid : ui.tiny} disabled:opacity-40`} data-testid="free-game-finish" disabled={!begun}
              onClick={() => { if (over || window.confirm('This game is not finished. Move it to the games played anyway?')) onFinish(); }}>
              Finish game
            </button>
            <button type="button" className={ui.tiny} data-testid="free-game-delete"
              onClick={() => { if (!begun || window.confirm(`Delete game ${number} (${sheet.a.label} v ${sheet.b.label}, ${tally.scoreA}–${tally.scoreB})? It is not kept anywhere.`)) onDelete(); }}>
              Delete game
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
