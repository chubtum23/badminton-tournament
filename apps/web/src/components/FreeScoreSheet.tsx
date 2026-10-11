'use client';
import { useEffect, useMemo, useState } from 'react';
import { replay, type Side } from '@/lib/results/scoresheet';
import {
  blankSheet, decodeFreeGames, decodeHistory, encodeFreeGames, FREE_GAMES_KEY, FREE_HISTORY_KEY, FREE_SHEET_KEY,
  freeSettings, MAX_FREE_TARGET, pastGameOf, validTarget, type FreeGame, type FreeSheet, type FreeSide, type PastGame,
} from '@/lib/results/freeSheet';
import { ScoreSheet } from './ScoreSheet';
import { ui } from './ui';

/**
 * Score sheets that belong to no match: as many games at once as there are courts to watch, each
 * with its own two sides and sheet. They are kept on this phone only (so a refresh loses
 * nothing) and never touch the tournament. A finished game moves to the history below, where it can
 * be looked back at or deleted.
 *
 * Every game is one game with no clock, whatever the event's rules say, played to the number of
 * points set on it (15 to start with).
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
  const finish = (game: FreeGame, award?: Side) => {
    const past = pastGameOf(game.sheet, game.id, Date.now(), award);
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
              {games.length === 1 ? '1 game going' : `${games.length} games going`} · no clock
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
          onFinish={(award) => finish(g, award)}
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
                    {g.winner ? (g.awarded ? `Awarded to ${g.winner}` : `${g.winner} won${g.byTime ? ' on time' : ''}`) : 'Unfinished'}
                    {g.target ? ` · to ${g.target}` : ''}
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
 * One game: its sides, target and sheet, folded down to a single line (who and the score) when the
 * organiser is watching another court. Either side can be any team or a name typed in, and the
 * game can be awarded to either side whatever the score.
 */
function FreeGameCard({ game, number, teams, startOpen, onChange, onFinish, onDelete }: {
  game: FreeGame;
  number: number;
  teams: FreeSide[];
  startOpen: boolean;
  onChange: (change: (s: FreeSheet) => FreeSheet) => void;
  /** Moves the game to the history; with a side, the game is awarded to it. */
  onFinish: (award?: Side) => void;
  onDelete: () => void;
}) {
  const { sheet } = game;
  const [open, setOpen] = useState(startOpen);
  // The sides fold away once scoring starts, leaving one line naming who is on court.
  const [sidesOpen, setSidesOpen] = useState(sheet.rallies.length === 0);
  // The box is typed into freely; only a whole number from 1 up becomes the target.
  const [targetText, setTargetText] = useState(String(sheet.target));

  const fallback = (which: Side) => (which === 'a' ? 'Side 1' : 'Side 2');
  const labelOf = (which: Side) => sheet[which].label.trim() || fallback(which);
  const teamA = labelOf('a'), teamB = labelOf('b');
  const setSide = (which: Side, side: FreeSide) => onChange((s) => ({ ...s, [which]: side }));
  const pickTeam = (which: Side, teamId: string) =>
    setSide(which, { ...(teams.find((t) => t.teamId === teamId) ?? { teamId: '', label: fallback(which), players: ['', ''] }) });
  const setPlayer = (which: Side, i: 0 | 1, name: string) => {
    const side = sheet[which];
    setSide(which, { ...side, players: i === 0 ? [name, side.players[1]] : [side.players[0], name] });
  };
  const setTarget = (text: string) => {
    setTargetText(text);
    const n = Number(text);
    if (validTarget(n)) onChange((s) => ({ ...s, target: n }));
  };

  const gameSettings = useMemo(() => freeSettings(sheet.target), [sheet.target]);
  const tally = useMemo(() => replay(gameSettings, sheet.start, sheet.rallies), [gameSettings, sheet.start, sheet.rallies]);
  const over = tally.finished;

  const pairOf = (side: FreeSide) => side.players.filter((p) => p.trim()).join(' & ');
  const nameOr = (name: string, fb: string) => name.trim() || fb;
  const names = [
    nameOr(sheet.a.players[0], `${teamA} player 1`), nameOr(sheet.a.players[1], `${teamA} player 2`),
    nameOr(sheet.b.players[0], `${teamB} player 1`), nameOr(sheet.b.players[1], `${teamB} player 2`),
  ] as const;
  const begun = sheet.rallies.length > 0;
  const award = (which: Side) => {
    if (window.confirm(`Award game ${number} to ${labelOf(which)}${begun ? ` (score ${tally.scoreA}–${tally.scoreB})` : ''}? It moves to the games played below.`)) onFinish(which);
  };

  return (
    <section className={ui.card} data-testid="free-game">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={`${ui.head} cursor-pointer list-none`} data-testid="free-game-summary">
          <span className="min-w-0">
            <span className={`${ui.eyebrow} block text-muted`}>Game {number}</span>
            <span className="block font-display text-lg font-extrabold uppercase">{teamA} v {teamB}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="font-display text-2xl font-black tabular-nums">{tally.scoreA}–{tally.scoreB}</span>
            <span aria-hidden className="text-sm font-bold text-navy">{open ? '▲' : '▼'}</span>
          </span>
        </summary>

        <details open={sidesOpen} onToggle={(e) => setSidesOpen(e.currentTarget.open)} className="border-b-2 border-navy" data-testid="free-sheet-sides">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-7 py-4">
            <span className="min-w-0 text-[15px] text-ink">
              <b className={`${ui.eyebrow} mr-2 text-muted`}>Sides</b>
              {sidesOpen ? 'Pick the two teams' : `${pairOf(sheet.a) || teamA} v ${pairOf(sheet.b) || teamB}`}
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
                <label className={ui.label}>
                  Team name
                  <input className={ui.field} value={sheet[which].label} maxLength={60} placeholder={fallback(which)}
                    data-testid={`free-sheet-name-${which}`} onChange={(e) => setSide(which, { ...sheet[which], label: e.target.value })} />
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
              A team fills in its two men; type any other name to play a side that is not on the list.
              Nothing here is saved to the tournament: when a tiebreak is done, put the winner first in
              the pool on Standings.
            </p>
          </div>
        </details>

        <div className={`${ui.body} space-y-6`}>
          <label className={`${ui.label} max-w-[12rem]`}>
            Play to
            <input className={ui.field} type="number" inputMode="numeric" min={1} max={MAX_FREE_TARGET} step={1}
              value={targetText} data-testid="free-sheet-target"
              onChange={(e) => setTarget(e.target.value)} onBlur={() => setTargetText(String(sheet.target))} />
            <span className={ui.help}>Any number of points from 1 to {MAX_FREE_TARGET}; first to it wins.</span>
          </label>
          <ScoreSheet
            settings={gameSettings} teamA={teamA} teamB={teamB} names={names}
            start={sheet.start} rallies={sheet.rallies}
            onChange={(next) => {
              if (sheet.rallies.length === 0 && next.rallies.length > 0) setSidesOpen(false);
              onChange((s) => ({ ...s, start: next.start, rallies: next.rallies }));
            }}
            doneNote=" Press Finish game to move it to the games played below."
          />
          <div className="flex flex-wrap items-center justify-end gap-2 border-t-hair border-line pt-4">
            {(['a', 'b'] as const).map((which) => (
              <button key={which} type="button" className={ui.tiny} data-testid={`free-game-award-${which}`} onClick={() => award(which)}>
                Award to {labelOf(which)}
              </button>
            ))}
            <button type="button" className={`${over ? ui.solid : ui.tiny} disabled:opacity-40`} data-testid="free-game-finish" disabled={!begun}
              onClick={() => { if (over || window.confirm('This game is not finished. Move it to the games played anyway?')) onFinish(); }}>
              Finish game
            </button>
            <button type="button" className={ui.tiny} data-testid="free-game-delete"
              onClick={() => { if (!begun || window.confirm(`Delete game ${number} (${teamA} v ${teamB}, ${tally.scoreA}–${tally.scoreB})? It is not kept anywhere.`)) onDelete(); }}>
              Delete game
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
