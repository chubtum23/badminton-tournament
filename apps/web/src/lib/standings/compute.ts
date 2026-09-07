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
  /** This pool's ordinary fixtures all exist and have all been played. */
  complete: boolean;
  /** This pool's ordinary (non-playoff) fixtures, in playing order. */
  fixtures: Match[];
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

  const fixtures = matches.filter((m) => m.stage === 'pool').sort((a, b) => a.slot - b.slot);
  // A full round robin, so every pair meets once. Anything short of that (no draw yet, or a
  // fixture missing) means the table below is not the finished one.
  const expected = (teams.length * (teams.length - 1)) / 2;
  const complete = expected > 0 && fixtures.length === expected && fixtures.every((m) => m.status === 'done');

  // Before the pool is played a table of zeroes is not a ranking: every team is level on points
  // and score difference, so unresolvedTies would flag a "tie" the moment the pools are locked.
  // That is noise, not a decision the organiser has to make, so ties are withheld — and the row
  // flag with them — until the last fixture is in.
  return {
    rows: complete || manual ? rows : rows.map((r) => ({ ...r, tieUnresolved: false })),
    ties: manual || !complete ? [] : unresolvedTies(rows, input.advancePerPool),
    manual,
    playoffs: matches.filter((m) => m.stage === 'playoff'),
    complete,
    fixtures,
  };
}
