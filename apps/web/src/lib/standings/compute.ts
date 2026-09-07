import { poolStandings, unresolvedTies, type Game, type Match, type StandingRow, type UnresolvedTie } from '@tournament/core';
import type { PoolRow, TeamRow } from '@/lib/db/types';
import { teamRefs } from '@/lib/db/mappers';

export interface PoolComputation {
  rows: StandingRow[];
  ties: UnresolvedTie[];
  /** The organiser has set the finishing order for this pool. */
  manual: boolean;
  /** Playoff matches recorded inside this pool (any status). */
  playoffs: Match[];
}

/**
 * The single place the app turns raw rows into one pool's table. Withdrawn teams stay in the
 * table (their played matches still count); an organiser order, when set, wins outright and
 * silences the tie warnings, because the organiser has already answered them.
 */
export function computePool(input: {
  pool: PoolRow;
  teams: readonly TeamRow[];
  matches: readonly Match[];
  games: Readonly<Record<string, Game[]>>;
  advancePerPool: number;
}): PoolComputation {
  const teams = input.teams.filter((t) => t.pool_id === input.pool.id);
  const matches = input.matches.filter((m) => m.poolId === input.pool.id && (m.stage === 'pool' || m.stage === 'playoff'));
  const overridden = teams
    .filter((t) => t.pool_rank_override !== null)
    .sort((a, b) => a.pool_rank_override! - b.pool_rank_override!);
  const manual = overridden.length > 0;
  const rows = poolStandings(teamRefs(teams), matches, input.games, manual ? { manualOrder: overridden.map((t) => t.id) } : {});
  return {
    rows,
    ties: manual ? [] : unresolvedTies(rows, input.advancePerPool),
    manual,
    playoffs: matches.filter((m) => m.stage === 'playoff'),
  };
}
