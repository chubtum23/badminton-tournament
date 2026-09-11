import type { MatchRow, TournamentStatus } from '@/lib/db/types';

/** What the organiser has to type before unlocking the pools throws away entered results. */
export const UNLOCK_WORD = 'UNLOCK';

export const POOL_RESULTS_FROZEN = 'Pool results are frozen once the knockout starts, because the bracket was drawn from them.';

/**
 * The bracket is built once, from the pool tables as they stood when the knockout started. Changing a
 * pool or playoff result after that would leave the tables and the bracket disagreeing about who
 * qualified, so those results stop taking edits at that point.
 */
export function poolResultsFrozen(stage: MatchRow['stage'], status: TournamentStatus): boolean {
  return stage !== 'knockout' && (status === 'knockout' || status === 'finished');
}
