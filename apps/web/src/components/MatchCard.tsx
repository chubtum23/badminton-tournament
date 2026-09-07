import type { Game, Match } from '@tournament/core';
import type { TeamRow } from '@/lib/db/types';
import type { LatestSubmissions } from '@/lib/db/queries';
import { sameGames } from '@/lib/submissions/decide';

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

export function MatchCard({ match, teams, games, label, pending, children }: {
  match: Match; teams: readonly TeamRow[]; games: Game[]; label?: string;
  pending?: Pending;
  children?: React.ReactNode;
}) {
  const a = teamName(teams, match.teamAId), b = teamName(teams, match.teamBId);
  const shown = games.length ? games : pending?.games ?? [];
  const showPending = pending !== undefined && match.status !== 'done';
  const line = (id: string | null, name: string, side: 'a' | 'b') => (
    <div className={`flex items-center justify-between gap-2 ${match.winnerId && match.winnerId === id ? 'font-semibold' : ''}`}>
      <span className="truncate">{name}</span>
      <span className="font-mono text-xs">{shown.map((g) => (side === 'a' ? g.scoreA : g.scoreB)).join(' ')}</span>
    </div>
  );
  return (
    <div className={`rounded border bg-white p-3 text-sm ${match.status === 'live' ? 'border-emerald-500 shadow' : ''}`}>
      <div className="mb-1 flex justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>{match.status === 'live' && match.court ? `Court ${match.court} · live` : match.status}</span>
      </div>
      {showPending && (
        <div className="mb-1">
          <span className="inline-block rounded bg-amber-100 px-1 text-[10px] uppercase tracking-wide text-amber-800">
            {match.status === 'disputed' ? 'disputed' : 'unconfirmed'} · {pending.by}
          </span>
          {pending.other && (
            <div className="mt-1 font-mono text-[10px] text-amber-800">
              {pending.by} says {compact(pending.games)} · {pending.other.by} says {compact(pending.other.games)}
            </div>
          )}
        </div>
      )}
      {line(match.teamAId, a, 'a')}
      {line(match.teamBId, b, 'b')}
      {children && <div className="mt-2 border-t pt-2">{children}</div>}
    </div>
  );
}
