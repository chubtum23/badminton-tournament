import type { Game, Match } from '@tournament/core';
import type { GameRow, TeamRow, TournamentRow } from '@/lib/db/types';
import type { LatestSubmissions } from '@/lib/db/queries';
import { sameGames } from '@/lib/submissions/decide';
import { gameLabel } from '@/lib/db/mappers';
import { ui } from './ui';

export function teamName(teams: readonly TeamRow[], id: string | null, fallback = 'TBD'): string {
  return id ? teams.find((t) => t.id === id)?.name ?? '?' : fallback;
}

/** One side's unconfirmed submission, plus the other side's when the two disagree. */
export interface Pending {
  games: Game[];
  by: string;
  /** Only set when both sides have submitted and their games differ. */
  other?: { games: Game[]; by: string };
}

/**
 * The submission to show on a match card. `preferSide` picks which side's scores lead when both
 * have submitted — the team page passes the opponent's side, because a player wants to see what
 * the other team claimed, not their own numbers read back to them.
 */
export function pendingFor(
  latest: LatestSubmissions,
  teams: readonly TeamRow[],
  match: Match,
  preferSide?: 'a' | 'b',
): Pending | undefined {
  const l = latest[match.id];
  if (!l) return undefined;
  const entry = (side: 'a' | 'b') => {
    const s = side === 'a' ? l.a : l.b;
    return s ? { games: s.games, by: teamName(teams, side === 'a' ? match.teamAId : match.teamBId) } : undefined;
  };
  const a = entry('a'), b = entry('b');
  const first = preferSide === 'b' ? b ?? a : a ?? b;
  if (!first) return undefined;
  const second = first === a ? b : a;
  const differ = a !== undefined && b !== undefined && !sameGames(a.games, b.games);
  return { ...first, other: differ ? second : undefined };
}

const compact = (games: Game[]) => games.map((g) => `${g.scoreA}-${g.scoreB}`).join(', ');

/**
 * One meeting: its two teams, and under them a line per game.
 *
 * A played game inverts to navy and prints its score large — that is what someone crossing the
 * hall is looking for, and it makes a card's progress legible without reading a word. An unplayed
 * game stays a plain outlined row, and carries the organiser's controls when it has any.
 */
export function MatchCard({ match, teams, games, label, tone, pending, tournament, slots, gameList = true, taglines = true, children }: {
  match: Match; teams: readonly TeamRow[]; games: Game[]; label?: string;
  /** The pool's head tint, from `poolTone(i).head`. Neutral when the meeting has no pool. */
  tone?: string;
  pending?: Pending;
  /** Supplies the game names when `slots` is given. */
  tournament?: Pick<TournamentRow, 'game_labels'>;
  /**
   * Every game row of the meeting, played or not. When given, the card lists one line per game
   * (its label and score) instead of the old single score column, because a meeting is now three
   * separately scheduled games. A bye has no slots, and then the old rendering stands.
   */
  slots?: readonly GameRow[];
  /**
   * False when the caller renders its own game rows as `children` — the organiser's cards use
   * GameLine, which carries the court and score controls. The header still counts `slots`, so an
   * organiser's card reads "1/3 · Court 1" like every other one.
   */
  gameList?: boolean;
  /** Render each team's tagline under its name. */
  taglines?: boolean;
  children?: React.ReactNode;
}) {
  const a = teamName(teams, match.teamAId), b = teamName(teams, match.teamBId);
  const shown = games.length ? games : pending?.games ?? [];
  const showPending = pending !== undefined && match.status !== 'done';
  const perGame = slots !== undefined && slots.length > 0;
  // A court belongs to a game now, so a live meeting can be spread over several of them.
  const courts = (slots ?? []).filter((s) => s.started_at !== null && s.score_a === null && s.court !== null).map((s) => s.court!);
  const playedCount = (slots ?? []).filter((s) => s.score_a !== null).length;
  const tagline = (id: string | null) => (id ? teams.find((t) => t.id === id)?.tagline ?? '' : '');
  // The loser is dimmed rather than the winner emphasised: both names are already at display
  // weight, so there is no heavier step left to take, and dimming one is the clearer signal.
  const lost = (id: string | null) => match.winnerId !== null && id !== null && match.winnerId !== id;

  /**
   * The right-hand word in the header: how far through the meeting is, and where it is being
   * played. A meeting counts as 'live' from its first score onward, which is not the same as
   * having a game on a court right now — so the court is named off `courts` rather than off the
   * status, and a meeting resting between games reads "1/3" with no court at all.
   */
  const progress = perGame
    ? `${playedCount}/${slots!.length}${courts.length > 0 ? ` · Court ${courts.join(', ')}` : ''}`
    : courts.length > 0 ? `Court ${courts.join(', ')} · live` : match.status;

  const side = (id: string | null, name: string) => (
    <span className={`min-w-0 ${lost(id) ? 'text-muted-soft' : ''}`}>
      <span className="block truncate">{name}</span>
      {taglines && tagline(id) && <span className="block truncate font-sans text-xs font-normal normal-case tracking-normal text-muted">{tagline(id)}</span>}
    </span>
  );

  return (
    // `data-testid` rather than a class hook: the end-to-end specs used to find these cards by
    // their border and radius, which tied every card selector to the styling.
    <div data-testid="match-card" className={`${ui.card} ${match.status === 'live' ? 'border-orange' : ''}`}>
      <div className={`${ui.head} ${tone ?? 'text-muted'}`}>
        <span className={ui.eyebrow}>{label}</span>
        <span className="flex items-center gap-2">
          {match.decidedBy !== 'played' && <span className={ui.pillLocked}>{match.decidedBy}</span>}
          <span className="text-xs font-bold uppercase tracking-label">{progress}</span>
        </span>
      </div>

      <div className="px-7 pb-3 pt-6 font-display text-2xl font-extrabold uppercase leading-snug tracking-tight sm:text-3xl">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {side(match.teamAId, a)}
          <span className="font-sans text-lg font-medium lowercase text-line-strong">vs</span>
          {side(match.teamBId, b)}
        </span>
      </div>

      {showPending && (
        <div className="px-7 pb-2">
          <span className={match.status === 'disputed' ? 'bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-label text-red-800' : ui.pillTodo}>
            {match.status === 'disputed' ? 'disputed' : 'unconfirmed'} · {pending.by}
          </span>
          {pending.other && (
            <p className="mt-1.5 text-xs tabular-nums text-red-800">
              {pending.by} says {compact(pending.games)} · {pending.other.by} says {compact(pending.other.games)}
            </p>
          )}
        </div>
      )}

      {perGame && gameList ? (
        <ul className="flex flex-col gap-2.5 px-7 pb-7 pt-3">
          {slots!.map((s) => {
            const scored = s.score_a !== null && s.score_b !== null;
            const name = tournament ? gameLabel(tournament, s.game_no) : `Game ${s.game_no}`;
            return (
              <li
                key={s.game_no}
                className={`flex items-center justify-between gap-4 px-5 py-4 ${scored ? 'bg-navy text-bone' : 'border-hair border-line'}`}
              >
                <span className={`min-w-0 text-base font-bold uppercase tracking-wide ${scored ? 'text-orange-bright' : ''}`}>
                  <span className="block truncate">{name}{s.time_expired ? ' — time' : ''}</span>
                </span>
                <span className={`shrink-0 tabular-nums ${scored ? 'font-display text-3xl font-black' : 'text-base font-semibold text-muted'}`}>
                  {scored ? `${s.score_a}–${s.score_b}` : s.started_at !== null ? `Court ${s.court ?? '?'}` : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        shown.length > 0 && (
          <p className="px-7 pb-7 pt-2 font-display text-2xl font-black tabular-nums">
            {shown.map((g) => `${g.scoreA}–${g.scoreB}`).join('  ')}
          </p>
        )
      )}

      {children && <div className="border-t-hair border-line px-7 py-6">{children}</div>}
    </div>
  );
}
