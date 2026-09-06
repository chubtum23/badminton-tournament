import type { Game, Match } from '@tournament/core';
import type { TeamRow } from '@/lib/db/types';

export function teamName(teams: readonly TeamRow[], id: string | null, fallback = 'TBD'): string {
  return id ? teams.find((t) => t.id === id)?.name ?? '?' : fallback;
}

export function MatchCard({ match, teams, games, label, pending, children }: {
  match: Match; teams: readonly TeamRow[]; games: Game[]; label?: string;
  pending?: { games: Game[]; by: string };
  children?: React.ReactNode;
}) {
  const a = teamName(teams, match.teamAId), b = teamName(teams, match.teamBId);
  const shown = games.length ? games : pending?.games ?? [];
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
      {pending && match.status !== 'done' && (
        <div className="mb-1 inline-block rounded bg-amber-100 px-1 text-[10px] uppercase tracking-wide text-amber-800">
          unconfirmed · {pending.by}
        </div>
      )}
      {line(match.teamAId, a, 'a')}
      {line(match.teamBId, b, 'b')}
      {children && <div className="mt-2 border-t pt-2">{children}</div>}
    </div>
  );
}
