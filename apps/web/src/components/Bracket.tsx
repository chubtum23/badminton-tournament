import Link from 'next/link';
import type { Game, Match } from '@tournament/core';
import type { TeamRow } from '@/lib/db/types';
import type { Pending } from './MatchCard';

function roundTitle(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round ${round}`;
}

export function Bracket({ matches, teams, games, hrefFor, pendingFor }: {
  matches: Match[]; teams: readonly TeamRow[]; games: Record<string, Game[]>; hrefFor?: (m: Match) => string;
  /** Supplies the unconfirmed submission to label a submitted/disputed box with, if any. */
  pendingFor?: (m: Match) => Pending | undefined;
}) {
  const ko = matches.filter((m) => m.stage === 'knockout');
  if (ko.length === 0) return <p className="text-sm text-slate-500">The knockout has not started.</p>;
  const totalRounds = Math.max(...ko.map((m) => m.round ?? 1));
  const rounds = Array.from({ length: totalRounds }, (_, i) => ko.filter((m) => m.round === i + 1).sort((x, y) => x.slot - y.slot));
  const team = (id: string | null) => teams.find((t) => t.id === id);

  const row = (m: Match, id: string | null, side: 'a' | 'b') => {
    const t = team(id);
    const won = m.winnerId !== null && m.winnerId === id;
    const scores = (games[m.id] ?? []).map((g) => (side === 'a' ? g.scoreA : g.scoreB));
    // 'awarded', 'forfeit' or 'bye' — no scores were played, so the word replaces them.
    const decided = m.status === 'done' && m.decidedBy !== 'played';
    return (
      <div className={`flex items-center justify-between gap-2 px-2 py-1 ${won ? 'font-semibold' : ''}`}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 truncate">
            {t && <span className="inline-block h-2 w-2 rounded-full" style={{ background: t.colour }} />}
            {t?.seed && <span className="rounded bg-amber-100 px-1 text-[10px]">#{t.seed}</span>}
            <span className="truncate">{t?.name ?? (m.status === 'done' && !id ? 'bye' : 'TBD')}</span>
          </span>
          {t?.tagline && <span className="block truncate text-[10px] text-slate-500">{t.tagline}</span>}
        </span>
        <span className="shrink-0 font-mono text-xs text-slate-700">
          {decided ? <span className="uppercase tracking-wide">{m.decidedBy}</span> : scores.join(' ')}
        </span>
      </div>
    );
  };

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-8" style={{ minHeight: `${rounds[0]!.length * 6}rem` }}>
        {rounds.map((list, i) => (
          <div key={i} className="bk-round">
            <div className="mb-2 rounded bg-blue-900 px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide text-white">
              {roundTitle(i + 1, totalRounds)}
            </div>
            <div className="bk-slots">
              {list.map((m) => {
                const pending = pendingFor?.(m);
                const box = (
                  <div className={`bk-box relative w-full divide-y rounded border-2 bg-white text-sm ${m.status === 'live' ? 'border-emerald-500 shadow-md' : 'border-blue-900'}`}>
                    {row(m, m.teamAId, 'a')}
                    {row(m, m.teamBId, 'b')}
                    {m.status === 'live' && m.court && <div className="px-2 py-0.5 text-[10px] text-emerald-700">Court {m.court} · live</div>}
                    {(m.status === 'submitted' || m.status === 'disputed') && (
                      <div className="px-2 py-0.5 text-[10px] uppercase text-amber-700">
                        {m.status === 'disputed' ? 'disputed' : 'unconfirmed'}{pending ? ` · ${pending.by}` : ''}
                      </div>
                    )}
                  </div>
                );
                return (
                  <div key={m.id} className="bk-slot">
                    {hrefFor ? <Link href={hrefFor(m)} className="w-full">{box}</Link> : box}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
