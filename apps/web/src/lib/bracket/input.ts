import type { GameRow, MatchRow, PoolRow, TeamRow, TournamentRow } from '@/lib/db/types';
import { gamesByMatch, rowToMatch } from '@/lib/db/mappers';
import { computePool } from '@/lib/standings/compute';
import type { KnockoutInput } from './plan';

/**
 * The bracket input for one tournament: each pool's table (organiser order and playoffs already
 * applied by computePool) plus the count of pool matches still to play. Shared by startKnockout
 * and the admin preview so both refuse for exactly the same reasons.
 */
export function knockoutInput(input: {
  tournament: TournamentRow; pools: readonly PoolRow[]; teams: readonly TeamRow[]; matchRows: readonly MatchRow[]; gameRows: readonly GameRow[];
}): Omit<KnockoutInput, 'newId'> {
  const matches = input.matchRows.map(rowToMatch);
  const games = gamesByMatch(input.gameRows);
  const advancePerPool = input.tournament.advance_per_pool;
  return {
    advancePerPool,
    unfinishedPoolMatches: matches.filter((m) => m.stage === 'pool' && m.status !== 'done').length,
    pools: input.pools.map((p) => {
      const { rows, ties } = computePool({ pool: p, teams: input.teams, matches, games, advancePerPool });
      return {
        poolId: p.id, name: p.name, ranked: rows.map((r) => r.teamId),
        // Any unresolved tie blocks the bracket, seeding ones included: they decide which
        // qualifier is seeded first and so who meets whom. computePool returns no ties at all
        // once the organiser has set the pool's order by hand.
        unresolved: ties.length > 0,
      };
    }),
  };
}
