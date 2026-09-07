import { buildBracket, type Match, type PoolResult } from '@tournament/core';

/** One pool's finishing order, already computed (see lib/standings/compute.ts). */
export interface PoolResultInput {
  poolId: string;
  name: string;
  /** Team ids in finishing order, best first. */
  ranked: string[];
  /** An unresolved tie sits on this pool's qualification line. */
  unresolved: boolean;
}

export interface KnockoutInput {
  pools: PoolResultInput[];
  advancePerPool: number;
  newId: () => string;
  /** Pool matches still to play; the bracket is refused while any remain. */
  unfinishedPoolMatches?: number;
}

/**
 * Turns computed pool tables into the knockout bracket. The ranking itself is not recomputed
 * here, so an organiser's manual order and any playoff results already feed straight through.
 * A withdrawn team that qualified before withdrawing keeps its place; the organiser swaps it
 * out with "replace team in bracket" if they want somebody else in it.
 */
export function planKnockout(input: KnockoutInput): { matches: Match[]; qualifiers: PoolResult[] } | { error: string } {
  const unfinished = input.unfinishedPoolMatches ?? 0;
  if (unfinished > 0) return { error: `${unfinished} pool match${unfinished === 1 ? '' : 'es'} still to play` };

  const qualifiers: PoolResult[] = [];
  for (const pool of input.pools) {
    if (pool.unresolved) return { error: `${pool.name} has an unresolved tie on the qualification line; record a playoff or set the order manually` };
    if (pool.ranked.length < input.advancePerPool) return { error: `${pool.name} has ${pool.ranked.length} teams but ${input.advancePerPool} must advance` };
    qualifiers.push({ poolId: pool.poolId, ranked: pool.ranked.slice(0, input.advancePerPool) });
  }
  return { matches: buildBracket(qualifiers, input.advancePerPool, input.newId), qualifiers };
}
