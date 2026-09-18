'use client';
import { liveScore } from '@/lib/results/liveSheet';
import { useLiveGame } from './LiveGames';

/**
 * The running score of a game someone is scoring point by point, with a pulsing dot so it reads as
 * in progress rather than final. Renders `fallback` when nobody is.
 */
export function LiveScore({ matchId, gameNo, fallback = null, className = 'text-3xl' }: {
  matchId: string;
  gameNo: number;
  fallback?: React.ReactNode;
  /** The score's size; the dot stays the same. */
  className?: string;
}) {
  const live = useLiveGame(matchId, gameNo);
  if (!live || live.rallies.length === 0) return <>{fallback}</>;
  const { a, b } = liveScore(live.rallies);
  return (
    <span data-testid="live-score" className={`flex items-center gap-2 font-display font-black tabular-nums text-ink ${className}`}>
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-orange" />
      <span className="sr-only">Live score </span>{a}–{b}
    </span>
  );
}
