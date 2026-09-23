import { buildBracket, buildBracketFromSeats, type Match, type PoolResult } from '@tournament/core';
import { seatsMatch } from './draw';

/** One pool's finishing order, already computed (see lib/standings/compute.ts). */
export interface PoolResultInput {
  poolId: string;
  name: string;
  /** Team ids in finishing order, best first. */
  ranked: string[];
  /**
   * This pool still has an unresolved tie — one that changes who qualifies OR who is seeded
   * first. computePool reports none once the organiser has set the order by hand, so a manual
   * order is what clears this.
   */
  unresolved: boolean;
}

export interface KnockoutInput {
  pools: PoolResultInput[];
  advancePerPool: number;
  newId: () => string;
  /** Pool matches still to play; the bracket is refused while any remain. */
  unfinishedPoolMatches?: number;
  /**
   * The organiser's own draw (randomised or arranged by hand), as a seat per bracket place. It is
   * used only while it still holds exactly the teams that qualified; a draw left over from an
   * earlier set of pool results is ignored in favour of the seeded one.
   */
  seats?: readonly (string | null)[] | null;
}

/**
 * Turns computed pool tables into the knockout bracket. The ranking itself is not recomputed
 * here, so an organiser's manual order and any playoff results already feed straight through.
 * A withdrawn team that qualified before withdrawing keeps its place; the organiser swaps it
 * out with "replace team in bracket" if they want somebody else in it.
 */
export function planKnockout(input: KnockoutInput): { matches: Match[]; qualifiers: PoolResult[]; custom: boolean } | { error: string } {
  const unfinished = input.unfinishedPoolMatches ?? 0;
  if (unfinished > 0) return { error: `${unfinished} pool match${unfinished === 1 ? '' : 'es'} still to play` };

  const qualifiers: PoolResult[] = [];
  for (const pool of input.pools) {
    if (pool.unresolved) return { error: `${pool.name} has an unresolved tie; record a playoff or set the order manually` };
    if (pool.ranked.length < input.advancePerPool) return { error: `${pool.name} has ${pool.ranked.length} teams but ${input.advancePerPool} must advance` };
    qualifiers.push({ poolId: pool.poolId, ranked: pool.ranked.slice(0, input.advancePerPool) });
  }
  const custom = seatsMatch(input.seats, qualifiers.flatMap((q) => q.ranked));
  const matches = custom
    ? buildBracketFromSeats(input.seats!, input.newId)
    : buildBracket(qualifiers, input.advancePerPool, input.newId);
  return { matches, qualifiers, custom };
}
