import Link from 'next/link';
import type { Game, Match } from '@tournament/core';
import type { GameRow, TeamRow } from '@/lib/db/types';
import type { Pending } from './MatchCard';
import { ui } from './ui';

function roundTitle(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round ${round}`;
}

export function Bracket({ matches, teams, games, slots, hrefFor, pendingFor }: {
  matches: Match[]; teams: readonly TeamRow[]; games: Record<string, Game[]>; hrefFor?: (m: Match) => string;
  /** Every game row per match; the courts a live meeting is spread over are read off these. */
  slots?: Record<string, GameRow[]>;
  /** Supplies the unconfirmed submission to label a submitted/disputed box with, if any. */
  pendingFor?: (m: Match) => Pending | undefined;
}) {
  const ko = matches.filter((m) => m.stage === 'knockout');
  if (ko.length === 0) return <p className={ui.empty}>The knockout has not started.</p>;
  const totalRounds = Math.max(...ko.map((m) => m.round ?? 1));
  const rounds = Array.from({ length: totalRounds }, (_, i) => ko.filter((m) => m.round === i + 1).sort((x, y) => x.slot - y.slot));
  const team = (id: string | null) => teams.find((t) => t.id === id);
  /** A court holds one game, so a live meeting can be on several at once. */
  const courtsOf = (m: Match) => (slots?.[m.id] ?? [])
    .filter((s) => s.started_at !== null && s.score_a === null && s.court !== null)
    .map((s) => s.court!);

  const row = (m: Match, id: string | null, side: 'a' | 'b') => {
    const t = team(id);
    const won = m.winnerId !== null && m.winnerId === id;
    const scores = (games[m.id] ?? []).map((g) => (side === 'a' ? g.scoreA : g.scoreB));
    // 'awarded', 'forfeit' or 'bye' — no scores were played, so the word replaces them.
    const decided = m.status === 'done' && m.decidedBy !== 'played';
    return (
      <div className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${won ? 'bg-orange-wash font-bold' : ''}`}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate">
            {t && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.colour }} />}
            {t?.seed && <span className="bg-orange-tint px-1.5 text-[11px] font-bold text-orange-ink">#{t.seed}</span>}
            <span className="truncate">{t?.name ?? (m.status === 'done' && !id ? 'bye' : 'TBD')}</span>
          </span>
          {t?.tagline && <span className="block truncate text-[11px] text-muted">{t.tagline}</span>}
        </span>
        <span className="shrink-0 font-display text-sm font-black tabular-nums">
          {decided ? <span className="text-[11px] uppercase tracking-label text-muted">{m.decidedBy}</span> : scores.join(' ')}
        </span>
      </div>
    );
  };

  return (
    <div data-testid="bracket" className="overflow-x-auto pb-4">
      <div className="flex gap-8" style={{ minHeight: `${rounds[0]!.length * 6}rem` }}>
        {rounds.map((list, i) => (
          <div key={i} className="bk-round">
            <div className="mb-2.5 bg-navy px-3 py-1.5 text-center text-xs font-bold uppercase tracking-eyebrow text-bone">
              {roundTitle(i + 1, totalRounds)}
            </div>
            <div className="bk-slots">
              {list.map((m) => {
                const pending = pendingFor?.(m);
                const box = (
                  <div className={`bk-box relative w-full divide-y divide-line bg-white ${m.status === 'live' ? 'border-2 border-orange' : 'border-2 border-navy'}`}>
                    {row(m, m.teamAId, 'a')}
                    {row(m, m.teamBId, 'b')}
                    {m.status === 'live' && courtsOf(m).length > 0 && <div className="bg-orange px-3 py-1 text-[11px] font-bold uppercase tracking-label text-ink">Court {courtsOf(m).join(', ')} · live</div>}
                    {(m.status === 'submitted' || m.status === 'disputed') && (
                      <div className="bg-orange-tint px-3 py-1 text-[11px] font-bold uppercase tracking-label text-orange-ink">
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
